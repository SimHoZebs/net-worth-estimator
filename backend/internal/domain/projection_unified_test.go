package domain

import (
	"testing"

	"github.com/simhozebs/net-worth-estimator/backend/internal/types"
)

func TestRecurrencePreprocessor(t *testing.T) {
	model := &types.FinancialModel{
		RecurrenceRules: []types.RecurrenceRule{
			{ID: "fixed", Amount: types.PostingAmountResolution{Inputs: map[string]types.AmountInputBinding{}}},
			{ID: "volatile", Amount: types.PostingAmountResolution{Inputs: map[string]types.AmountInputBinding{
				"rate": {Source: "provider", Provider: "occurrence-rate", Arguments: map[string]any{"annualRate": 0.07, "volatility": 0.12}},
			}}},
			{ID: "flat-rate", Amount: types.PostingAmountResolution{Inputs: map[string]types.AmountInputBinding{
				"rate": {Source: "provider", Provider: "occurrence-rate", Arguments: map[string]any{"annualRate": 0.07}},
			}}},
		},
	}
	got := RecurrencePreprocessor(model)
	if got.ByRule["volatile"] != RuleBehaviorStochastic {
		t.Fatalf("volatile rule should be stochastic, got %s", got.ByRule["volatile"])
	}
	if got.ByRule["fixed"] != RuleBehaviorDeterministic {
		t.Fatalf("fixed rule should be deterministic, got %s", got.ByRule["fixed"])
	}
	if got.ByRule["flat-rate"] != RuleBehaviorDeterministic {
		t.Fatalf("flat rate without volatility should be deterministic, got %s", got.ByRule["flat-rate"])
	}
	if len(got.Stochastic) != 1 || got.Stochastic[0] != "volatile" {
		t.Fatalf("stochastic list mismatch: %v", got.Stochastic)
	}
}

func TestFindFirstInvalidSlice(t *testing.T) {
	slices := []types.ProjectionSlice{
		{ID: "a", FromAt: "2026-01-01", ToAt: "2026-04-01"},
		{ID: "b", FromAt: "2026-04-01", ToAt: "2026-07-01"},
		{ID: "c", FromAt: "2026-07-01", ToAt: "2026-10-01"},
	}
	if got := FindFirstInvalidSlice(slices, ""); got != -1 {
		t.Fatalf("empty dirty should need no rebuild, got %d", got)
	}
	if got := FindFirstInvalidSlice(slices, "2026-05-01"); got != 1 {
		t.Fatalf("expected slice 1, got %d", got)
	}
	if got := FindFirstInvalidSlice(slices, "2026-04-01"); got != 0 {
		t.Fatalf("dirty equal to boundary to_at rebuilds that slice, got %d", got)
	}
	if got := FindFirstInvalidSlice(slices, "2027-01-01"); got != -1 {
		t.Fatalf("dirty past end should need no rebuild, got %d", got)
	}
}

func TestSlicesNeedRebuild(t *testing.T) {
	state := types.ProjectionState{Revision: 3, DirtyFrom: ""}
	slices := []types.ProjectionSlice{{ID: "a", BuiltRevision: 3}}
	if SlicesNeedRebuild(slices, state) {
		t.Fatal("clean state with current slices should not rebuild")
	}
	state.DirtyFrom = "2026-02-01"
	slices = []types.ProjectionSlice{{ID: "a", FromAt: "2026-01-01", ToAt: "2026-04-01", BuiltRevision: 3}}
	if !SlicesNeedRebuild(slices, state) {
		t.Fatal("dirty inside slice should rebuild")
	}
}
