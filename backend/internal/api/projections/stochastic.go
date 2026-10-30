package projections

import (
	"context"
	"encoding/json"
	"fmt"
	"io"
	"log"
	"net/http"
	"strconv"
	"sync"
	"time"

	"github.com/danielgtaylor/huma/v2"
	"github.com/simhozebs/net-worth-estimator/backend/internal/domain"
	"github.com/simhozebs/net-worth-estimator/backend/internal/types"
)

type stochasticRequest struct {
	Model     *types.FinancialModel           `json:"model,omitempty"`
	Overrides types.ModelOverrides            `json:"overrides,omitempty"`
	Settings  types.ProjectionRuntimeSettings `json:"settings"`
	Config    types.StochasticConfig          `json:"config"`
}

// stochasticSSE streams StochasticProgress events plus optional partial
// results over SSE.
//
// Walk-away guarantee: seeded runs are walk-away safe. They keep computing
// after your stream drops, finished results persist in SQLite, and repeating
// the same body attaches to the live run or returns the saved result.
// Unseeded runs are quick checks only: they cancel on disconnect and are
// never saved. Use a seed when you lock your phone or lose Wi-Fi.
//
// Recovery contract: seeded computations run once per content key in the
// shared-run registry in runs.go. A caller that drops its stream re-POSTs the same
// body and attaches to the still-running computation: it immediately receives
// the latest partial, then the remaining stream. Post-completion reconnects
// retrieve the stored result from SQLite. Unseeded runs bypass the registry
// because fresh random draws cannot be shared. A `retry` hint plus `: heartbeat`
// comments keep proxied streams alive.
const (
	sseRetryMs           = 3000
	sseHeartbeatInterval = 15 * time.Second
)

// ---- Shared SSE stream helpers ----

// sseEventWriter serializes SSE event writes for one stream.
type sseEventWriter func(id, name string, payload any) error

// newSSEEventWriter builds the single mutex-guarded event writer for a
// stream. The heartbeat goroutine and the event loop run on different
// goroutines and their bytes must never interleave mid-event.
func newSSEEventWriter(w io.Writer, flusher http.Flusher, writeMu *sync.Mutex) sseEventWriter {
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
func startSSEHeartbeat(w io.Writer, flusher http.Flusher, writeMu *sync.Mutex, done chan struct{}) {
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

// stochasticStream commits source headers only after request preparation.
// Huma's sse.Register commits 200 before its callback, so use StreamResponse
// here to retain pre-stream errors and computed/shared/stored source headers.
func stochasticStream(source string, serve func(context.Context, sseEventWriter)) *huma.StreamResponse {
	return &huma.StreamResponse{Body: func(ctx huma.Context) {
		writer := ctx.BodyWriter()
		flusher, ok := writer.(http.Flusher)
		if !ok {
			ctx.SetHeader("Content-Type", "text/plain; charset=utf-8")
			ctx.SetStatus(http.StatusInternalServerError)
			_, _ = io.WriteString(writer, "streaming unsupported\n")
			return
		}
		ctx.SetHeader("Content-Type", "text/event-stream")
		ctx.SetHeader("Cache-Control", "no-store")
		ctx.SetHeader("Projection-Source", source)
		ctx.SetStatus(http.StatusOK)
		flusher.Flush()
		if _, err := fmt.Fprintf(writer, "retry: %d\n\n", sseRetryMs); err == nil {
			flusher.Flush()
		}

		var writeMu sync.Mutex
		heartbeatDone := make(chan struct{})
		defer close(heartbeatDone)
		startSSEHeartbeat(writer, flusher, &writeMu, heartbeatDone)
		serve(ctx.Context(), newSSEEventWriter(writer, flusher, &writeMu))
	}}
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

// writeStochasticProgress streams one progress/partial event. A broken stream
// only detaches that stream; the shared run continues for the rest.
func writeStochasticProgress(writeEvent sseEventWriter, progress types.StochasticProgress, partial *types.StochasticProjectionResult) {
	eventName, payload := stochasticProgressPayload(progress, partial)
	if err := writeEvent(strconv.Itoa(progress.CompletedRuns), eventName, payload); err != nil {
		log.Printf("stochastic sse: %s write failed: %v", eventName, err)
	}
}

func (s *handler) stochasticSSE(_ context.Context, input *struct{ Body stochasticRequest }) (*huma.StreamResponse, error) {
	body := input.Body
	model, err := s.resolveModel(body.Model)
	if err != nil {
		return nil, huma.Error500InternalServerError(err.Error())
	}

	// Unseeded results are not stored or shared: a nil seed means "fresh
	// random draw". Seeded requests are eligible for the shared registry and
	// result storage; an explicit null keeps fresh-draw semantics.
	identifiedRun := body.Config.Seed != nil
	var resultKey string
	if identifiedRun {
		resultKey = s.resourceArtifactKey("stochastic", map[string]any{
			"model":     model,
			"overrides": body.Overrides,
			"settings":  projectionSettingsDescriptor(body.Settings),
			"config": map[string]any{
				"runCount": body.Config.RunCount,
				"seed":     body.Config.Seed,
			},
		})
		if stored, err := lookupArtifact[types.StochasticProjectionResult](s.store, resultKey); err == nil && stored.found {
			return stochasticStream(projectionSourceStored, func(_ context.Context, writeEvent sseEventWriter) {
				if err := writeEvent("done", "result", map[string]any{"result": stored.value}); err != nil {
					log.Printf("stochastic sse: stored result write failed: %v", err)
				}
			}), nil
		}
	} else {
		return stochasticStream(projectionSourceComputed, func(ctx context.Context, writeEvent sseEventWriter) {
			s.serveStochasticInline(ctx, writeEvent, model, body.Settings, body.Overrides, body.Config)
		}), nil
	}
	_, prefix := parseArtifactKeyMeta(resultKey)
	log.Printf("stochastic simulation request key_prefix=%s accounts=%d postings=%d checkpoints=%d horizon=%d runs=%d",
		prefix, len(model.Accounts), len(model.Postings), len(model.Checkpoints),
		body.Settings.HorizonYears, body.Config.RunCount)
	run, owner := getOrStartSharedRun(resultKey)
	source := projectionSourceShared
	if owner {
		source = projectionSourceComputed
	}

	return stochasticStream(source, func(ctx context.Context, writeEvent sseEventWriter) {
		if owner {
			log.Printf("stochastic run start key_prefix=%s runs=%d", prefix, body.Config.RunCount)
			// The computation is detached from the request context: this
			// stream dropping must never cancel the shared run. Successful results
			// are submitted to storage independently of stream lifetime.
			computeCtx := context.WithoutCancel(ctx)
			go func() {
				progressCallback := func(progress types.StochasticProgress, partial *types.StochasticProjectionResult) {
					run.publish(stochasticStreamEvent{progress: progress, partial: partial})
				}
				result, runErr := domain.StochasticProjection(computeCtx, model, &body.Settings, body.Overrides, body.Config, progressCallback)
				run.finish(resultKey, func(result *types.StochasticProjectionResult) {
					putArtifact(s.store, resultKey, "stochastic", result)
				}, result, runErr)
				if runErr != nil {
					log.Printf("stochastic finish key_prefix=%s status=error error=%v", prefix, runErr)
				} else {
					log.Printf("stochastic finish key_prefix=%s status=ok runs=%d", prefix, body.Config.RunCount)
				}
			}()
		}

		ch, snapshot, hasSnapshot, finished := run.subscribe()
		if finished {
			log.Printf("stochastic attach key_prefix=%s outcome=finished", prefix)
			s.writeSharedRunOutcome(writeEvent, run)
			return
		}
		defer run.unsubscribe(ch)
		completedRuns := 0
		if hasSnapshot {
			completedRuns = snapshot.progress.CompletedRuns
			log.Printf("stochastic attach key_prefix=%s outcome=resume completedRuns=%d", prefix, completedRuns)
			writeStochasticProgress(writeEvent, snapshot.progress, snapshot.partial)
		} else {
			log.Printf("stochastic attach key_prefix=%s outcome=resume completedRuns=0", prefix)
		}
		for {
			select {
			case event := <-ch:
				completedRuns = event.progress.CompletedRuns
				writeStochasticProgress(writeEvent, event.progress, event.partial)
			case <-run.done:
				s.writeSharedRunOutcome(writeEvent, run)
				return
			case <-ctx.Done():
				// Detach only; the shared run continues for others. The
				// completedRuns count shows how far this stream got.
				log.Printf("stochastic detach key_prefix=%s completedRuns=%d", prefix, completedRuns)
				return
			}
		}
	}), nil
}

// writeSharedRunOutcome streams the finished run's result or error event.
func (s *handler) writeSharedRunOutcome(writeEvent func(id, name string, payload any) error, run *sharedStochasticRun) {
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
func (s *handler) serveStochasticInline(
	ctx context.Context,
	writeEvent sseEventWriter,
	model *types.FinancialModel,
	settings types.ProjectionRuntimeSettings,
	overrides types.ModelOverrides,
	config types.StochasticConfig,
) {
	progressCallback := func(progress types.StochasticProgress, partial *types.StochasticProjectionResult) {
		writeStochasticProgress(writeEvent, progress, partial)
	}

	result, runErr := domain.StochasticProjection(ctx, model, &settings, overrides, config, progressCallback)
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
