package domain

import (
	"testing"

	"github.com/simhozebs/net-worth-estimator/backend/internal/types"
)

// Finance-first lifecycle: ordinary records and historical current
// position work independently of every evaluation-owned check (config
// shape, dangling references, instance identity), while simulation keeps
// full validation and finance writes reject only newly introduced
// evaluation orphans.

func financeFixtureWithBrokenForecast(t *testing.T) *types.FinancialModel {
	t.Helper()
	model := observerFixture()
	model.Evaluations.NetWorthThreshold = []types.ThresholdEvaluation{{
		InstanceID: "broken-threshold",
		Name:       "Broken",
		Enabled:    true,
		Config:     map[string]any{"target": "not-a-number"},
	}}
	return model
}

func financeFixtureWithDanglingForecast(t *testing.T) *types.FinancialModel {
	t.Helper()
	model := observerFixture()
	model.Evaluations.AccountBalance = []types.BalanceEvaluation{{
		InstanceID: "ghost-watch",
		Name:       "Ghost",
		Enabled:    true,
		Config:     map[string]any{"accountId": "does-not-exist", "target": 100.0},
	}}
	return model
}

func financeFixtureWithDuplicateForecastID(t *testing.T) *types.FinancialModel {
	t.Helper()
	model := observerFixture()
	model.Evaluations.NetWorthThreshold = []types.ThresholdEvaluation{{
		InstanceID: "shared-id",
		Name:       "First",
		Enabled:    true,
		Config:     map[string]any{"target": 100.0},
	}}
	model.Evaluations.AccountBalance = []types.BalanceEvaluation{{
		InstanceID: "shared-id",
		Name:       "Second",
		Enabled:    true,
		Config:     map[string]any{"accountId": "checking", "target": 100.0},
	}}
	return model
}

func hasErrorCode(issues []types.ModelValidationIssue, code string) bool {
	for _, issue := range issues {
		if issue.Severity == types.SeverityError && issue.Code == code {
			return true
		}
	}
	return false
}

func hasAnyError(issues []types.ModelValidationIssue) bool {
	for _, issue := range issues {
		if issue.Severity == types.SeverityError {
			return true
		}
	}
	return false
}

func TestFinanceValidationIgnoresEveryEvaluationOwnedCheck(t *testing.T) {
	broken := financeFixtureWithBrokenForecast(t)
	if issues := ValidateFinanceModel(broken); hasAnyError(issues) {
		t.Fatalf("finance validation must pass with broken forecast config, got %+v", issues)
	}
	if issues := ValidateFinancialModel(broken); !hasErrorCode(issues, "evaluation.config.invalid") {
		t.Fatalf("full validation must still flag broken forecast config, got %+v", issues)
	}

	dangling := financeFixtureWithDanglingForecast(t)
	if issues := ValidateFinanceModel(dangling); hasAnyError(issues) {
		t.Fatalf("finance validation must pass with dangling forecast reference, got %+v", issues)
	}
	if issues := ValidateFinancialModel(dangling); !hasErrorCode(issues, "evaluation.accountBalance.accountId.invalid") {
		t.Fatalf("full validation must still flag dangling forecast reference, got %+v", issues)
	}

	duplicate := financeFixtureWithDuplicateForecastID(t)
	if issues := ValidateFinanceModel(duplicate); hasAnyError(issues) {
		t.Fatalf("finance validation must pass with duplicate forecast ID, got %+v", issues)
	}
	if issues := ValidateFinancialModel(duplicate); !hasErrorCode(issues, "evaluation.instanceId.duplicate") {
		t.Fatalf("full validation must still flag duplicate forecast ID, got %+v", issues)
	}
}

func TestCurrentPositionIndependentOfEveryEvaluationOwnedCheck(t *testing.T) {
	models := map[string]*types.FinancialModel{
		"broken config": financeFixtureWithBrokenForecast(t),
		"dangling ref":  financeFixtureWithDanglingForecast(t),
		"duplicate ID":  financeFixtureWithDuplicateForecastID(t),
	}
	for name, model := range models {
		position, err := ResolveCurrentPosition(model, "2026-03-10T12:00:00Z", types.ModelOverrides{})
		if err != nil {
			t.Fatalf("%s: current position must not fail, got %v", name, err)
		}
		if got := position.Accounts[0].Balance; got != 900 {
			t.Fatalf("%s: adjusted balance = %v, want 900", name, got)
		}
	}
}

func TestProjectionStillRejectsEveryEvaluationOwnedCheck(t *testing.T) {
	models := map[string]struct {
		model *types.FinancialModel
		code  string
	}{
		"broken config": {financeFixtureWithBrokenForecast(t), "evaluation.config.invalid"},
		"dangling ref":  {financeFixtureWithDanglingForecast(t), "evaluation.accountBalance.accountId.invalid"},
		"duplicate ID":  {financeFixtureWithDuplicateForecastID(t), "evaluation.instanceId.duplicate"},
	}
	for name, test := range models {
		settings := &types.ProjectionRuntimeSettings{
			FallbackProjectionStartDate: "2026-03-10",
			HorizonYears:                1,
		}
		_, err := PrepareSimulationRequest(test.model, settings, types.ModelOverrides{}, nil)
		preparationError, ok := err.(*SimulationPreparationError)
		if !ok {
			t.Fatalf("%s: projection must reject, got %v", name, err)
		}
		if !hasErrorCode(preparationError.Issues, test.code) {
			t.Fatalf("%s: rejection must carry %s, got %+v", name, test.code, preparationError.Issues)
		}
	}
}

func TestFinanceWriteChangeBlocksNewOrphanButToleratesPreexisting(t *testing.T) {
	watched := observerFixture()
	watched.Evaluations.AccountBalance = []types.BalanceEvaluation{{
		InstanceID: "watch-checking",
		Name:       "Watch",
		Enabled:    true,
		Config:     map[string]any{"accountId": "checking", "target": 100.0},
	}}
	baseline := EvaluationReferenceIssues(watched)

	// Deleting the referenced account introduces a new orphan: blocked.
	deleted := observerFixture()
	deleted.Accounts = []types.Account{}
	deleted.Evaluations.AccountBalance = watched.Evaluations.AccountBalance
	if issues := ValidateFinanceWriteChange(baseline, deleted); !hasErrorCode(issues, "evaluation.accountBalance.accountId.invalid") {
		t.Fatalf("write must block newly orphaned evaluation reference, got %+v", issues)
	}

	// Repairing an unrelated row with the reference intact: allowed.
	renamed := observerFixture()
	renamed.Accounts[0].Name = "Renamed"
	renamed.Evaluations.AccountBalance = watched.Evaluations.AccountBalance
	if issues := ValidateFinanceWriteChange(baseline, renamed); hasAnyError(issues) {
		t.Fatalf("write must allow unrelated repair, got %+v", issues)
	}

	// Preexisting dangling reference plus unrelated repair: allowed.
	dangling := financeFixtureWithDanglingForecast(t)
	danglingBaseline := EvaluationReferenceIssues(dangling)
	repaired := financeFixtureWithDanglingForecast(t)
	repaired.Accounts[0].Name = "Renamed"
	if issues := ValidateFinanceWriteChange(danglingBaseline, repaired); hasAnyError(issues) {
		t.Fatalf("write must tolerate preexisting dangling reference, got %+v", issues)
	}

	// Preexisting broken config plus unrelated repair: allowed.
	broken := financeFixtureWithBrokenForecast(t)
	brokenBaseline := EvaluationReferenceIssues(broken)
	brokenRepaired := financeFixtureWithBrokenForecast(t)
	brokenRepaired.Accounts[0].Name = "Renamed"
	if issues := ValidateFinanceWriteChange(brokenBaseline, brokenRepaired); hasAnyError(issues) {
		t.Fatalf("write must tolerate preexisting broken config, got %+v", issues)
	}

	// Real finance errors still block, even with preexisting forecast breakage.
	invalid := financeFixtureWithDanglingForecast(t)
	ghost := "does-not-exist"
	invalid.Postings[0].SourceAccountID = &ghost
	if issues := ValidateFinanceWriteChange(danglingBaseline, invalid); !hasErrorCode(issues, "posting.source.missing") {
		t.Fatalf("write must keep finance route checks, got %+v", issues)
	}
}

func TestFinanceValidationStillEnforcesFinanceRules(t *testing.T) {
	model := observerFixture()
	ghost := "does-not-exist"
	model.Postings[0].SourceAccountID = &ghost
	if issues := ValidateFinanceModel(model); !hasErrorCode(issues, "posting.source.missing") {
		t.Fatalf("finance validation must keep finance route checks, got %+v", issues)
	}
}

func TestFinanceWriteChangeRetainsFinanceWarnings(t *testing.T) {
	model := financeFixtureWithBrokenForecast(t)
	model.Accounts[0].Enabled = true
	model.Accounts[0].Color = nil
	issues := ValidateFinanceWriteChange(EvaluationReferenceIssues(model), model)
	if hasAnyError(issues) {
		t.Fatalf("unrelated forecast config must not block write: %+v", issues)
	}
	for _, issue := range issues {
		if issue.Severity == types.SeverityWarning && issue.Code == "account.color.missing" {
			return
		}
	}
	t.Fatalf("finance write must retain finance warnings: %+v", issues)
}
