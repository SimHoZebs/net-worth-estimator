package api

import (
	"context"
	"encoding/json"
	"fmt"
	"log"
	"net/http"
	"strconv"
	"sync"
	"time"

	"github.com/simhozebs/net-worth-estimator/backend/internal/domain"
	"github.com/simhozebs/net-worth-estimator/backend/internal/types"
)

// stochasticSSE streams StochasticProgress events plus optional partial
// results, mirroring the TS worker postMessage protocol over SSE.
//
// Recovery contract: seeded computations run once per content key in the
// shared-run registry below. A client that drops its stream (backgrounded
// browser, dead TCP) re-POSTs the same body and attaches to the still-running
// computation: it immediately receives the latest partial, then the remaining
// stream. Post-completion reconnects are served from the DB artifact cache.
// Unseeded runs bypass the registry (fresh random draws cannot be shared).
// A `retry` hint plus `: heartbeat` comments keep backgrounded/proxied
// streams alive.
const (
	sseRetryMs           = 3000
	sseHeartbeatInterval = 15 * time.Second
	// sharedRunGracePeriod keeps a finished run in memory so clients racing
	// completion read the final result without touching the DB. Later
	// reconnects use the DB artifact cache.
	sharedRunGracePeriod = 60 * time.Second
	// sharedRunSubscriberBuffer bounds per-stream lag: progress/partial
	// events are cumulative snapshots, so a slow stream may drop
	// intermediate ones without losing correctness.
	sharedRunSubscriberBuffer = 16
)

// stochasticStreamEvent is one broadcast to attached SSE streams.
type stochasticStreamEvent struct {
	progress types.StochasticProgress
	partial  *types.StochasticProjectionResult
}

// sharedStochasticRun is one seeded computation feeding many attached SSE
// streams. The computation runs on a detached context: client disconnects
// only detach streams, never cancel the run.
type sharedStochasticRun struct {
	mu          sync.Mutex
	subscribers map[chan stochasticStreamEvent]struct{}
	latest      stochasticStreamEvent
	hasLatest   bool
	result      *types.StochasticProjectionResult
	runErr      error
	done        chan struct{}
}

var sharedStochasticRegistry = struct {
	sync.Mutex
	byKey map[string]*sharedStochasticRun
}{byKey: map[string]*sharedStochasticRun{}}

// sharedRunGracePeriodVar allows tests to shorten eviction without touching
// production timing.
var sharedRunGracePeriodVar = sharedRunGracePeriod

// getOrStartSharedRun returns the run for key, starting it when absent. The
// second return reports ownership: only the owner drives the computation.
func getOrStartSharedRun(key string) (*sharedStochasticRun, bool) {
	sharedStochasticRegistry.Lock()
	defer sharedStochasticRegistry.Unlock()
	if run, ok := sharedStochasticRegistry.byKey[key]; ok {
		return run, false
	}
	run := &sharedStochasticRun{
		subscribers: map[chan stochasticStreamEvent]struct{}{},
		done:        make(chan struct{}),
	}
	sharedStochasticRegistry.byKey[key] = run
	return run, true
}

// removeSharedRun evicts key only if it still maps to run (a newer run for
// the same key after eviction+restart must survive).
func removeSharedRun(key string, run *sharedStochasticRun) {
	sharedStochasticRegistry.Lock()
	defer sharedStochasticRegistry.Unlock()
	if sharedStochasticRegistry.byKey[key] == run {
		delete(sharedStochasticRegistry.byKey, key)
	}
}

// resetSharedRunsForTest clears the registry; tests only.
func resetSharedRunsForTest() {
	sharedStochasticRegistry.Lock()
	defer sharedStochasticRegistry.Unlock()
	sharedStochasticRegistry.byKey = map[string]*sharedStochasticRun{}
}

// subscribe attaches a stream. When the run already finished, done is true
// and the caller must read the outcome via outcome() instead of listening.
// Otherwise the caller replays snapshot (when hasSnapshot) and then listens
// on ch until done closes or its own context ends.
func (run *sharedStochasticRun) subscribe() (ch chan stochasticStreamEvent, snapshot stochasticStreamEvent, hasSnapshot bool, finished bool) {
	run.mu.Lock()
	defer run.mu.Unlock()
	select {
	case <-run.done:
		return nil, stochasticStreamEvent{}, false, true
	default:
	}
	ch = make(chan stochasticStreamEvent, sharedRunSubscriberBuffer)
	run.subscribers[ch] = struct{}{}
	return ch, run.latest, run.hasLatest, false
}

func (run *sharedStochasticRun) unsubscribe(ch chan stochasticStreamEvent) {
	run.mu.Lock()
	defer run.mu.Unlock()
	delete(run.subscribers, ch)
}

// publish records the latest snapshot and broadcasts it. Slow streams drop
// intermediate events; every partial is a cumulative snapshot, so the next
// one supersedes what was dropped.
func (run *sharedStochasticRun) publish(event stochasticStreamEvent) {
	run.mu.Lock()
	defer run.mu.Unlock()
	run.latest = event
	run.hasLatest = true
	for ch := range run.subscribers {
		select {
		case ch <- event:
		default:
		}
	}
}

// finish records the outcome, wakes every attached stream, persists
// completed results for post-grace reconnects, and schedules eviction.
func (run *sharedStochasticRun) finish(key string, persist func(*types.StochasticProjectionResult), result *types.StochasticProjectionResult, runErr error) {
	run.mu.Lock()
	run.result = result
	run.runErr = runErr
	close(run.done)
	run.mu.Unlock()
	if runErr == nil && result != nil && persist != nil {
		persist(result)
	}
	time.AfterFunc(sharedRunGracePeriodVar, func() { removeSharedRun(key, run) })
}

// outcome returns the finished run's result or error. Call only after done
// closes (or when subscribe reports finished).
func (run *sharedStochasticRun) outcome() (*types.StochasticProjectionResult, error) {
	run.mu.Lock()
	defer run.mu.Unlock()
	return run.result, run.runErr
}

// ---- Shared SSE stream helpers ----

// sseEventWriter serializes SSE event writes for one stream.
type sseEventWriter func(id, name string, payload any) error

// newSSEEventWriter builds the single mutex-guarded event writer for a
// stream. The heartbeat goroutine and the event loop run on different
// goroutines and their bytes must never interleave mid-event.
func newSSEEventWriter(w http.ResponseWriter, flusher http.Flusher, writeMu *sync.Mutex) sseEventWriter {
	return func(id, name string, payload any) error {
		encoded, err := json.Marshal(payload)
		if err != nil {
			return err
		}
		writeMu.Lock()
		defer writeMu.Unlock()
		if _, err := fmt.Fprintf(w, "id: %s\nevent: %s\ndata: %s\n\n", id, name, encoded); err != nil {
			return err
		}
		flusher.Flush()
		return nil
	}
}

// startSSEHeartbeat keeps idle proxies/NAT from killing long batches between
// progress flushes. It stops when done closes or a write fails.
func startSSEHeartbeat(w http.ResponseWriter, flusher http.Flusher, writeMu *sync.Mutex, done chan struct{}) {
	go func() {
		ticker := time.NewTicker(sseHeartbeatInterval)
		defer ticker.Stop()
		for {
			select {
			case <-done:
				return
			case <-ticker.C:
				writeMu.Lock()
				_, err := fmt.Fprintf(w, ": heartbeat\n\n")
				if err == nil {
					flusher.Flush()
				}
				writeMu.Unlock()
				if err != nil {
					return
				}
			}
		}
	}()
}

// stochasticProgressPayload builds the cumulative progress/partial payload:
// every partial is a cumulative snapshot, so it supersedes the previous one.
func stochasticProgressPayload(progress types.StochasticProgress, partial *types.StochasticProjectionResult) (string, map[string]any) {
	payload := map[string]any{"progress": progress}
	eventName := "progress"
	if partial != nil {
		eventName = "partial"
		payload["partial"] = partial
	}
	return eventName, payload
}

// writeStochasticProgress streams one progress/partial event. A broken
// stream only detaches its client; the shared run continues for the rest.
func writeStochasticProgress(writeEvent sseEventWriter, progress types.StochasticProgress, partial *types.StochasticProjectionResult) {
	eventName, payload := stochasticProgressPayload(progress, partial)
	if err := writeEvent(strconv.Itoa(progress.CompletedRuns), eventName, payload); err != nil {
		log.Printf("stochastic sse: %s write failed: %v", eventName, err)
	}
}

func (s *Server) stochasticSSE(w http.ResponseWriter, r *http.Request) {
	flusher, ok := w.(http.Flusher)
	if !ok {
		http.Error(w, "streaming unsupported", http.StatusInternalServerError)
		return
	}

	var body struct {
		Document   *types.FinancialModelDocument   `json:"document,omitempty"`
		Overrides  types.ModelOverrides            `json:"overrides,omitempty"`
		Settings   types.ProjectionRuntimeSettings `json:"settings"`
		Config     types.StochasticConfig          `json:"config"`
		IncomeData *types.IncomeDataSnapshot       `json:"incomeData,omitempty"`
	}
	if err := json.NewDecoder(r.Body).Decode(&body); err != nil {
		http.Error(w, "invalid request body: "+err.Error(), http.StatusBadRequest)
		return
	}
	document, incomeData, err := s.resolveDocument(body.Document, body.IncomeData)
	if err != nil {
		http.Error(w, err.Error(), http.StatusInternalServerError)
		return
	}

	// Unseeded runs are never cached or shared: a nil seed means "fresh
	// random draw", matching TS semantics. The shipped frontend always
	// materializes a concrete seed before sending, so app traffic is
	// registry-eligible.
	cacheEligible := body.Config.Seed != nil
	var cacheKey string
	if cacheEligible {
		cacheKey = artifactKey("stochastic", map[string]any{
			"document":   document,
			"overrides":  body.Overrides,
			"settings":   projectionSettingsDescriptor(body.Settings),
			"incomeData": incomeData,
			"config": map[string]any{
				"runCount": body.Config.RunCount,
				"seed":     body.Config.Seed,
			},
		})
		if cached, err := lookupArtifact[types.StochasticProjectionResult](s.store, cacheKey); err == nil && cached.hit {
			w.Header().Set("Content-Type", "text/event-stream")
			w.Header().Set("Cache-Control", "no-store")
			w.Header().Set("X-Cache", "hit")
			w.WriteHeader(http.StatusOK)
			encoded, marshalErr := json.Marshal(map[string]any{"result": cached.value})
			if marshalErr == nil {
				fmt.Fprintf(w, "retry: %d\n\n", sseRetryMs)
				fmt.Fprintf(w, "id: done\nevent: result\ndata: %s\n\n", encoded)
			}
			if flusher, ok := w.(http.Flusher); ok {
				flusher.Flush()
			}
			return
		}
	} else {
		s.serveStochasticInline(w, r, document, incomeData, body.Settings, body.Overrides, body.Config)
		return
	}
	w.Header().Set("X-Cache", "miss")
	run, owner := getOrStartSharedRun(cacheKey)
	if !owner {
		w.Header().Set("X-Cache", "attach")
	}

	w.Header().Set("Content-Type", "text/event-stream")
	w.Header().Set("Cache-Control", "no-store")
	w.Header().Set("Connection", "keep-alive")
	w.WriteHeader(http.StatusOK)
	flusher.Flush()

	// Reconnect hint: a backgrounded browser that drops the stream waits
	// this long before the client re-issues the POST (which attaches to the
	// still-running computation). Heartbeats below keep idle proxies/NAT
	// from killing long batches between progress flushes.
	if _, err := fmt.Fprintf(w, "retry: %d\n\n", sseRetryMs); err == nil {
		flusher.Flush()
	}

	// All writes to this stream share one mutex: the heartbeat goroutine
	// and the event loop below run on different goroutines and their bytes
	// must never interleave mid-event.
	var writeMu sync.Mutex
	heartbeatDone := make(chan struct{})
	defer close(heartbeatDone)
	startSSEHeartbeat(w, flusher, &writeMu, heartbeatDone)

	writeEvent := newSSEEventWriter(w, flusher, &writeMu)
	writeProgress := func(_ int, progress types.StochasticProgress, partial *types.StochasticProjectionResult) {
		writeStochasticProgress(writeEvent, progress, partial)
	}

	if owner {
		// The computation is detached from the request context: this
		// stream dropping must never cancel the shared run. The work is
		// bounded (runCount) and always lands in the artifact cache, so an
		// abandoned run still pays off for the next identical request.
		computeCtx := context.WithoutCancel(r.Context())
		go func() {
			progressCallback := func(progress types.StochasticProgress, partial *types.StochasticProjectionResult) {
				run.publish(stochasticStreamEvent{progress: progress, partial: partial})
			}
			result, runErr := domain.StochasticProjection(computeCtx, document, &body.Settings, body.Overrides, body.Config, progressCallback, incomeData)
			run.finish(cacheKey, func(result *types.StochasticProjectionResult) {
				putArtifact(s.store, cacheKey, "stochastic", result)
			}, result, runErr)
			if runErr != nil {
				log.Printf("stochastic shared run: %v", runErr)
			}
		}()
	}

	ch, snapshot, hasSnapshot, finished := run.subscribe()
	if finished {
		s.writeSharedRunOutcome(writeEvent, run)
		return
	}
	defer run.unsubscribe(ch)
	if hasSnapshot {
		writeProgress(snapshot.progress.CompletedRuns, snapshot.progress, snapshot.partial)
	}
	ctx := r.Context()
	for {
		select {
		case event := <-ch:
			writeProgress(event.progress.CompletedRuns, event.progress, event.partial)
		case <-run.done:
			s.writeSharedRunOutcome(writeEvent, run)
			return
		case <-ctx.Done():
			// Detach only; the shared run continues for others.
			return
		}
	}
}

// writeSharedRunOutcome streams the finished run's result or error event.
func (s *Server) writeSharedRunOutcome(writeEvent func(id, name string, payload any) error, run *sharedStochasticRun) {
	result, runErr := run.outcome()
	if runErr != nil {
		if err := writeEvent("error", "error", map[string]any{"error": runErr.Error()}); err != nil {
			log.Printf("stochastic sse: error write failed: %v", err)
		}
		return
	}
	if err := writeEvent("done", "result", map[string]any{"result": result}); err != nil {
		log.Printf("stochastic sse: result write failed: %v", err)
	}
}

// serveStochasticInline runs an unseeded computation tied to the request:
// fresh random draws cannot be shared or resumed, so the stream lives and
// dies with this connection.
func (s *Server) serveStochasticInline(
	w http.ResponseWriter,
	r *http.Request,
	document *types.FinancialModelDocument,
	incomeData *types.IncomeDataSnapshot,
	settings types.ProjectionRuntimeSettings,
	overrides types.ModelOverrides,
	config types.StochasticConfig,
) {
	flusher, ok := w.(http.Flusher)
	if !ok {
		http.Error(w, "streaming unsupported", http.StatusInternalServerError)
		return
	}
	w.Header().Set("X-Cache", "miss")
	w.Header().Set("Content-Type", "text/event-stream")
	w.Header().Set("Cache-Control", "no-store")
	w.Header().Set("Connection", "keep-alive")
	w.WriteHeader(http.StatusOK)
	flusher.Flush()

	if _, err := fmt.Fprintf(w, "retry: %d\n\n", sseRetryMs); err == nil {
		flusher.Flush()
	}

	var writeMu sync.Mutex
	heartbeatDone := make(chan struct{})
	defer close(heartbeatDone)
	startSSEHeartbeat(w, flusher, &writeMu, heartbeatDone)

	writeEvent := newSSEEventWriter(w, flusher, &writeMu)

	progressCallback := func(progress types.StochasticProgress, partial *types.StochasticProjectionResult) {
		writeStochasticProgress(writeEvent, progress, partial)
	}

	ctx := r.Context()
	result, runErr := domain.StochasticProjection(ctx, document, &settings, overrides, config, progressCallback, incomeData)
	if runErr != nil {
		if err := writeEvent("error", "error", map[string]any{"error": runErr.Error()}); err != nil {
			log.Printf("stochastic sse: error write failed: %v", err)
		}
		return
	}
	if err := writeEvent("done", "result", map[string]any{"result": result}); err != nil {
		log.Printf("stochastic sse: result write failed: %v", err)
	}
}
