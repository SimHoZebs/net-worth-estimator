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

// Cached base path. The base simulation (Prepare + Simulate + Adapt) is keyed
// by the base model hash: accounts, checkpoints, postings, recurrence
// rules, payment terms, planned purchases, overrides, projection window, and
// Monte Carlo sample — never evaluations. Evaluations are keyed separately
// and always run against the cached path, so changing eval config never
// invalidates the base path and never reruns the base simulation.
//
// Cached entries are read-only: callers must not mutate the shared path or
// result. ProjectFinancialModel copies the result shell before
// attaching evaluations; row/event slices stay shared and unread.

// BaseModelHash keys the base simulation. Evals are excluded on purpose.
func BaseModelHash(model *types.FinancialModel, overrides types.ModelOverrides, settings *types.ProjectionRuntimeSettings, monteCarloSample *types.MonteCarloSample) string {
	payload := map[string]any{
		"sourcePath":  model.SourcePath,
		"accounts":    model.Accounts,
		"checkpoints": model.Checkpoints,
		"postings":    model.Postings,
		"rules":       model.RecurrenceRules,
		"terms":       model.PaymentTerms,
		"purchases":   model.PlannedPurchases,
		"overrides":   overrides,
		"start":       settings.FallbackProjectionStartDate,
		"horizon":     settings.HorizonYears,
		"asOfInstant": settings.AsOfInstant,
		"sample":      monteCarloSample,
	}
	encoded, err := json.Marshal(payload)
	if err != nil {
		panic(fmt.Sprintf("base model hash marshal: %v", err))
	}
	digest := sha256.Sum256(encoded)
	return hex.EncodeToString(digest[:])
}

// EvaluationsHash keys evaluations separately from the base path.
func EvaluationsHash(tables *types.EvaluationTables) string {
	encoded, err := json.Marshal(tables)
	if err != nil {
		panic(fmt.Sprintf("evaluations hash marshal: %v", err))
	}
	digest := sha256.Sum256(encoded)
	return hex.EncodeToString(digest[:])
}

type basePathEntry struct {
	prepared *types.PreparedProjection
	path     *types.ProjectionPath
	result   *types.ProjectionResult // base result: evaluations unset
}

// maxBasePathEntries bounds process memory; eviction is oldest-inserted.
const maxBasePathEntries = 32

var basePathCache = struct {
	sync.Mutex
	order   []string
	entries map[string]*basePathEntry
}{entries: map[string]*basePathEntry{}}

var basePathCacheHits atomic.Uint64
var basePathCacheMisses atomic.Uint64

// BasePathCacheStats reports cache hits and misses for tests and operators.
func BasePathCacheStats() (hits, misses uint64) {
	return basePathCacheHits.Load(), basePathCacheMisses.Load()
}

// ResetBasePathCache clears entries and stats. Tests only.
func ResetBasePathCache() {
	basePathCache.Lock()
	defer basePathCache.Unlock()
	basePathCache.order = nil
	basePathCache.entries = map[string]*basePathEntry{}
	basePathCacheHits.Store(0)
	basePathCacheMisses.Store(0)
}

func basePathLookup(key string) (*basePathEntry, bool) {
	basePathCache.Lock()
	defer basePathCache.Unlock()
	entry, ok := basePathCache.entries[key]
	return entry, ok
}

func basePathStore(key string, entry *basePathEntry) {
	basePathCache.Lock()
	defer basePathCache.Unlock()
	if _, exists := basePathCache.entries[key]; !exists {
		basePathCache.order = append(basePathCache.order, key)
		for len(basePathCache.order) > maxBasePathEntries {
			oldest := basePathCache.order[0]
			basePathCache.order = basePathCache.order[1:]
			delete(basePathCache.entries, oldest)
		}
	}
	basePathCache.entries[key] = entry
}

// basePathFlight shares one expensive base simulation across concurrent
// identical requests, following the simulator-evaluation precedent.
var basePathFlight singleflight.Group

// projectBaseWithCache returns the prepared request, evaluator-facing path,
// and base result for one base model hash, simulating only on miss.
// Simultaneous callers share one in-flight computation keyed by the same
// hash instead of each running the full simulation. The returned path and
// result are shared and read-only.
func projectBaseWithCache(model *types.FinancialModel, settings *types.ProjectionRuntimeSettings, overrides types.ModelOverrides, monteCarloSample *types.MonteCarloSample) (*types.PreparedProjection, *types.ProjectionPath, *types.ProjectionResult, error) {
	key := BaseModelHash(model, overrides, settings, monteCarloSample)
	if entry, ok := basePathLookup(key); ok {
		basePathCacheHits.Add(1)
		return entry.prepared, entry.path, entry.result, nil
	}
	outcome, err, _ := basePathFlight.Do(key, func() (any, error) {
		basePathCacheMisses.Add(1)
		prepared, err := orchestratedPrepare(model, settings, overrides, monteCarloSample)
		if err != nil {
			return nil, err
		}
		run, err := orchestratedSimulate(prepared.Request)
		if err != nil {
			return nil, err
		}
		path, result := AdaptSimulationRun(prepared, &run)
		entry := &basePathEntry{prepared: prepared, path: path, result: result}
		basePathStore(key, entry)
		return entry, nil
	})
	if err != nil {
		return nil, nil, nil, err
	}
	entry := outcome.(*basePathEntry)
	return entry.prepared, entry.path, entry.result, nil
}
