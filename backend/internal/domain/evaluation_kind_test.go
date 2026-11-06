package domain

import (
	"reflect"
	"strings"
	"sync"
	"testing"
	"time"

	"github.com/simhozebs/net-worth-estimator/backend/internal/types"
)

// Rerunning the base simulation must NOT be the default: reader is the
// zero-value Kind, simulators opt in with Kind simulator plus AllowSimulation,
// and the base path cache separates the base hash from the eval key.

func TestEvaluationKindDefaultsToReader(t *testing.T) {
	var def *EvaluationDefinition
	if def.KindOrDefault() != EvaluationKindReader {
		t.Fatal("nil definition must default to reader")
	}
	def = &EvaluationDefinition{}
	if def.KindOrDefault() != EvaluationKindReader || def.IsSimulator() {
		t.Fatal("zero-value definition must be a reader, not a simulator")
	}
	simulator := &EvaluationDefinition{Kind: EvaluationKindSimulator, AllowSimulation: true}
	if !simulator.IsSimulator() {
		t.Fatal("Kind simulator plus flag must opt into simulation")
	}
	halfOptIn := &EvaluationDefinition{Kind: EvaluationKindSimulator}
	if halfOptIn.IsSimulator() {
		t.Fatal("Kind simulator without the explicit flag must not opt into simulation")
	}
}

func TestEvaluationRegistryRejectsSimulatorWithoutFlag(t *testing.T) {
	registry := NewEvaluationRegistry()
	defer func() {
		recovered := recover()
		if recovered == nil {
			t.Fatal("registering Kind simulator without AllowSimulation must panic")
		}
		if message, ok := recovered.(string); !ok || !strings.Contains(message, "AllowSimulation") {
			t.Fatalf("panic must name the missing opt-in, got %v", recovered)
		}
	}()
	registry.Register(&EvaluationDefinition{
		Type: "simulator-without-flag",
		Name: "simulator without flag",
		Kind: EvaluationKindSimulator,
	})
}

func TestEvaluationRegistryValidatesKnownDefinitions(t *testing.T) {
	if err := evaluationRegistryInstance.Validate(); err != nil {
		t.Fatalf("known definitions must carry valid simulator opt-ins: %v", err)
	}
	for _, entry := range evaluationRegistryInstance.List() {
		definition, _ := evaluationRegistryInstance.Get(entry.Type)
		switch entry.Type {
		case types.EvaluationTypePlannedPurchases, types.EvaluationTypeFinancialIndependence, types.EvaluationTypeWhatIf:
			if !definition.IsSimulator() {
				t.Fatalf("%s must be an explicit simulator", entry.Type)
			}
		default:
			if definition.IsSimulator() || definition.KindOrDefault() != EvaluationKindReader {
				t.Fatalf("%s must be a reader", entry.Type)
			}
		}
	}
}

type cannedResult struct{ value float64 }

func (r *cannedResult) ToJSON() types.JsonValue { return map[string]any{"value": r.value} }

func kindTestPath(t *testing.T) *types.ProjectionPath {
	t.Helper()
	floor := 0.0
	model := &types.FinancialModel{
		Accounts:    []types.Account{{ID: "cash", Name: "Cash", Kind: types.AccountKindCash, MinBalance: &floor, Enabled: true}},
		Evaluations: types.EmptyEvaluationTables(),
	}
	settings := &types.ProjectionRuntimeSettings{FallbackProjectionStartDate: "2026-02-01", HorizonYears: 1}
	path, _, err := ProjectRawFinancialModel(model, settings, types.EmptyModelOverrides(), nil)
	if err != nil {
		t.Fatal(err)
	}
	return path
}

func TestReaderEvaluationCannotResimulate(t *testing.T) {
	path := kindTestPath(t)
	oldTries, oldPause := resimGuardTries, resimGuardPause
	resimGuardTries, resimGuardPause = 3, time.Millisecond
	defer func() { resimGuardTries, resimGuardPause = oldTries, oldPause }()
	resimulating := &EvaluationDefinition{
		Type: "test-resimulate",
		Name: "test resimulate",
		// Zero Kind: reader by default.
		ValidateConfig: func(any) error { return nil },
		ParseConfig:    func(config any) (any, error) { return config, nil },
		EvaluatePath: func(ctx *EvaluationContext, _ any) (PathResult, error) {
			if _, err := Simulate(types.SimulationRequest{}); err != nil {
				return nil, err
			}
			return &cannedResult{}, nil
		},
		CreateAccumulator: func(any, PathResult) (Accumulator, error) { return nil, nil },
		Accumulate:        func(Accumulator, PathResult) error { return nil },
		Finalize:          func(Accumulator, *EvaluationFinalizeContext) (types.JsonValue, error) { return nil, nil },
		Status:            func(PathResult, types.JsonValue) types.EvaluationResultStatus { return types.StatusSatisfied },
	}
	registry := NewEvaluationRegistry()
	registry.Register(resimulating)
	// Drive the runtime directly: ParseConfig then guarded EvaluatePath.
	parsed, err := resimulating.ParseConfig(map[string]any{})
	if err != nil {
		t.Fatal(err)
	}
	set := &EvaluationRuntimeSet{runtimes: []*instanceRuntime{{
		evaluationType: resimulating.Type,
		configuredRaw:  parsed,
		instanceID:     "resim",
		name:           "resim",
		definition:     resimulating,
	}}}
	set.EvaluateDeterministic(&EvaluationContext{Path: path, Model: &path.EffectiveModel})
	runtime := set.runtimes[0]
	if runtime.deterministic != nil {
		t.Fatal("reader resimulation must not produce a result")
	}
	found := false
	for _, diagnostic := range runtime.diagnostics {
		if diagnostic.Code == "evaluation-runtime-error" && strings.Contains(diagnostic.Message, "must not rerun the base simulation") {
			found = true
		}
	}
	if !found {
		t.Fatalf("reader resimulation must report a reader violation, got %+v", runtime.diagnostics)
	}
}

func TestResimulationGuardToleratesBriefCrossRequestOverlap(t *testing.T) {
	oldTries, oldPause := resimGuardTries, resimGuardPause
	resimGuardTries, resimGuardPause = 50, time.Millisecond
	defer func() { resimGuardTries, resimGuardPause = oldTries, oldPause }()
	release := make(chan struct{})
	var wg sync.WaitGroup
	wg.Add(1)
	go func() {
		defer wg.Done()
		withReaderGuard(
			&EvaluationDefinition{Type: "test-reader", Name: "test reader"},
			"test-reader",
			func() (PathResult, error) {
				close(release)
				time.Sleep(10 * time.Millisecond)
				return &cannedResult{}, nil
			},
		)
	}()
	<-release
	if err := requireResimulationAllowed("Simulate"); err != nil {
		t.Fatalf("brief cross-request overlap must be retried, got %v", err)
	}
	wg.Wait()
}

func kindTestModel() (*types.FinancialModel, *types.ProjectionRuntimeSettings) {
	floor := 0.0
	model := &types.FinancialModel{
		Accounts:    []types.Account{{ID: "cash", Name: "Cash", Kind: types.AccountKindCash, MinBalance: &floor, Enabled: true}},
		Evaluations: types.EmptyEvaluationTables(),
		Transactions: []types.Transaction{{
			ID: "pay", Name: "Pay", Destinations: []string{"cash"}, Enabled: true,
			Amount:          types.TransactionAmountResolution{Resolver: "expression", Config: map[string]any{"expression": "100"}},
			PostedTime:      midnightUnix("2026-02-05"),
			TransactionTime: midnightUnix("2026-02-05"),
		}},
	}
	settings := &types.ProjectionRuntimeSettings{FallbackProjectionStartDate: "2026-02-01", HorizonYears: 1}
	return model, settings
}

func TestEvaluationsDoNotAlterBaseTimeline(t *testing.T) {
	model, settings := kindTestModel()
	base, err := ProjectFinancialModel(model, settings, types.EmptyModelOverrides(), nil)
	if err != nil {
		t.Fatal(err)
	}
	withEval := *settings
	withEval.Evaluations.NetWorthThreshold = []types.EvaluationInstance[types.JsonValue]{
		{InstanceID: "t", Name: "T", Enabled: true, Config: map[string]any{"target": 50.0}},
	}
	changed, err := ProjectFinancialModel(model, &withEval, types.EmptyModelOverrides(), nil)
	if err != nil {
		t.Fatal(err)
	}
	if !reflect.DeepEqual(base.Timeline, changed.Timeline) {
		t.Fatal("eval config must not alter the base timeline")
	}
	if len(changed.Evaluations.NetWorthThreshold) != 1 {
		t.Fatal("eval-changed result must carry the threshold eval")
	}
	if len(base.Evaluations.NetWorthThreshold) != 0 {
		t.Fatal("eval-free result must carry no threshold eval")
	}
}

func TestEvalOnlyChangeRecomputesBasePath(t *testing.T) {
	model, settings := kindTestModel()
	first, err := ProjectFinancialModel(model, settings, types.EmptyModelOverrides(), nil)
	if err != nil {
		t.Fatal(err)
	}
	withEval := *settings
	withEval.Evaluations.NetWorthThreshold = []types.EvaluationInstance[types.JsonValue]{
		{InstanceID: "t", Name: "T", Enabled: true, Config: map[string]any{"target": 50.0}},
	}
	second, err := ProjectFinancialModel(model, &withEval, types.EmptyModelOverrides(), nil)
	if err != nil {
		t.Fatal(err)
	}
	if !reflect.DeepEqual(first.Timeline, second.Timeline) {
		t.Fatal("eval-only change must not alter the base timeline")
	}
	if len(first.Evaluations.NetWorthThreshold) != 0 {
		t.Fatalf("first result must carry no threshold eval, got %+v", first.Evaluations.NetWorthThreshold)
	}
	if len(second.Evaluations.NetWorthThreshold) != 1 {
		t.Fatalf("second result must carry the threshold eval, got %+v", second.Evaluations.NetWorthThreshold)
	}
	// Each call computes independently, so no result leaks evaluations
	// into the next caller.
	third, err := ProjectFinancialModel(model, settings, types.EmptyModelOverrides(), nil)
	if err != nil {
		t.Fatal(err)
	}
	if len(third.Evaluations.NetWorthThreshold) != 0 {
		t.Fatal("fresh result must not leak evaluations across calls")
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

// A simulator evaluation must resimulate even while another request holds a
// reader guard: the guard is process-global and base plus eval-overlay
// requests evaluate concurrently, so a foreign reader must never block a
// simulator's own entitled simulation.
func TestSimulatorResimulationAllowedDuringConcurrentReader(t *testing.T) {
	path := kindTestPath(t)
	entered := make(chan struct{})
	release := make(chan struct{})
	var once sync.Once
	unblock := func() { once.Do(func() { close(release) }) }
	defer unblock()
	blockingReader := &EvaluationDefinition{
		Type:           "test-blocking-reader",
		Name:           "test blocking reader",
		ValidateConfig: func(any) error { return nil },
		ParseConfig:    func(config any) (any, error) { return config, nil },
		EvaluatePath: func(ctx *EvaluationContext, _ any) (PathResult, error) {
			close(entered)
			<-release
			return &cannedResult{}, nil
		},
		Status: func(PathResult, types.JsonValue) types.EvaluationResultStatus {
			return types.StatusSatisfied
		},
	}
	readerSet := &EvaluationRuntimeSet{runtimes: []*instanceRuntime{{
		evaluationType: blockingReader.Type,
		configuredRaw:  map[string]any{},
		instanceID:     "reader",
		name:           "reader",
		definition:     blockingReader,
	}}}
	readerDone := make(chan struct{})
	go func() {
		defer close(readerDone)
		readerSet.EvaluateDeterministic(&EvaluationContext{Path: path, Model: &path.EffectiveModel})
	}()
	<-entered
	simulator := &EvaluationDefinition{
		Type:            "test-concurrent-simulator",
		Name:            "test concurrent simulator",
		Kind:            EvaluationKindSimulator,
		AllowSimulation: true,
		ValidateConfig:  func(any) error { return nil },
		ParseConfig:     func(config any) (any, error) { return config, nil },
		EvaluatePath: func(ctx *EvaluationContext, _ any) (PathResult, error) {
			if err := requireResimulationAllowed("simulatePurchases"); err != nil {
				return nil, err
			}
			return &cannedResult{}, nil
		},
		Status: func(PathResult, types.JsonValue) types.EvaluationResultStatus {
			return types.StatusSatisfied
		},
	}
	simulatorSet := &EvaluationRuntimeSet{runtimes: []*instanceRuntime{{
		evaluationType: simulator.Type,
		configuredRaw:  map[string]any{},
		instanceID:     "simulator",
		name:           "simulator",
		definition:     simulator,
	}}}
	simulatorSet.EvaluateDeterministic(&EvaluationContext{Path: path, Model: &path.EffectiveModel})
	unblock()
	<-readerDone
	runtime := simulatorSet.runtimes[0]
	if runtime.deterministic == nil {
		t.Fatalf("simulator must resimulate during a concurrent reader, got %+v", runtime.diagnostics)
	}
	for _, diagnostic := range runtime.diagnostics {
		if diagnostic.Code == "evaluation-runtime-error" {
			t.Fatalf("simulator must not report a reader violation, got %+v", runtime.diagnostics)
		}
	}
}
