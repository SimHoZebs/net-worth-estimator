package domain

import (
	"crypto/sha256"
	"encoding/hex"
	"encoding/json"
	"fmt"
	"sync"
	"sync/atomic"

	"golang.org/x/sync/singleflight"

	"github.com/simhozebs/net-worth-estimator/backend/internal/types"
)

// Stored deterministic evaluation collections, split by plugin kind because
// readers and simulators hinge on different requirements.
//
// Readers answer from the cached path alone and ignore detail levels, so one
// collection per (base, reader subset) change is stored and served to every
// later identical request. No refresh interval is needed: a base or reader
// change keys differently and recomputes once. Concurrent duplicates may
// recompute and last-writer-wins; the results are identical, so no
// coordination is needed.
//
// Simulators run branch simulations against shared base path state. Their
// results depend on the same keys plus the detail level, and each computation
// is expensive, so one collection per (base, simulator subset, detail) change
// is stored and concurrent identical requests share a single in-flight
// computation. A reader-only change leaves the simulator key untouched, and
// vice versa: neither system recomputes for the other's changes.
//
// Shared collections are read-only like the cached base path: callers must
// not mutate envelopes. ProjectFinancialModelDocument copies the result shell
// before attaching evaluations, same as the base result.

// evalCollectionCache is a bounded oldest-evicted store of shared collections.
type evalCollectionCache struct {
	mu      sync.Mutex
	order   []string
	entries map[string]*types.EvaluationResultCollection
	cap     int
	hits    atomic.Uint64
	misses  atomic.Uint64
}

func newEvalCollectionCache(cap int) *evalCollectionCache {
	return &evalCollectionCache{
		entries: map[string]*types.EvaluationResultCollection{},
		cap:     cap,
	}
}

func (c *evalCollectionCache) lookup(key string) (*types.EvaluationResultCollection, bool) {
	c.mu.Lock()
	defer c.mu.Unlock()
	entry, ok := c.entries[key]
	return entry, ok
}

func (c *evalCollectionCache) store(key string, collection *types.EvaluationResultCollection) {
	c.mu.Lock()
	defer c.mu.Unlock()
	if _, exists := c.entries[key]; !exists {
		c.order = append(c.order, key)
		for len(c.order) > c.cap {
			oldest := c.order[0]
			c.order = c.order[1:]
			delete(c.entries, oldest)
		}
	}
	c.entries[key] = collection
}

func (c *evalCollectionCache) stats() (hits, misses uint64) {
	return c.hits.Load(), c.misses.Load()
}

func (c *evalCollectionCache) reset() {
	c.mu.Lock()
	defer c.mu.Unlock()
	c.order = nil
	c.entries = map[string]*types.EvaluationResultCollection{}
	c.hits.Store(0)
	c.misses.Store(0)
}

// Reader entries are small envelopes and cheap to recompute; the cap favors
// fan-out: one base path serves several eval overlays.
var readerEvalCache = newEvalCollectionCache(64)

// Simulator entries each cost branch simulations; the cap keeps computed
// schedules and FI analyses for recent bases without re-running them.
var simulatorEvalCache = newEvalCollectionCache(32)

// simulatorEvalFlight shares one expensive simulator computation across
// concurrent identical requests.
var simulatorEvalFlight singleflight.Group

// ReaderCacheStats reports reader cache hits and misses for tests and operators.
func ReaderCacheStats() (hits, misses uint64) {
	return readerEvalCache.stats()
}

// ResetReaderCache clears reader entries and stats. Tests only.
func ResetReaderCache() {
	readerEvalCache.reset()
}

// SimulatorCacheStats reports simulator cache hits and misses for tests and operators.
func SimulatorCacheStats() (hits, misses uint64) {
	return simulatorEvalCache.stats()
}

// ResetSimulatorCache clears simulator entries and stats. Tests only.
func ResetSimulatorCache() {
	simulatorEvalCache.reset()
}

// runtimeSubsetHash keys exactly the inputs a per-kind cache entry depends on:
// runtime identity, enabled state, definition kind, raw config, and the
// construction-time diagnostics. Global duplicate detection runs before
// partitioning, so identical subsets always evaluate identically.
func runtimeSubsetHash(runtimes []*instanceRuntime) string {
	type runtimeIdentity struct {
		Type        string `json:"type"`
		ID          string `json:"id"`
		Name        string `json:"name"`
		Enabled     bool   `json:"enabled"`
		Kind        string `json:"kind"`
		Config      any    `json:"config"`
		Diagnostics any    `json:"diagnostics"`
	}
	identities := make([]runtimeIdentity, 0, len(runtimes))
	for _, runtimeInstance := range runtimes {
		kind := "unresolved"
		if runtimeInstance.definition != nil {
			kind = string(runtimeInstance.definition.KindOrDefault())
		}
		identities = append(identities, runtimeIdentity{
			Type:        runtimeInstance.evaluationType,
			ID:          runtimeInstance.instanceID,
			Name:        runtimeInstance.name,
			Enabled:     runtimeInstance.enabled,
			Kind:        kind,
			Config:      runtimeInstance.sourceConfig,
			Diagnostics: runtimeInstance.diagnostics,
		})
	}
	encoded, err := json.Marshal(identities)
	if err != nil {
		panic(fmt.Sprintf("runtime subset hash marshal: %v", err))
	}
	digest := sha256.Sum256(encoded)
	return hex.EncodeToString(digest[:])
}

// projectReaderEvaluationsWithCache evaluates the reader subset against the
// cached path, storing one collection per (base, reader subset) change and
// serving the stored one to every later identical request. baseHash must be
// the BaseDocumentHash of the request.
func projectReaderEvaluationsWithCache(path *types.ProjectionPath, baseHash string, readers *EvaluationRuntimeSet) *types.EvaluationResultCollection {
	key := baseHash + "\x00" + runtimeSubsetHash(readers.runtimes)
	if entry, ok := readerEvalCache.lookup(key); ok {
		readerEvalCache.hits.Add(1)
		return entry
	}
	collection := evaluateReaderSubset(path, readers)
	if entry, ok := readerEvalCache.lookup(key); ok {
		readerEvalCache.hits.Add(1)
		return entry
	}
	readerEvalCache.misses.Add(1)
	readerEvalCache.store(key, collection)
	return collection
}

// projectSimulatorEvaluationsWithCache evaluates the simulator subset against
// the cached path, storing one collection per (base, simulator subset, detail)
// change. baseHash must be the BaseDocumentHash of the request: it already covers
// postings, accounts, and the Monte Carlo sample, so candidate simulations
// with volatile amounts key correctly.
func projectSimulatorEvaluationsWithCache(path *types.ProjectionPath, baseHash string, simulators *EvaluationRuntimeSet, monteCarloSample *types.MonteCarloSample, detailLevel string) *types.EvaluationResultCollection {
	if detailLevel == "" {
		detailLevel = "detailed"
	}
	key := baseHash + "\x00" + runtimeSubsetHash(simulators.runtimes) + "\x00" + detailLevel
	if entry, ok := simulatorEvalCache.lookup(key); ok {
		simulatorEvalCache.hits.Add(1)
		return entry
	}
	result, _, shared := simulatorEvalFlight.Do(key, func() (any, error) {
		if entry, ok := simulatorEvalCache.lookup(key); ok {
			return entry, nil
		}
		simulators.EvaluateDeterministic(&EvaluationContext{
			Path:             path,
			Document:         &path.EffectiveDocument,
			MonteCarloSample: monteCarloSample,
			DetailLevel:      detailLevel,
		})
		collection := simulators.Result()
		return &collection, nil
	})
	if shared {
		simulatorEvalCache.hits.Add(1)
		return result.(*types.EvaluationResultCollection)
	}
	simulatorEvalCache.misses.Add(1)
	collection := result.(*types.EvaluationResultCollection)
	simulatorEvalCache.store(key, collection)
	return collection
}

// evaluateReaderSubset runs reader runtimes against the cached path. Readers
// ignore detail levels, so the served detail is fixed; pass the caller's
// sample through for context completeness even though readers never resimulate.
func evaluateReaderSubset(path *types.ProjectionPath, readers *EvaluationRuntimeSet) *types.EvaluationResultCollection {
	readers.EvaluateDeterministic(&EvaluationContext{
		Path:        path,
		Document:    &path.EffectiveDocument,
		DetailLevel: "detailed",
	})
	collection := readers.Result()
	return &collection
}
