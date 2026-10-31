package domain

import (
	"reflect"
	"sync"
	"testing"

	"github.com/simhozebs/net-worth-estimator/backend/internal/types"
)

// Reader and simulator results are precomputed once per (base, subset) event
// and shared across the far more frequent frontend requests. A reader-only
// change must not invalidate the simulator cache, and vice versa.

func TestEvalCachesShareCollectionsAcrossRequests(t *testing.T) {
	ResetBasePathCache()
	ResetReaderCache()
	ResetSimulatorCache()
	model, settings := kindTestModel()

	first, err := ProjectFinancialModel(model, settings, types.EmptyModelOverrides(), nil)
	if err != nil {
		t.Fatal(err)
	}
	if hits, misses := ReaderCacheStats(); hits != 0 || misses != 1 {
		t.Fatalf("first projection must compute reader evals once, got hits=%d misses=%d", hits, misses)
	}
	if hits, misses := SimulatorCacheStats(); hits != 0 || misses != 1 {
		t.Fatalf("first projection must compute simulator evals once, got hits=%d misses=%d", hits, misses)
	}
	second, err := ProjectFinancialModel(model, settings, types.EmptyModelOverrides(), nil)
	if err != nil {
		t.Fatal(err)
	}
	if hits, misses := ReaderCacheStats(); hits != 1 || misses != 1 {
		t.Fatalf("identical request must reuse reader evals, got hits=%d misses=%d", hits, misses)
	}
	if hits, misses := SimulatorCacheStats(); hits != 1 || misses != 1 {
		t.Fatalf("identical request must reuse simulator evals, got hits=%d misses=%d", hits, misses)
	}
	if !reflect.DeepEqual(first.Timeline, second.Timeline) {
		t.Fatal("cached evals must not alter the timeline")
	}

	// Reader-only change: same base path, new reader key, same simulator key.
	withEval := *settings
	withEval.Evaluations.NetWorthThreshold = []types.EvaluationInstance[types.JsonValue]{
		{InstanceID: "t", Name: "T", Enabled: true, Config: map[string]any{"target": 50.0}},
	}
	third, err := ProjectFinancialModel(model, &withEval, types.EmptyModelOverrides(), nil)
	if err != nil {
		t.Fatal(err)
	}
	if hits, misses := ReaderCacheStats(); hits != 1 || misses != 2 {
		t.Fatalf("reader-only change must compute reader evals once more, got hits=%d misses=%d", hits, misses)
	}
	if hits, misses := SimulatorCacheStats(); hits != 2 || misses != 1 {
		t.Fatalf("reader-only change must reuse simulator evals, got hits=%d misses=%d", hits, misses)
	}
	if hits, misses := BasePathCacheStats(); hits != 2 || misses != 1 {
		t.Fatalf("eval-only change must reuse the base path, got hits=%d misses=%d", hits, misses)
	}
	if len(third.Evaluations.NetWorthThreshold) != 1 {
		t.Fatalf("eval-changed result must carry the threshold eval, got %+v", third.Evaluations.NetWorthThreshold)
	}
	if len(first.Evaluations.NetWorthThreshold) != 0 || len(second.Evaluations.NetWorthThreshold) != 0 {
		t.Fatal("cached base result must stay evaluation-free for other eval keys")
	}
}

func TestPartitionAndMergePreserveGlobalOrder(t *testing.T) {
	path := kindTestPath(t)
	tables := types.EmptyEvaluationTables()
	tables.NetWorthThreshold = []types.EvaluationInstance[types.JsonValue]{
		{InstanceID: "t", Name: "T", Enabled: true, Config: map[string]any{"target": 50.0}},
	}
	tables.PlannedPurchases = purchaseEvaluation()
	tables.PlannedPurchases = append(tables.PlannedPurchases, types.EvaluationInstance[types.JsonValue]{
		InstanceID: "purchases-disabled", Name: "Disabled", Enabled: false, Config: map[string]any{},
	})

	set := NewEvaluationRuntimeSet(&tables, evaluationRegistryInstance)
	readers, simulators := set.PartitionByKind()
	if len(readers.runtimes) != 2 || len(simulators.runtimes) != 1 {
		t.Fatalf("partition must separate 2 readers from 1 simulator, got %d and %d",
			len(readers.runtimes), len(simulators.runtimes))
	}
	if simulators.runtimes[0].instanceID != "purchases" {
		t.Fatalf("simulator subset must hold the enabled purchase, got %q", simulators.runtimes[0].instanceID)
	}

	ctx := &EvaluationContext{Path: path, Model: &path.EffectiveModel, DetailLevel: "detailed"}
	readers.EvaluateDeterministic(ctx)
	simulators.EvaluateDeterministic(ctx)
	readerCollection := readers.Result()
	simulatorCollection := simulators.Result()
	merged := MergeEvaluationResultCollections(set, &readerCollection, &simulatorCollection)

	if len(merged.Evaluations.NetWorthThreshold) != 1 {
		t.Fatalf("merged result must carry the threshold eval, got %+v", merged.Evaluations.NetWorthThreshold)
	}
	purchases := merged.Evaluations.PlannedPurchases
	if len(purchases) != 2 {
		t.Fatalf("merged result must carry both purchase evals, got %+v", purchases)
	}
	if purchases[0].InstanceID != "purchases" || purchases[1].InstanceID != "purchases-disabled" {
		t.Fatalf("merge must preserve global table order, got %q then %q",
			purchases[0].InstanceID, purchases[1].InstanceID)
	}
	if purchases[1].Status != types.StatusIndeterminate {
		t.Fatalf("disabled purchase must stay indeterminate, got %q", purchases[1].Status)
	}
	if purchases[1].Deterministic != nil {
		t.Fatalf("disabled purchase must not run, got %+v", purchases[1].Deterministic)
	}
}

func TestEvalCacheServesIdenticalResultsConcurrently(t *testing.T) {
	ResetBasePathCache()
	ResetReaderCache()
	ResetSimulatorCache()
	model, settings := kindTestModel()

	const callers = 8
	results := make([]*types.ProjectionResult, callers)
	errs := make([]error, callers)
	var wg sync.WaitGroup
	for i := range results {
		wg.Add(1)
		go func(i int) {
			defer wg.Done()
			results[i], errs[i] = ProjectFinancialModel(model, settings, types.EmptyModelOverrides(), nil)
		}(i)
	}
	wg.Wait()
	for i, err := range errs {
		if err != nil {
			t.Fatalf("request %d: %v", i, err)
		}
		if results[i] == nil {
			t.Fatalf("request %d returned no result", i)
		}
	}
	for i := 1; i < len(results); i++ {
		if !reflect.DeepEqual(results[0].Timeline, results[i].Timeline) {
			t.Fatal("concurrent identical requests must serve identical timelines")
		}
		if !reflect.DeepEqual(results[0].Evaluations, results[i].Evaluations) {
			t.Fatal("concurrent identical requests must serve identical evaluations")
		}
	}
	if _, misses := SimulatorCacheStats(); misses != 1 {
		t.Fatalf("concurrent identical requests must compute simulator evals once, got misses=%d", misses)
	}
	if _, misses := BasePathCacheStats(); misses != 1 {
		t.Fatalf("concurrent identical requests must simulate the projection once, got misses=%d", misses)
	}
}
