package projections

import (
	"sync"

	"github.com/simhozebs/net-worth-estimator/backend/internal/types"
)

// sharedRunSubscriberBuffer bounds per-stream lag. Progress and partial events
// are cumulative snapshots, so a slow stream can skip intermediate events.
const sharedRunSubscriberBuffer = 16

// stochasticStreamEvent is one broadcast to attached SSE streams.
type stochasticStreamEvent struct {
	progress types.StochasticProgress
	partial  *types.StochasticProjectionResult
}

// sharedStochasticRun owns one seeded computation and its subscribers.
// A disconnected caller detaches its stream without cancellation of the run.
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

// getOrStartSharedRun returns the run for key, starting it when absent.
// Only the owner drives the computation.
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

// removeSharedRun evicts key only if it still maps to run.
func removeSharedRun(key string, run *sharedStochasticRun) {
	sharedStochasticRegistry.Lock()
	defer sharedStochasticRegistry.Unlock()
	if sharedStochasticRegistry.byKey[key] == run {
		delete(sharedStochasticRegistry.byKey, key)
	}
}

// subscribe attaches a stream. A finished run needs outcome() instead.
// Otherwise the caller replays the snapshot and listens until done or disconnect.
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

// publish records the latest snapshot and broadcasts it without blocking.
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

// finish records the outcome, wakes subscribers, persists success, and evicts.
func (run *sharedStochasticRun) finish(key string, persist func(*types.StochasticProjectionResult), result *types.StochasticProjectionResult, runErr error) {
	run.mu.Lock()
	run.result = result
	run.runErr = runErr
	close(run.done)
	run.mu.Unlock()
	if runErr == nil && result != nil && persist != nil {
		persist(result)
	}
	removeSharedRun(key, run)
}

// outcome returns the finished result or error after done closes.
func (run *sharedStochasticRun) outcome() (*types.StochasticProjectionResult, error) {
	run.mu.Lock()
	defer run.mu.Unlock()
	return run.result, run.runErr
}
