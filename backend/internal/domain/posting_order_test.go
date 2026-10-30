package domain

import (
	"reflect"
	"testing"

	"github.com/simhozebs/net-worth-estimator/backend/internal/types"
)

func TestEqualTimePostingExecutionDoesNotDependOnIdentity(t *testing.T) {
	account := "checking"
	floor := 0.0
	amount := types.PostingAmountResolution{Resolver: "expression", Config: map[string]any{"expression": "10"}, Inputs: map[string]types.AmountInputBinding{}}
	model := &types.FinancialModel{
		Accounts:    []types.Account{{ID: account, Name: "Checking", Kind: types.AccountKindCash, MinBalance: &floor, Enabled: true}},
		Checkpoints: []types.Checkpoint{{AccountID: account, Balance: 0, ObservedAt: 1767311999}, {AccountID: account, ObservedAt: 1767398399, Balance: 10}},
		Postings: []types.Posting{
			{ID: "z-inflow", Name: "Inflow", Destinations: []string{account}, Amount: amount, PostedTime: midnightUnix("2026-01-02"), TransactionTime: midnightUnix("2026-01-02"), ExecutionOrder: 2, Enabled: true},
			{ID: "a-outflow", Name: "Outflow", SourceAccountID: &account, Amount: amount, PostedTime: midnightUnix("2026-01-02"), TransactionTime: midnightUnix("2026-01-02"), ExecutionOrder: 1, Enabled: true},
		},
		Evaluations: types.EmptyEvaluationTables(),
	}
	_, before, _, err := replayHistoricalState(model, "2026-01-03")
	if err != nil {
		t.Fatal(err)
	}
	model.Postings[0].ID = "01900000-0000-7000-8000-000000000001"
	model.Postings[1].ID = "01900000-0000-7000-8000-000000000002"
	_, after, _, err := replayHistoricalState(model, "2026-01-03")
	if err != nil {
		t.Fatal(err)
	}
	if !reflect.DeepEqual(before, after) {
		t.Fatal("identity replacement changed checkpoint corrections")
	}
	correction := after[len(after)-1].CheckpointCorrections[0]
	// Historical actuals execute at their recorded amounts without
	// hypothetical funding clamps (forecasts retain clamps): the outflow
	// moves 10 even from an empty account, then the inflow returns it.
	if correction.ModeledBalance != 0 || correction.Adjustment != 10 {
		t.Fatalf("equal-time execution order changed: %+v", correction)
	}
	// Projection execution shares history's ordering, even if display position differs.
	resolved := ResolveOccurrences(nil, model.Postings, "2026-01-02", "2026-01-02", true)
	occurrences := resolved.ByDate["2026-01-02"]
	sortOccurrences(occurrences)
	if occurrences[0].Posting.ExecutionOrder != 1 {
		t.Fatal("projection order differs from history order")
	}
}
