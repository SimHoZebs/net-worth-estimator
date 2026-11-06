package domain

import (
	"testing"

	"github.com/simhozebs/net-worth-estimator/backend/internal/types"
)

func finHealthStrPtr(value string) *string { return &value }

func finHealthFloat(value float64) *float64 { return &value }

func finHealthLiteralTransaction(id, name string, source *string, destinations []string, amount, day string) types.Transaction {
	stamp := midnightUnix(day)
	return types.Transaction{
		ID:              id,
		Name:            name,
		SourceAccountID: source,
		Destinations:    destinations,
		Amount:          types.TransactionAmountResolution{Resolver: "expression", Config: map[string]any{"expression": amount}},
		PostedTime:      stamp,
		TransactionTime: stamp,
		Enabled:         true,
	}
}

func finHealthFixture() (*types.FinancialModel, *types.CurrentPosition) {
	checking := "checking"
	model := &types.FinancialModel{
		SourcePath: "test",
		Accounts: []types.Account{
			{ID: "checking", Name: "Checking", Kind: types.AccountKindCash, Enabled: true},
			{ID: "card", Name: "Card", Kind: types.AccountKindDebt, MinBalance: finHealthFloat(-10000), Enabled: true},
		},
		PaymentTerms: []types.PaymentTerms{
			{AccountID: "card", MinimumFixed: 50, MinimumPercent: finHealthFloat(0.02), DueDay: 15},
		},
		Transactions: []types.Transaction{
			finHealthLiteralTransaction("pay-aug", "Pay", nil, []string{"checking"}, "3000", "2026-08-15"),
			finHealthLiteralTransaction("pay-sep", "Pay", nil, []string{"checking"}, "3000", "2026-09-15"),
			finHealthLiteralTransaction("pay-oct", "Pay", nil, []string{"checking"}, "3000", "2026-10-15"),
			finHealthLiteralTransaction("rent-aug", "Rent", &checking, nil, "1500", "2026-08-05"),
			finHealthLiteralTransaction("rent-sep", "Rent", &checking, nil, "1500", "2026-09-05"),
			finHealthLiteralTransaction("rent-oct", "Rent", &checking, nil, "1500", "2026-10-05"),
		},
	}
	position := &types.CurrentPosition{
		AsOfDate: "2026-10-31",
		NetWorth: 7000,
		Accounts: []types.PositionAccount{
			{AccountID: "checking", Balance: 9000},
			{AccountID: "card", Balance: -2000},
		},
	}
	return model, position
}

func finHealthCheckByID(report types.FinancialHealthReport, checkID string) types.FinancialHealthCheckResult {
	for _, check := range report.Checks {
		if check.CheckID == checkID {
			return check
		}
	}
	return types.FinancialHealthCheckResult{}
}

func TestEvaluateFinancialHealthOrderAndContracts(t *testing.T) {
	model, position := finHealthFixture()
	report := EvaluateFinancialHealth(model, position, types.DefaultFinancialHealthStandards())
	if len(report.Checks) != len(types.FinancialHealthCheckOrder) {
		t.Fatalf("checks = %d, want %d", len(report.Checks), len(types.FinancialHealthCheckOrder))
	}
	for index, checkID := range types.FinancialHealthCheckOrder {
		if report.Checks[index].CheckID != checkID {
			t.Fatalf("checks[%d] = %q, want %q", index, report.Checks[index].CheckID, checkID)
		}
		check := report.Checks[index]
		if len(check.Input) == 0 && check.Status != types.FinancialHealthInsufficientData {
			t.Fatalf("%s: non-insufficient check must show input", checkID)
		}
		if check.Status != types.FinancialHealthInsufficientData && (check.Calculation == "" || len(check.Threshold) == 0 || len(check.Evidence) == 0) {
			t.Fatalf("%s: check must show calculation, threshold, and evidence", checkID)
		}
	}
	// Health checks are descriptive and must not collide with projection-goal
	// evaluation types.
	for _, checkID := range types.FinancialHealthCheckOrder {
		for _, evaluationType := range types.EvaluationTypeOrder {
			if checkID == evaluationType {
				t.Fatalf("health check %q collides with a projection evaluation type", checkID)
			}
		}
	}
}

func TestEvaluateFinancialHealthMeetingFixture(t *testing.T) {
	model, position := finHealthFixture()
	report := EvaluateFinancialHealth(model, position, types.DefaultFinancialHealthStandards())
	want := map[string]types.FinancialHealthStatus{
		types.FinancialHealthCheckEmergencyCoverage:      types.FinancialHealthMeeting,
		types.FinancialHealthCheckCashFlowSustainability: types.FinancialHealthMeeting,
		types.FinancialHealthCheckDebtBurden:             types.FinancialHealthMeeting,
		types.FinancialHealthCheckHighInterestDebt:       types.FinancialHealthNotMeeting,
		types.FinancialHealthCheckSavingsRate:            types.FinancialHealthMeeting,
		types.FinancialHealthCheckUtilization:            types.FinancialHealthMeeting,
		types.FinancialHealthCheckSpendingConsistency:    types.FinancialHealthMeeting,
	}
	for checkID, status := range want {
		if got := finHealthCheckByID(report, checkID).Status; got != status {
			t.Fatalf("%s = %q, want %q", checkID, got, status)
		}
	}
	if report.FlowCoverage.WindowTransactions != 6 || report.FlowCoverage.ResolvedTransactions != 6 || report.FlowCoverage.ExcludedTransactions != 0 {
		t.Fatalf("coverage = %+v, want 6 considered and resolved", report.FlowCoverage)
	}
	if report.FlowCoverage.InflowTotal != 9000 || report.FlowCoverage.OutflowTotal != 4500 {
		t.Fatalf("flow totals = %.0f/%.0f, want 9000/4500", report.FlowCoverage.InflowTotal, report.FlowCoverage.OutflowTotal)
	}
}

func TestEvaluateFinancialHealthAdjustableStandards(t *testing.T) {
	model, position := finHealthFixture()
	standards := types.DefaultFinancialHealthStandards()
	standards.EmergencyMeetMonths = 6
	standards.EmergencyRiskMonths = 3
	standards.DebtBurdenMeetRatio = 0.01
	standards.DebtBurdenRiskRatio = 0.015
	standards.CarriedBalanceTolerance = 5000
	standards.CarriedBalanceRiskAmount = 9000
	report := EvaluateFinancialHealth(model, position, standards)
	// Coverage is ~5.9 months: at-risk under a 6-month guideline.
	if got := finHealthCheckByID(report, types.FinancialHealthCheckEmergencyCoverage).Status; got != types.FinancialHealthAtRisk {
		t.Fatalf("emergency = %q, want at-risk under stricter standards", got)
	}
	// Burden is ~0.016: not meeting under a 1% guideline.
	if got := finHealthCheckByID(report, types.FinancialHealthCheckDebtBurden).Status; got != types.FinancialHealthNotMeeting {
		t.Fatalf("debt burden = %q, want not-meeting under stricter standards", got)
	}
	// Carried 2000 is within a 5000 tolerance.
	if got := finHealthCheckByID(report, types.FinancialHealthCheckHighInterestDebt).Status; got != types.FinancialHealthMeeting {
		t.Fatalf("high-interest = %q, want meeting under looser standards", got)
	}
	for _, check := range report.Checks {
		if check.Status == types.FinancialHealthInsufficientData {
			continue
		}
		if check.Summary == "" {
			t.Fatalf("%s: summary must reference the outcome in plain language", check.CheckID)
		}
	}
}

func TestEvaluateFinancialHealthInsufficientData(t *testing.T) {
	model, position := finHealthFixture()
	model.Transactions = nil
	report := EvaluateFinancialHealth(model, position, types.DefaultFinancialHealthStandards())
	for _, checkID := range []string{
		types.FinancialHealthCheckEmergencyCoverage,
		types.FinancialHealthCheckCashFlowSustainability,
		types.FinancialHealthCheckSavingsRate,
		types.FinancialHealthCheckSpendingConsistency,
	} {
		if got := finHealthCheckByID(report, checkID).Status; got != types.FinancialHealthInsufficientData {
			t.Fatalf("%s = %q, want insufficient-data without flows", checkID, got)
		}
	}
	// Balance-only checks still answer without flows.
	if got := finHealthCheckByID(report, types.FinancialHealthCheckHighInterestDebt).Status; got != types.FinancialHealthNotMeeting {
		t.Fatalf("high-interest = %q, want not-meeting from balances alone", got)
	}
}

func TestEvaluateFinancialHealthExclusions(t *testing.T) {
	model, position := finHealthFixture()
	checking := "checking"
	stamp := midnightUnix("2026-09-10")
	model.Transactions = append(model.Transactions,
		// Unresolvable descriptor: counted, never silently dropped.
		types.Transaction{
			ID: "mystery", Name: "Mystery", Destinations: []string{"checking"},
			Amount:          types.TransactionAmountResolution{Resolver: "does-not-exist"},
			PostedTime:      stamp,
			TransactionTime: stamp,
			Enabled:         true,
		},
		// Never moved balances: pending, void, disabled.
		types.Transaction{
			ID: "pending", Name: "Pending", SourceAccountID: &checking,
			Amount:          types.TransactionAmountResolution{Resolver: "expression", Config: map[string]any{"expression": "999"}},
			PostedTime:      stamp,
			TransactionTime: stamp,
			Enabled:         true,
			Pending:         true,
		},
		types.Transaction{
			ID: "voided", Name: "Voided", SourceAccountID: &checking,
			Amount:          types.TransactionAmountResolution{Resolver: "expression", Config: map[string]any{"expression": "999"}},
			PostedTime:      stamp,
			TransactionTime: stamp,
			Enabled:         true,
			Void:            true,
		},
		types.Transaction{
			ID: "off", Name: "Off", SourceAccountID: &checking,
			Amount:          types.TransactionAmountResolution{Resolver: "expression", Config: map[string]any{"expression": "999"}},
			PostedTime:      stamp,
			TransactionTime: stamp,
		},
		// Internal transfer: not income or spending.
		types.Transaction{
			ID: "move", Name: "Move", SourceAccountID: &checking, Destinations: []string{"checking"},
			Amount:          types.TransactionAmountResolution{Resolver: "expression", Config: map[string]any{"expression": "999"}},
			PostedTime:      stamp,
			TransactionTime: stamp,
			Enabled:         true,
		},
		// Outside the window.
		finHealthLiteralTransaction("old", "Old", &checking, nil, "999", "2026-01-05"),
	)
	report := EvaluateFinancialHealth(model, position, types.DefaultFinancialHealthStandards())
	if report.FlowCoverage.WindowTransactions != 7 || report.FlowCoverage.ResolvedTransactions != 6 || report.FlowCoverage.ExcludedTransactions != 1 {
		t.Fatalf("coverage = %+v, want 7/6/1", report.FlowCoverage)
	}
	if len(report.FlowCoverage.ExcludedIDs) != 1 || report.FlowCoverage.ExcludedIDs[0] != "mystery" {
		t.Fatalf("excluded = %v, want [mystery]", report.FlowCoverage.ExcludedIDs)
	}
	if report.FlowCoverage.OutflowTotal != 4500 {
		t.Fatalf("outflow = %.0f, want 4500", report.FlowCoverage.OutflowTotal)
	}
}

func TestEvaluateFinancialHealthExcludesStatefulAmounts(t *testing.T) {
	model, position := finHealthFixture()
	checking := "checking"
	stamp := midnightUnix("2026-09-10")
	// Resolves cleanly against as-of balances (9000) but describes no
	// recorded flow: live-balance providers must be excluded evidence.
	model.Transactions = append(model.Transactions, types.Transaction{
		ID: "live-balance", Name: "Live", SourceAccountID: &checking,
		Amount: types.TransactionAmountResolution{
			Resolver: "expression",
			Config:   map[string]any{"expression": "balance"},
			Inputs: map[string]types.AmountInputBinding{
				"balance": {Source: "provider", Provider: "account-balance", Arguments: map[string]any{"id": "checking"}},
			},
		},
		PostedTime:      stamp,
		TransactionTime: stamp,
		Enabled:         true,
	})
	report := EvaluateFinancialHealth(model, position, types.DefaultFinancialHealthStandards())
	if report.FlowCoverage.ExcludedTransactions != 1 || report.FlowCoverage.ExcludedIDs[0] != "live-balance" {
		t.Fatalf("coverage = %+v, want live-balance excluded", report.FlowCoverage)
	}
	if report.FlowCoverage.OutflowTotal != 4500 {
		t.Fatalf("outflow = %.0f, want 4500 without the live-balance amount", report.FlowCoverage.OutflowTotal)
	}
}

func TestEvaluateFinancialHealthSpendingBands(t *testing.T) {
	cases := []struct {
		name    string
		amounts []string
		want    types.FinancialHealthStatus
	}{
		{"steady", []string{"1500", "1500", "1500"}, types.FinancialHealthMeeting},
		{"at risk", []string{"1000", "1500", "2500"}, types.FinancialHealthAtRisk},
		{"not meeting", []string{"500", "1500", "4000"}, types.FinancialHealthNotMeeting},
	}
	for _, testCase := range cases {
		t.Run(testCase.name, func(t *testing.T) {
			model, position := finHealthFixture()
			checking := "checking"
			transactions := model.Transactions[:3]
			days := []string{"2026-08-05", "2026-09-05", "2026-10-05"}
			for index, amount := range testCase.amounts {
				transactions = append(transactions, finHealthLiteralTransaction("rent-"+days[index], "Rent", &checking, nil, amount, days[index]))
			}
			model.Transactions = transactions
			report := EvaluateFinancialHealth(model, position, types.DefaultFinancialHealthStandards())
			if got := finHealthCheckByID(report, types.FinancialHealthCheckSpendingConsistency).Status; got != testCase.want {
				t.Fatalf("consistency = %q, want %q", got, testCase.want)
			}
		})
	}
}

func TestEvaluateFinancialHealthMissingState(t *testing.T) {
	for _, testCase := range []struct {
		name     string
		model    *types.FinancialModel
		position *types.CurrentPosition
	}{
		{"nil model", nil, &types.CurrentPosition{AsOfDate: "2026-10-31"}},
		{"nil position", &types.FinancialModel{}, nil},
		{"bad date", &types.FinancialModel{}, &types.CurrentPosition{AsOfDate: "not-a-date"}},
	} {
		t.Run(testCase.name, func(t *testing.T) {
			report := EvaluateFinancialHealth(testCase.model, testCase.position, types.DefaultFinancialHealthStandards())
			if len(report.Checks) != len(types.FinancialHealthCheckOrder) {
				t.Fatalf("checks = %d, want full order even without state", len(report.Checks))
			}
			for _, check := range report.Checks {
				if check.Status != types.FinancialHealthInsufficientData {
					t.Fatalf("%s = %q, want insufficient-data", check.CheckID, check.Status)
				}
			}
		})
	}
}

func TestNormalizeFinancialHealthStandards(t *testing.T) {
	normalized := NormalizeFinancialHealthStandards(types.FinancialHealthStandards{})
	if normalized.LookbackDays < 7 {
		t.Fatalf("lookback = %d, want a usable window", normalized.LookbackDays)
	}
	if len(normalized.LiquidAccountKinds) == 0 {
		t.Fatalf("liquid kinds must default so emergency coverage has an input")
	}
	inverted := types.DefaultFinancialHealthStandards()
	inverted.EmergencyMeetMonths, inverted.EmergencyRiskMonths = 1, 3
	inverted.UtilizationMeetRatio, inverted.UtilizationRiskRatio = 0.5, 0.3
	normalized = NormalizeFinancialHealthStandards(inverted)
	if normalized.EmergencyMeetMonths < normalized.EmergencyRiskMonths || normalized.UtilizationMeetRatio > normalized.UtilizationRiskRatio {
		t.Fatalf("bands not ordered: %+v", normalized)
	}
}
