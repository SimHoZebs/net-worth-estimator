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
