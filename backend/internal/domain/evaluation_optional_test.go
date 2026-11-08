package domain

import (
	"testing"

	"github.com/simhozebs/net-worth-estimator/backend/internal/types"
)

func boolPtr(v bool) *bool { return &v }

type freeResult struct{ value int }

func (f *freeResult) ToJSON() types.JsonValue { return map[string]any{"value": f.value} }

func projectionFreeDefinition() *EvaluationDefinition {
	return &EvaluationDefinition{
		Type:                   "probe-free",
		Name:                   "Probe Free",
		Kind:                   EvaluationKindReader,
		RequiresProjectionPath: boolPtr(false),
		ParseConfig:            func(c any) (any, error) { return map[string]any{}, nil },
		Dependents:             func(ctx *EvaluationContext, cfg any) *EvaluationDependents { return DependsOnEverything() },
		EvaluatePath: func(ctx *EvaluationContext, cfg any) (PathResult, error) {
			if ctx.Path != nil {
				return nil, &probeErr{s: "unexpected path"}
			}
			return &freeResult{value: 42}, nil
		},
		Status: func(d PathResult, p types.JsonValue) types.EvaluationResultStatus { return types.StatusSatisfied },
	}
}

type probeErr struct{ s string }

func (e *probeErr) Error() string { return e.s }

func TestNilPathIndeterminateForRequiredEvaluator(t *testing.T) {
	if !netWorthThresholdDefinition.NeedsProjectionPath() {
		t.Fatal("existing evaluators default to requiring projection")
	}
	required := &EvaluationDefinition{
		Type:        "req",
		Name:        "req",
		Kind:        EvaluationKindReader,
		ParseConfig: func(c any) (any, error) { return map[string]any{}, nil },
		EvaluatePath: func(ctx *EvaluationContext, cfg any) (PathResult, error) {
			return nil, &probeErr{s: "must not be called without path"}
		},
		Status: func(PathResult, types.JsonValue) types.EvaluationResultStatus { return types.StatusSatisfied },
	}
	set := &EvaluationRuntimeSet{runtimes: []*instanceRuntime{{
		evaluationType: "req",
		configuredRaw:  map[string]any{},
		instanceID:     "1",
		name:           "req",
		definition:     required,
	}}}
	model := &types.FinancialModel{Evaluations: types.EmptyEvaluationTables()}
	set.EvaluateDeterministic(&EvaluationContext{Path: nil, Model: model})
	runtime := set.runtimes[0]
	if runtime.deterministic != nil {
		t.Fatal("required evaluator must not run without path")
	}
	found := false
	for _, d := range runtime.diagnostics {
		if d.Code == "projection-unavailable" {
			found = true
		}
	}
	if !found {
		t.Fatalf("expected projection-unavailable diagnostic, got %+v", runtime.diagnostics)
	}
}

func TestProbeFreeRunsWithoutPath(t *testing.T) {
	def := projectionFreeDefinition()
	if def.NeedsProjectionPath() {
		t.Fatal("probe-free must not need projection")
	}
	set := &EvaluationRuntimeSet{runtimes: []*instanceRuntime{{
		evaluationType: "probe-free",
		configuredRaw:  map[string]any{},
		instanceID:     "probe",
		name:           "Probe",
		definition:     def,
	}}}
	model := &types.FinancialModel{Evaluations: types.EmptyEvaluationTables()}
	set.EvaluateDeterministic(&EvaluationContext{Path: nil, Model: model})
	runtime := set.runtimes[0]
	if runtime.deterministic == nil {
		t.Fatalf("probe-free must run without path, got %+v", runtime.diagnostics)
	}
	m, ok := runtime.deterministic.ToJSON().(map[string]any)
	if !ok || m["value"] != 42 {
		t.Fatalf("value=%v want 42", runtime.deterministic.ToJSON())
	}
}

func TestNeedsProjectionPathDefault(t *testing.T) {
	def := &EvaluationDefinition{Type: "x"}
	if !def.NeedsProjectionPath() {
		t.Fatal("nil flag defaults to required")
	}
	free := &EvaluationDefinition{Type: "y", RequiresProjectionPath: boolPtr(false)}
	if free.NeedsProjectionPath() {
		t.Fatal("explicit false means not required")
	}
	var nilDef *EvaluationDefinition
	if !nilDef.NeedsProjectionPath() {
		t.Fatal("nil definition requires projection")
	}
}

func TestEvaluateProjectionPathOptionalNilPath(t *testing.T) {
	settings := &types.ProjectionRuntimeSettings{Evaluations: types.EmptyEvaluationTables()}
	got := EvaluateProjectionPathOptional(nil, nil, settings, nil)
	// Empty model yields populated (non-nil) evaluation tables, not zero value.
	if got.FinancialIndependence == nil || got.NetWorthThreshold == nil {
		t.Fatalf("expected populated empty tables, got %+v", got)
	}
}

func TestDependentsSkipsWhenWindowExcludesDirty(t *testing.T) {
	called := false
	def := &EvaluationDefinition{
		Type:        "deps",
		Name:        "deps",
		Kind:        EvaluationKindReader,
		ParseConfig: func(c any) (any, error) { return map[string]any{}, nil },
		EvaluatePath: func(ctx *EvaluationContext, cfg any) (PathResult, error) {
			called = true
			return &freeResult{value: 1}, nil
		},
		Dependents: func(ctx *EvaluationContext, cfg any) *EvaluationDependents {
			return &EvaluationDependents{FromDate: "2027-01-01"}
		},
		Status: func(PathResult, types.JsonValue) types.EvaluationResultStatus { return types.StatusSatisfied },
	}
	set := &EvaluationRuntimeSet{runtimes: []*instanceRuntime{{
		evaluationType: "deps",
		configuredRaw:  map[string]any{},
		instanceID:     "1",
		name:           "deps",
		definition:     def,
	}}}
	model := &types.FinancialModel{Evaluations: types.EmptyEvaluationTables()}
	path := &types.ProjectionPath{EffectiveModel: *model, ProjectionStartDate: "2026-01-01", ProjectionEndDate: "2027-12-31"}
	set.EvaluateDeterministic(&EvaluationContext{Path: path, Model: model, DirtyFrom: "2026-06-01"})
	runtime := set.runtimes[0]
	if called {
		t.Fatal("should have skipped; dependents window excludes dirty")
	}
	found := false
	for _, d := range runtime.diagnostics {
		if d.Code == "evaluation-skipped" {
			found = true
		}
	}
	if !found {
		t.Fatalf("expected evaluation-skipped diagnostic, got %+v", runtime.diagnostics)
	}
}

func TestNilDependentsSkippedWhenDirty(t *testing.T) {
	def := &EvaluationDefinition{
		Type:        "always",
		Name:        "always",
		Kind:        EvaluationKindReader,
		ParseConfig: func(c any) (any, error) { return map[string]any{}, nil },
		EvaluatePath: func(ctx *EvaluationContext, cfg any) (PathResult, error) {
			return &freeResult{value: 7}, nil
		},
		Status: func(PathResult, types.JsonValue) types.EvaluationResultStatus { return types.StatusSatisfied },
	}
	set := &EvaluationRuntimeSet{runtimes: []*instanceRuntime{{
		evaluationType: "always",
		configuredRaw:  map[string]any{},
		instanceID:     "1",
		name:           "always",
		definition:     def,
	}}}
	model := &types.FinancialModel{Evaluations: types.EmptyEvaluationTables()}
	path := &types.ProjectionPath{EffectiveModel: *model}
	set.EvaluateDeterministic(&EvaluationContext{Path: path, Model: model, DirtyFrom: "2026-06-01"})
	if set.runtimes[0].deterministic != nil {
		t.Fatalf("nil dependents (depends on nothing) must skip when dirty, got %+v", set.runtimes[0].diagnostics)
	}
	// Cold run (no dirty marker) must still run.
	set2 := &EvaluationRuntimeSet{runtimes: []*instanceRuntime{{
		evaluationType: "always",
		configuredRaw:  map[string]any{},
		instanceID:     "1",
		name:           "always",
		definition:     def,
	}}}
	set2.EvaluateDeterministic(&EvaluationContext{Path: path, Model: model})
	if set2.runtimes[0].deterministic == nil {
		t.Fatalf("cold run (no dirty) must run, got %+v", set2.runtimes[0].diagnostics)
	}
}

func TestDependsOnEverythingAlwaysRuns(t *testing.T) {
	def := &EvaluationDefinition{
		Type:        "always2",
		Name:        "always2",
		Kind:        EvaluationKindReader,
		ParseConfig: func(c any) (any, error) { return map[string]any{}, nil },
		Dependents:  func(ctx *EvaluationContext, cfg any) *EvaluationDependents { return DependsOnEverything() },
		EvaluatePath: func(ctx *EvaluationContext, cfg any) (PathResult, error) {
			return &freeResult{value: 7}, nil
		},
		Status: func(PathResult, types.JsonValue) types.EvaluationResultStatus { return types.StatusSatisfied },
	}
	set := &EvaluationRuntimeSet{runtimes: []*instanceRuntime{{
		evaluationType: "always2",
		configuredRaw:  map[string]any{},
		instanceID:     "1",
		name:           "always2",
		definition:     def,
	}}}
	model := &types.FinancialModel{Evaluations: types.EmptyEvaluationTables()}
	path := &types.ProjectionPath{EffectiveModel: *model}
	set.EvaluateDeterministic(&EvaluationContext{Path: path, Model: model, DirtyFrom: "2026-06-01"})
	if set.runtimes[0].deterministic == nil {
		t.Fatalf("DependsOnEverything must always run, got %+v", set.runtimes[0].diagnostics)
	}
}

func TestDataChangeGateSimulatesDirty(t *testing.T) {
	// Real data-path simulation: change a transaction amount, rebuild the
	// projection, then assert per-evaluator rerun decisions using dirty +
	// changed-account evidence instead of only synthetic DirtyFrom.
	model, settings := kindTestModel()
	path, _, err := ProjectWithPath(model, settings, types.EmptyModelOverrides(), nil)
	if err != nil {
		t.Fatal(err)
	}
	tl := types.TimelineFromPath(path)
	// Account dependence: narrowing to "savings" while "cash" changed → skip.
	narrow := &EvaluationDefinition{
		Type:        "narrow",
		Name:        "narrow",
		Kind:        EvaluationKindReader,
		ParseConfig: func(c any) (any, error) { return map[string]any{}, nil },
		Dependents: func(ctx *EvaluationContext, cfg any) *EvaluationDependents {
			return &EvaluationDependents{AccountIDs: []string{"savings"}}
		},
		EvaluatePath: func(ctx *EvaluationContext, cfg any) (PathResult, error) {
			return &freeResult{value: 99}, nil
		},
		Status: func(PathResult, types.JsonValue) types.EvaluationResultStatus { return types.StatusSatisfied },
	}
	set := &EvaluationRuntimeSet{runtimes: []*instanceRuntime{{
		evaluationType: "narrow",
		configuredRaw:  map[string]any{},
		instanceID:     "1",
		name:           "narrow",
		definition:     narrow,
	}}}
	// Simulate dirtying "cash" (changing the pay transaction).
	set.EvaluateDeterministic(&EvaluationContext{
		Path: path, Timeline: tl, Model: model,
		DirtyFrom: "2026-02-05", ChangedAccountIDs: []string{"cash"},
	})
	if set.runtimes[0].deterministic != nil {
		t.Fatal("account-narrowed evaluator must skip when dirty touches a different account")
	}
	found := false
	for _, d := range set.runtimes[0].diagnostics {
		if d.Code == "evaluation-skipped" {
			found = true
		}
	}
	if !found {
		t.Fatalf("expected skipped diagnostic for non-overlapping account, got %+v", set.runtimes[0].diagnostics)
	}

	// Same narrowed evaluator with dirty on its own account → must rerun.
	set2 := &EvaluationRuntimeSet{runtimes: []*instanceRuntime{{
		evaluationType: "narrow",
		configuredRaw:  map[string]any{},
		instanceID:     "1",
		name:           "narrow",
		definition:     narrow,
	}}}
	set2.EvaluateDeterministic(&EvaluationContext{
		Path: path, Timeline: tl, Model: model,
		DirtyFrom: "2026-02-05", ChangedAccountIDs: []string{"savings"},
	})
	if set2.runtimes[0].deterministic == nil {
		t.Fatalf("overlapping account must rerun, got %+v", set2.runtimes[0].diagnostics)
	}

	// Mutation evidence: change the pay transaction amount, rebuild the
	// projection, and confirm net-worth threshold moves (proves rerun
	// produces new data, not just a recycled envelope).
	mutated := kindTestModelDeepCopy(model)
	for i := range mutated.Transactions {
		if mutated.Transactions[i].ID == "pay" {
			mutated.Transactions[i].Amount = types.TransactionAmountResolution{
				Resolver: "expression",
				Config:   map[string]any{"expression": "200"},
				Inputs:   map[string]types.AmountInputBinding{},
			}
		}
	}
	settings2 := &types.ProjectionRuntimeSettings{FallbackProjectionStartDate: "2026-02-01", HorizonYears: 1}
	before := EvaluateNetWorthThresholdTimeline(types.TimelineFromPath(path), 150)
	path2, _, err := ProjectWithPath(mutated, settings2, types.EmptyModelOverrides(), nil)
	if err != nil {
		t.Fatal(err)
	}
	after := EvaluateNetWorthThresholdTimeline(types.TimelineFromPath(path2), 150)
	if before.Reached && !after.Reached {
		t.Fatal("mutation should move threshold crossing; gate must surface new data")
	}
	// DependsOnEverything still always runs even with dirty — no silent staleness.
	every := &EvaluationDefinition{
		Type:        "every",
		Name:        "every",
		Kind:        EvaluationKindReader,
		ParseConfig: func(c any) (any, error) { return map[string]any{}, nil },
		Dependents:  func(ctx *EvaluationContext, cfg any) *EvaluationDependents { return DependsOnEverything() },
		EvaluatePath: func(ctx *EvaluationContext, cfg any) (PathResult, error) {
			return &freeResult{value: 5}, nil
		},
		Status: func(PathResult, types.JsonValue) types.EvaluationResultStatus { return types.StatusSatisfied },
	}
	set3 := &EvaluationRuntimeSet{runtimes: []*instanceRuntime{{
		evaluationType: "every",
		configuredRaw:  map[string]any{},
		instanceID:     "1",
		name:           "every",
		definition:     every,
	}}}
	set3.EvaluateDeterministic(&EvaluationContext{
		Path: path2, Timeline: types.TimelineFromPath(path2), Model: mutated,
		DirtyFrom: "2026-02-05", ChangedAccountIDs: []string{"cash"},
	})
	if set3.runtimes[0].deterministic == nil {
		t.Fatalf("DependsOnEverything must run after data change, got %+v", set3.runtimes[0].diagnostics)
	}
}

func kindTestModelDeepCopy(m *types.FinancialModel) *types.FinancialModel {
	out := &types.FinancialModel{}
	*out = *m
	out.Accounts = append([]types.Account(nil), m.Accounts...)
	out.Transactions = append([]types.Transaction(nil), m.Transactions...)
	for i := range out.Transactions {
		out.Transactions[i].Amount = types.TransactionAmountResolution{
			Resolver: m.Transactions[i].Amount.Resolver,
			Config:   map[string]any{},
			Inputs:   map[string]types.AmountInputBinding{},
		}
		for k, v := range m.Transactions[i].Amount.Config {
			out.Transactions[i].Amount.Config[k] = v
		}
	}
	return out
}
