package domain

import (
	"testing"

	"github.com/simhozebs/net-worth-estimator/backend/internal/types"
)

func row(date string, historical bool, netWorth float64, balances map[string]float64) types.ProjectionRow {
	snapshots := make([]types.AccountSnapshot, 0, len(balances))
	for accountID, balance := range balances {
		snapshots = append(snapshots, types.AccountSnapshot{AccountID: accountID, Date: types.IsoDate(date), Balance: balance})
	}
	return types.ProjectionRow{
		Date:             types.IsoDate(date),
		IsHistorical:     historical,
		NetWorth:         netWorth,
		AccountSnapshots: snapshots,
	}
}

func pathOf(rows ...types.ProjectionRow) *types.ProjectionPath {
	return &types.ProjectionPath{Rows: rows}
}

func TestEvaluateAccountBalanceFindsFirstProjectedCrossing(t *testing.T) {
	path := pathOf(
		row("2026-01-01", false, 0, map[string]float64{"checking": 1000, "loan": -2000}),
		row("2026-06-01", false, 0, map[string]float64{"checking": 20000, "loan": -1500}),
		row("2026-12-01", false, 0, map[string]float64{"checking": 31000, "loan": -1000}),
	)
	result := EvaluateAccountBalance(path, "checking", 30000)
	if !result.Reached {
		t.Fatalf("expected reached, got %+v", result)
	}
	if result.FirstReachedDate == nil || *result.FirstReachedDate != "2026-12-01" {
		t.Fatalf("first reached date = %v, want 2026-12-01", result.FirstReachedDate)
	}
}

func TestEvaluateAccountBalanceIgnoresHistoricalRows(t *testing.T) {
	// The account was above target in recorded history. That is a fact about
	// the past, not a projection outcome, so it must not satisfy the goal.
	path := pathOf(
		row("2025-01-01", true, 0, map[string]float64{"checking": 90000}),
		row("2026-01-01", false, 0, map[string]float64{"checking": 1000}),
	)
	result := EvaluateAccountBalance(path, "checking", 30000)
	if result.Reached {
		t.Fatalf("historical balance must not satisfy a goal: %+v", result)
	}
	if result.FirstReachedDate != nil {
		t.Fatalf("first reached date = %v, want nil", *result.FirstReachedDate)
	}
}

func TestEvaluateAccountBalanceSkipsRowsWithoutTheAccount(t *testing.T) {
	// A row that omits the account is unknown, not zero. Treating it as zero
	// could report a crossing for an account that was never tracked there.
	path := pathOf(
		row("2026-01-01", false, 0, map[string]float64{"loan": -2000}),
		row("2026-02-01", false, 0, map[string]float64{"loan": -1500, "checking": 40000}),
	)
	result := EvaluateAccountBalance(path, "checking", 30000)
	if !result.Reached || result.FirstReachedDate == nil || *result.FirstReachedDate != "2026-02-01" {
		t.Fatalf("expected first crossing on the row that carries the account, got %+v", result)
	}
}

func TestEvaluateAccountBalanceCountsExactTarget(t *testing.T) {
	path := pathOf(row("2026-03-01", false, 0, map[string]float64{"checking": 30000}))
	if result := EvaluateAccountBalance(path, "checking", 30000); !result.Reached {
		t.Fatalf("balance equal to target should satisfy the goal: %+v", result)
	}
}

func TestEvaluateAccountBalanceNotReached(t *testing.T) {
	path := pathOf(row("2026-01-01", false, 0, map[string]float64{"checking": 29999.99}))
	if result := EvaluateAccountBalance(path, "checking", 30000); result.Reached {
		t.Fatalf("expected not reached, got %+v", result)
	}
}

// A goal on an empty path must not report a crossing.
func TestEvaluateAccountBalanceEmptyPath(t *testing.T) {
	if result := EvaluateAccountBalance(pathOf(), "checking", 1); result.Reached {
		t.Fatalf("empty path must not be reached: %+v", result)
	}
}

func TestValidateAccountBalanceConfig(t *testing.T) {
	cases := []struct {
		name    string
		config  any
		wantErr bool
	}{
		{"valid", map[string]any{"accountId": "checking", "target": 30000.0}, false},
		{"missing account", map[string]any{"target": 30000.0}, true},
		{"empty account", map[string]any{"accountId": "", "target": 30000.0}, true},
		{"missing target", map[string]any{"accountId": "checking"}, true},
		{"non-numeric target", map[string]any{"accountId": "checking", "target": "30000"}, true},
		{"not an object", "checking", true},
	}
	for _, testCase := range cases {
		t.Run(testCase.name, func(t *testing.T) {
			err := ValidateAccountBalanceConfig(testCase.config)
			if testCase.wantErr && err == nil {
				t.Fatalf("expected an error, got nil")
			}
			if !testCase.wantErr && err != nil {
				t.Fatalf("expected no error, got %v", err)
			}
		})
	}
}

func TestParseAccountBalanceConfig(t *testing.T) {
	parsed, err := ParseAccountBalanceConfig(map[string]any{"accountId": "brokerage", "target": 250000.0})
	if err != nil {
		t.Fatalf("parse: %v", err)
	}
	if parsed.AccountID != "brokerage" || parsed.Target != 250000 {
		t.Fatalf("parsed = %+v", parsed)
	}
}

func TestAccountBalanceDefinitionIsRegistered(t *testing.T) {
	definition, ok := EvaluationRegistryInstance.Get(types.EvaluationTypeAccountBalance)
	if !ok {
		t.Fatalf("account balance evaluator is not registered")
	}
	if definition.Label == "" {
		t.Fatalf("account balance evaluator needs a label")
	}
}

func TestAccountBalanceSharesThresholdAccumulatorShape(t *testing.T) {
	// Both threshold-style evaluations must produce the same probabilistic
	// shape, otherwise the frontend has to special-case one of them.
	threshold := finalizeReachedDates(&thresholdAccumulator{
		totalRuns:    4,
		reachedDates: []string{"2027-01-01", "2027-01-01", "2028-01-01"},
	})
	thresholdMap, ok := threshold.(map[string]any)
	if !ok {
		t.Fatalf("finalize returned %T", threshold)
	}
	if probability, _ := thresholdMap["probability"].(float64); probability != 0.75 {
		t.Fatalf("probability = %v, want 0.75", thresholdMap["probability"])
	}
	for _, key := range []string{"p10ReachedDate", "medianReachedDate", "p90ReachedDate"} {
		if _, present := thresholdMap[key]; !present {
			t.Fatalf("probabilistic result missing %q", key)
		}
	}
}

// A goal pointing at an account the document does not contain must be reported
// rather than silently evaluating as never reached.
func TestValidateFinancialModelFlagsDanglingAccountBalanceGoal(t *testing.T) {
	document := &types.FinancialModelDocument{
		SourcePath: "test",
		Accounts: []types.Account{
			{ID: "checking", Label: "Checking", Enabled: true},
		},
		Checkpoints: []types.Checkpoint{},
		Postings:    []types.Posting{},
		Evaluations: types.EvaluationTables{
			AccountBalance: []types.BalanceEvaluation{{
				InstanceID: "ghost-goal",
				Label:      "Ghost",
				Enabled:    true,
				Config:     map[string]any{"accountId": "does-not-exist", "target": 100.0},
			}},
		},
	}
	issues := ValidateFinancialModel(document, nil)
	found := false
	for _, issue := range issues {
		if issue.Code == "evaluation.accountBalance.accountId.invalid" {
			found = true
		}
	}
	if !found {
		t.Fatalf("expected a dangling account reference issue, got %+v", issues)
	}
}
