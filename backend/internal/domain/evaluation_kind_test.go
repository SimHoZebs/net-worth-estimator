package domain

import (
	"reflect"
	"strings"
	"sync"
	"testing"
	"time"

	"github.com/simhozebs/net-worth-estimator/backend/internal/types"
)

// Rerunning the base simulation must NOT be the default: the generic
// Evaluator falls under ReaderDefinition unless registered as
// SimulatorDefinition, the type itself decides simulation permission.

func TestEvaluationKindDefaultsToReader(t *testing.T) {
	var def *ReaderDefinition
	if def.IsSimulator() {
		t.Fatal("nil definition must default to reader")
	}
	def = &ReaderDefinition{Evaluator: Evaluator{}}
	if def.IsSimulator() {
		t.Fatal("zero-value reader must not be a simulator")
	}
	simulator := &SimulatorDefinition{Evaluator: Evaluator{}}
	if !simulator.IsSimulator() {
		t.Fatal("simulator subtype must opt into simulation")
	}
	halfOptIn := &ReaderDefinition{Evaluator: Evaluator{}}
	if halfOptIn.IsSimulator() {
		t.Fatal("reader subtype must not opt into simulation")
	}
}

func TestEvaluationRegistryRejectsMissingDependents(t *testing.T) {
	// Any definition, whatever its subtype, must declare Dependents.
	// Omitting it panics at registration so a missing gate never silently
	// becomes "everything" or "nothing" by accident.
	registry := NewEvaluationRegistry()
	defer func() {
		recovered := recover()
		if recovered == nil {
			t.Fatal("registering without Dependents must panic")
		}
		if message, ok := recovered.(string); !ok || !strings.Contains(message, "Dependents") {
			t.Fatalf("panic must name the missing Dependents, got %v", recovered)
		}
	}()
	registry.Register(&ReaderDefinition{Evaluator: Evaluator{
		Type: "missing-dependents",
		Name: "missing dependents",
	}})
}

func TestEvaluationRegistryValidatesKnownDefinitions(t *testing.T) {
	if err := evaluationRegistryInstance.Validate(); err != nil {
		t.Fatalf("known definitions must declare Dependents: %v", err)
	}
	for _, entry := range evaluationRegistryInstance.List() {
		definition, _ := evaluationRegistryInstance.Get(entry.Type)
		switch entry.Type {
		case types.EvaluationTypePlannedPurchases, types.EvaluationTypeFinancialIndependence, types.EvaluationTypeWhatIf:
			if !definition.IsSimulator() {
				t.Fatalf("%s must be an explicit simulator", entry.Type)
			}
		default:
			if definition.IsSimulator() {
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
		Accounts:    []types.Account{{ID: "cash", Name: "Cash", Kind: types.AccountKindCash, MinBalance: &floor, Enabled: true, Display: types.PassthroughDisplay("cash", "Cash")}},
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
	resimulating := &ReaderDefinition{Evaluator: Evaluator{
		Type: "test-resimulate",
		Name: "test resimulate",
		// Reader subtype: resimulation is refused by the guard.
		ValidateConfig: func(any) error { return nil },
		ParseConfig:    func(config any) (any, error) { return config, nil },
		Dependents:     func(ctx *EvaluationContext, cfg any) *EvaluationDependents { return DependsOnEverything() },
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
	}}
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
			&ReaderDefinition{Evaluator: Evaluator{Type: "test-reader", Name: "test reader"}},
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
		Accounts:    []types.Account{{ID: "cash", Name: "Cash", Kind: types.AccountKindCash, MinBalance: &floor, Enabled: true, Display: types.PassthroughDisplay("cash", "Cash")}},
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

func TestUnifiedSetPreservesGlobalOrder(t *testing.T) {
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
	// One set holds every evaluator; classification is by subtype at
	// registration, not by a runtime split.
	if len(set.runtimes) != 3 {
		t.Fatalf("unified set must hold all 3 runtimes, got %d", len(set.runtimes))
	}
	simulators := 0
	for _, runtime := range set.runtimes {
		if runtime.definition != nil && runtime.definition.IsSimulator() {
			simulators++
			if runtime.instanceID != "purchases" {
				t.Fatalf("only the enabled purchase may be a simulator, got %q", runtime.instanceID)
			}
		}
	}
	if simulators != 1 {
		t.Fatalf("unified set must classify exactly 1 simulator by subtype, got %d", simulators)
	}

	ctx := &EvaluationContext{Path: path, Model: &path.EffectiveModel, DetailLevel: "detailed"}
	set.EvaluateDeterministic(ctx)
	collection := set.Result()

	if len(collection.Evaluations.NetWorthThreshold) != 1 {
		t.Fatalf("result must carry the threshold eval, got %+v", collection.Evaluations.NetWorthThreshold)
	}
	purchases := collection.Evaluations.PlannedPurchases
	if len(purchases) != 2 {
		t.Fatalf("result must carry both purchase evals, got %+v", purchases)
	}
	if purchases[0].InstanceID != "purchases" || purchases[1].InstanceID != "purchases-disabled" {
		t.Fatalf("result must preserve global table order, got %q then %q",
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
	blockingReader := &ReaderDefinition{Evaluator: Evaluator{
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
	}}
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
	simulator := &SimulatorDefinition{Evaluator: Evaluator{
		Type:           "test-concurrent-simulator",
		Name:           "test concurrent simulator",
		ValidateConfig: func(any) error { return nil },
		ParseConfig:    func(config any) (any, error) { return config, nil },
		EvaluatePath: func(ctx *EvaluationContext, _ any) (PathResult, error) {
			if err := requireResimulationAllowed("simulatePurchases"); err != nil {
				return nil, err
			}
			return &cannedResult{}, nil
		},
		Status: func(PathResult, types.JsonValue) types.EvaluationResultStatus {
			return types.StatusSatisfied
		},
	}}
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
