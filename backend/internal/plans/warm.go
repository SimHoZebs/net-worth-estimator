package plans

import (
	"context"
	"log"
	"sync"
	"time"

	"github.com/simhozebs/net-worth-estimator/backend/internal/api"
	"github.com/simhozebs/net-worth-estimator/backend/internal/store"
)

// Background warming trigger: mark a plan dirty after mutations so its
// cached probabilities rebuild without a foreground request. Warming never
// changes stored data; it only fills the projection artifact cache that
// pins read.

// defaultWarmDebounce waits for a save burst to settle before warming: one
// frontend save fans out to many row requests, and each would otherwise
// restart the 10-second stochastic run.
const defaultWarmDebounce = 30 * time.Second

// warmFunc computes cached projections for one resource. The default calls
// api.WarmResource with api.WarmDefaults; tests stub it to observe
// scheduling without computing.
type warmFunc func(ctx context.Context, st store.Store, resourceID string) error

func defaultWarmFunc(ctx context.Context, st store.Store, resourceID string) error {
	return api.WarmResource(ctx, st, resourceID, api.WarmDefaults())
}

// Warmer coalesces mutation marks into debounced per-resource warm runs. A
// mark during a run queues exactly one rerun after it. Stop discards pending
// timers; an in-flight run finishes best-effort with errors logged.
type Warmer struct {
	mu       sync.Mutex
	debounce time.Duration
	warm     warmFunc
	lookup   func(resourceID string) (store.Store, bool)
	timers   map[string]*time.Timer
	running  map[string]bool
	queued   map[string]bool
}

func newWarmer(debounce time.Duration, warm warmFunc, lookup func(string) (store.Store, bool)) *Warmer {
	if debounce == 0 {
		debounce = defaultWarmDebounce
	}
	return &Warmer{
		debounce: debounce,
		warm:     warm,
		lookup:   lookup,
		timers:   map[string]*time.Timer{},
		running:  map[string]bool{},
		queued:   map[string]bool{},
	}
}

// MarkDirty schedules a warm run for a known resource. Unknown IDs are
// ignored so a mark never creates a database file. Negative debounce
// disables warming (operator kill switch).
func (w *Warmer) MarkDirty(resourceID string) {
	if w == nil || resourceID == "" {
		return
	}
	w.mu.Lock()
	defer w.mu.Unlock()
	if w.debounce < 0 {
		return
	}
	if _, ok := w.lookup(resourceID); !ok {
		return
	}
	if w.running[resourceID] {
		w.queued[resourceID] = true
		return
	}
	if timer, ok := w.timers[resourceID]; ok {
		timer.Stop()
	}
	id := resourceID
	w.timers[resourceID] = time.AfterFunc(w.debounce, func() { w.fire(id) })
}

func (w *Warmer) fire(resourceID string) {
	w.mu.Lock()
	if w.running[resourceID] {
		w.queued[resourceID] = true
		w.mu.Unlock()
		return
	}
	st, ok := w.lookup(resourceID)
	if !ok {
		delete(w.timers, resourceID)
		w.mu.Unlock()
		return
	}
	delete(w.timers, resourceID)
	w.running[resourceID] = true
	w.mu.Unlock()

	err := w.warm(context.Background(), st, resourceID)
	if err != nil {
		log.Printf("warm resource %s failed: %v", resourceID, err)
	}

	w.mu.Lock()
	defer w.mu.Unlock()
	delete(w.running, resourceID)
	if w.queued[resourceID] {
		delete(w.queued, resourceID)
		if _, ok := w.lookup(resourceID); ok && w.debounce >= 0 {
			id := resourceID
			w.timers[resourceID] = time.AfterFunc(w.debounce, func() { w.fire(id) })
		}
	}
}

// Stop discards pending timers. In-flight runs finish on their own.
func (w *Warmer) Stop() {
	if w == nil {
		return
	}
	w.mu.Lock()
	defer w.mu.Unlock()
	for id, timer := range w.timers {
		timer.Stop()
		delete(w.timers, id)
	}
}
