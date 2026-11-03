package domain

import (
	"context"
	"math"
	"reflect"
	"testing"

	"github.com/simhozebs/net-worth-estimator/backend/internal/types"
)

func executionTestAccount(id string, minBalance float64) types.Account {
	return types.Account{ID: id, Name: id, Kind: types.AccountKindCash, MinBalance: &minBalance, Enabled: true}
}

func executionTestRuntime(accounts []types.Account, balances map[string]float64) *TransitionRuntime {
	inputs := types.SimulationInputs{Accounts: accounts}
	state := types.SimulationState{
		Balances:                     balances,
		LatestRealizedPostingAmounts: map[string]float64{},
		LatestRealizedPostingDates:   map[string]string{},
		RealizedPostingAmountsByYear: map[string]map[string]float64{},
	}
	return CreateTransitionRuntime(inputs, state, "2026-01-01", nil)
}

func fixedOccurrence(posting *types.Posting, rule *types.RecurrenceRule) DatedPostingOccurrence {
	return DatedPostingOccurrence{Posting: posting, Rule: rule}
}

func expressionAmount(expression string) types.PostingAmountResolution {
	return types.PostingAmountResolution{Resolver: "expression", Config: map[string]any{"expression": expression}, Inputs: map[string]types.AmountInputBinding{}}
}

// Prepare is pure: identical inputs give identical outputs and the inputs
// are never mutated.
func TestPreparePostingExecutionIsPure(t *testing.T) {
	account := "checking"
	floor := 0.0
	posting := &types.Posting{
		ID: "pay", Name: "Pay", SourceAccountID: &account,
		Amount: expressionAmount("50"),
	}
	rt := executionTestRuntime([]types.Account{executionTestAccount(account, floor)}, map[string]float64{account: 1000})
	before := CloneSimulationState(rt.State)
	occurrence := fixedOccurrence(posting, &types.RecurrenceRule{ID: "r", Frequency: "monthly", StartDate: "2026-01-01", Enabled: true})
	first, err := PreparePostingExecution(occurrence, "2026-02-01", false, rt.snapshotExecutionState(), nil)
	if err != nil {
		t.Fatal(err)
	}
	second, err := PreparePostingExecution(occurrence, "2026-02-01", false, rt.snapshotExecutionState(), nil)
	if err != nil {
		t.Fatal(err)
	}
	if !reflect.DeepEqual(first, second) {
		t.Fatalf("prepare is not deterministic: %+v vs %+v", first, second)
	}
	if first.RequestedAmount != 50 {
		t.Fatalf("requested = %v, want 50", first.RequestedAmount)
	}
	if !reflect.DeepEqual(rt.State, before) {
		t.Fatal("prepare mutated runtime state")
	}
	if first.IsLoss {
		t.Fatal("positive outflow must not take the loss path")
	}
}

// The split preserves behavior: Prepare plus Apply equals the old fused path.
func TestSplitExecutionMatchesFusedExecution(t *testing.T) {
	account := "checking"
	floor := 0.0
	outflow := func(id, expression string) *types.Posting {
		return &types.Posting{
			ID: id, Name: id, SourceAccountID: &account,
			Amount: expressionAmount(expression), Enabled: true,
		}
	}
	rule := func(cap *float64) *types.RecurrenceRule {
		return &types.RecurrenceRule{ID: "r", Frequency: "monthly", StartDate: "2026-01-01", AnnualCap: cap, Enabled: true}
	}
	cap := 100.0
	loss := &types.Posting{
		ID: "p5", Name: "Loss", Destinations: []string{account},
		Amount: expressionAmount("-30"), Enabled: true,
	}
	cases := []struct {
		name       string
		posting    *types.Posting
		rule       *types.RecurrenceRule
		historical bool
		balances   map[string]float64
	}{
		{"funded outflow", outflow("p1", "50"), rule(nil), false, map[string]float64{account: 1000}},
		{"underfunded outflow clamps", outflow("p2", "50"), rule(nil), false, map[string]float64{account: 10}},
		{"historical actual ignores funding", outflow("p3", "50"), rule(nil), true, map[string]float64{account: 10}},
		{"annual cap binds", outflow("p4", "500"), rule(&cap), false, map[string]float64{account: 1000}},
		{"loss path", loss, nil, false, map[string]float64{account: 1000}},
	}
	for _, tc := range cases {
		occurrence := fixedOccurrence(tc.posting, tc.rule)
		fused := executionTestRuntime([]types.Account{executionTestAccount(account, floor)}, tc.balances)
		fusedResult, err := fused.ExecutePosting(occurrence, "2026-02-01", tc.historical)
		if err != nil {
			t.Fatalf("%s: fused: %v", tc.name, err)
		}
		split := executionTestRuntime([]types.Account{executionTestAccount(account, floor)}, tc.balances)
		prepared, err := PreparePostingExecution(occurrence, "2026-02-01", tc.historical, split.snapshotExecutionState(), nil)
		if err != nil {
			t.Fatalf("%s: prepare: %v", tc.name, err)
		}
		splitResult, err := split.ApplyPreparedExecution(prepared, "2026-02-01")
		if err != nil {
			t.Fatalf("%s: apply: %v", tc.name, err)
		}
		if !reflect.DeepEqual(fusedResult, splitResult) {
			t.Fatalf("%s: split %+v != fused %+v", tc.name, splitResult, fusedResult)
		}
		if !reflect.DeepEqual(fused.State.Balances, split.State.Balances) {
			t.Fatalf("%s: balances diverge: %v vs %v", tc.name, fused.State.Balances, split.State.Balances)
		}
		if !reflect.DeepEqual(fused.State.RealizedPostingAmountsByYear, split.State.RealizedPostingAmountsByYear) {
			t.Fatalf("%s: cap ledgers diverge", tc.name)
		}
	}
}

// Impossible states are handled entirely in the simulation half: the
// prepared request is untouched by clamping.
func TestApplyHandlesImpossibleStates(t *testing.T) {
	account := "checking"
	floor := 0.0
	ghost := "ghost"
	apply := func(prepared PreparedPostingExecution, balances map[string]float64) AccountTransactionResult {
		t.Helper()
		rt := executionTestRuntime([]types.Account{executionTestAccount(account, floor)}, balances)
		transition, err := rt.ApplyPreparedExecution(prepared, "2026-02-01")
		if err != nil {
			t.Fatal(err)
		}
		return transition.Result
	}
	mkPrepared := func(source *string, requested, cap float64, isLoss bool) PreparedPostingExecution {
		return PreparedPostingExecution{
			Posting:            &types.Posting{ID: "p", SourceAccountID: source},
			RequestedAmount:    requested,
			AnnualCapRemaining: cap,
			IsLoss:             isLoss,
		}
	}
	if got := apply(mkPrepared(&ghost, 50, math.Inf(1), false), map[string]float64{account: 100}); got.RealizedAmount != 0 {
		t.Fatalf("missing source realized %v, want 0", got.RealizedAmount)
	}
	if got := apply(mkPrepared(&account, 50, math.Inf(1), false), map[string]float64{account: 10}); got.RealizedAmount != 10 || got.RequestedAmount != 50 {
		t.Fatalf("overdraft not clamped to withdrawable: %+v", got)
	}
	if got := apply(mkPrepared(&account, 500, 100, false), map[string]float64{account: 1000}); got.RealizedAmount != 100 {
		t.Fatalf("cap not applied: %+v", got)
	}
	if got := apply(mkPrepared(&account, 0, math.Inf(1), false), map[string]float64{account: 1000}); got.RealizedAmount != 0 {
		t.Fatalf("zero request must realize zero: %+v", got)
	}
}

// The preprocessor owns schedule expansion: window filtering, disabled
// rules, claim suppression, and end-date clamping happen before the engine
// ever sees an occurrence.
func TestExpandProjectionSchedule(t *testing.T) {
	rule := func(id, start, end string, enabled bool) types.RecurrenceRule {
		r := types.RecurrenceRule{ID: id, Name: id, Frequency: types.FrequencyMonthly, StartDate: types.IsoDate(start), Priority: 1, Enabled: enabled}
		if end != "" {
			r.EndDate = (*types.IsoDate)(&end)
		}
		return r
	}
	claimed := types.Posting{
		ID: "actual", SourceAccountID: func() *string { s := "checking"; return &s }(),
		Claim:   &types.PostingClaim{RuleID: "rent", OccurrenceDate: "2026-02-01"},
		Enabled: true,
	}
	rules := []types.RecurrenceRule{
		rule("rent", "2026-01-01", "", true),
		rule("old", "2025-01-01", "2025-06-01", true),
		rule("off", "2026-01-01", "", false),
	}
	resolved := ExpandProjectionSchedule(rules, []types.Posting{claimed}, "2026-01-01", "2026-04-01", true)
	seen := map[string][]string{}
	for date, occurrences := range resolved.ByDate {
		for _, occurrence := range occurrences {
			seen[date] = append(seen[date], occurrence.Posting.ID)
		}
	}
	if len(seen["2026-01-01"]) != 1 || seen["2026-01-01"][0] != "rent" {
		t.Fatalf("January rent missing: %v", seen)
	}
	if len(seen["2026-02-01"]) != 0 {
		t.Fatalf("claimed February occurrence must be suppressed, got %v", seen["2026-02-01"])
	}
	for date := range seen {
		for _, id := range seen[date] {
			if id == "old" || id == "off" {
				t.Fatalf("ended or disabled rule expanded: %v", seen)
			}
		}
	}
	if len(seen) != 3 {
		t.Fatalf("expected three monthly occurrences, got %v", seen)
	}
}

// Monte Carlo stays opt-in: with nothing volatile to sample, one simulated
// path folded into every trial is bit-identical to N identical trials.
func TestStochasticShortCircuitMatchesFullRun(t *testing.T) {
	model := &types.FinancialModel{
		Accounts: []types.Account{{ID: "checking", Name: "Checking", Kind: types.AccountKindCash, Enabled: true}},
		Postings: []types.Posting{{
			ID: "bonus", Name: "Bonus", Destinations: []string{"checking"},
			Amount:          types.PostingAmountResolution{Resolver: "expression", Config: map[string]any{"expression": "100"}, Inputs: map[string]types.AmountInputBinding{}},
			PostedTime:      midnightUnix("2026-03-15"),
			TransactionTime: midnightUnix("2026-03-15"),
			Enabled:         true,
		}},
		Evaluations: types.EmptyEvaluationTables(),
	}
	settings := &types.ProjectionRuntimeSettings{FallbackProjectionStartDate: "2026-01-01", HorizonYears: 1, Evaluations: types.EmptyEvaluationTables()}
	if counts := buildSampleCountsByPostingId(model.RecurrenceRules, model.Postings, settings.HorizonYears, "2026-01-01", "2027-01-01", false); len(counts) != 0 {
		t.Fatalf("fixture must have no volatile inputs, got %v", counts)
	}
	seed := int64(7)
	config := types.StochasticConfig{RunCount: 8, Seed: &seed}
	first, err := StochasticProjection(context.Background(), model, settings, types.ModelOverrides{}, config, nil)
	if err != nil {
		t.Fatal(err)
	}
	second, err := StochasticProjection(context.Background(), model, settings, types.ModelOverrides{}, config, nil)
	if err != nil {
		t.Fatal(err)
	}
	if !reflect.DeepEqual(first.Bands, second.Bands) {
		t.Fatal("seeded short-circuit runs must agree")
	}
	deterministic, err := ProjectFinancialModel(model, settings, types.ModelOverrides{}, nil)
	if err != nil {
		t.Fatal(err)
	}
	want := map[string]float64{}
	for _, row := range deterministic.Timeline.Rows {
		want[string(row.Date)] = row.NetWorth
	}
	if len(first.Bands) != len(want) {
		t.Fatalf("band dates %d != timeline dates %d", len(first.Bands), len(want))
	}
	for _, band := range first.Bands {
		date := string(band.Date)
		if band.NetWorth.P10 != want[date] || band.NetWorth.P50 != want[date] || band.NetWorth.P90 != want[date] {
			t.Fatalf("band at %s is not the deterministic value: %+v vs %v", date, band.NetWorth, want[date])
		}
	}
}
