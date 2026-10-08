package domain

import (
	"testing"

	"github.com/simhozebs/net-worth-estimator/backend/internal/types"
)

// Multiple enabled income postings resolve independently through their own
// sources. The pipeline keys everything by source ID and executes per
// occurrence, so a domestic salary and a foreign contract coexist.

func multiIncomeModel() (types.FinancialModel, *types.IncomeDataSnapshot) {
	model := types.FinancialModel{
		Accounts: []types.Account{
			{ID: "checking", Name: "Checking", Kind: types.AccountKindCash, Enabled: true},
			{ID: "savings", Name: "Savings", Kind: types.AccountKindCash, Enabled: true},
		},
		Postings: []types.Posting{
			{
				ID: "salary", Name: "Salary", Destinations: []string{"checking"},
				Amount: types.PostingAmountResolution{
					Resolver: "income",
					Config: map[string]any{
						"incomeSourceId": "salary",
						"resolvers":      []any{},
					},
					Inputs: map[string]types.AmountInputBinding{},
				},
				Frequency: types.FrequencyMonthly,
				StartDate: "2026-09-01",
				Priority:  1,
				Enabled:   true,
			},
			{
				ID: "contract", Name: "Foreign contract", Destinations: []string{"savings"},
				Amount: types.PostingAmountResolution{
					Resolver: "income",
					Config: map[string]any{
						"incomeSourceId": "contract",
						"resolvers":      []any{},
					},
					Inputs: map[string]types.AmountInputBinding{},
				},
				Frequency: types.FrequencyMonthly,
				StartDate: "2026-09-01",
				Priority:  2,
				Enabled:   true,
			},
		},
	}
	incomeData := &types.IncomeDataSnapshot{
		IncomeSources: []types.IncomeSourceDefinition{
			{ID: "salary", Name: "Salary", EffectiveFrom: "2026-01-01", AnnualGrossIncome: 120000},
			{ID: "contract", Name: "Foreign contract", EffectiveFrom: "2026-01-01", AnnualGrossIncome: 60000},
		},
		TaxProfiles: []types.IncomeTaxProfile{},
	}
	return model, incomeData
}

func TestTwoEnabledIncomePostingsValidate(t *testing.T) {
	model, _ := multiIncomeModel()
	document := &types.FinancialModelDocument{
		SourcePath:  "test",
		Accounts:    model.Accounts,
		Checkpoints: []types.Checkpoint{},
		Evaluations: types.EmptyEvaluationTables(),
		Postings:    model.Postings,
	}
	for _, issue := range ValidateFinancialModel(document, nil) {
		if issue.Code == "posting.income.multiple" {
			t.Fatalf("multiple income postings must validate: %+v", issue)
		}
	}
}

func TestOtherIncomeRulesStillApply(t *testing.T) {
	model, _ := multiIncomeModel()
	withSource := "checking"
	model.Postings[0].SourceAccountID = &withSource
	document := &types.FinancialModelDocument{
		SourcePath:  "test",
		Accounts:    model.Accounts,
		Checkpoints: []types.Checkpoint{},
		Evaluations: types.EmptyEvaluationTables(),
		Postings:    model.Postings,
	}
	found := false
	for _, issue := range ValidateFinancialModel(document, nil) {
		if issue.Code == "posting.income.source.invalid" {
			found = true
		}
	}
	if !found {
		t.Fatalf("expected posting.income.source.invalid to still fire")
	}
}

func TestTwoIncomeSourcesResolveIndependently(t *testing.T) {
	model, incomeData := multiIncomeModel()
	runtime, err := CreateTransitionRuntime(model, SimulationState{
		Balances:                     map[string]float64{"checking": 0, "savings": 0},
		LatestRealizedPostingAmounts: map[string]float64{},
		RealizedPostingAmountsByYear: map[string]map[string]float64{},
	}, "2026-09-01", nil, incomeData)
	if err != nil {
		t.Fatalf("create runtime: %v", err)
	}
	salary, err := runtime.ExecutePosting(DatedPostingOccurrence{Posting: &model.Postings[0], Index: 0}, "2026-09-01")
	if err != nil {
		t.Fatalf("execute salary: %v", err)
	}
	contract, err := runtime.ExecutePosting(DatedPostingOccurrence{Posting: &model.Postings[1], Index: 1}, "2026-09-01")
	if err != nil {
		t.Fatalf("execute contract: %v", err)
	}
	if salary.Result.RealizedAmount != 10000 {
		t.Fatalf("salary realized = %v, want 10000", salary.Result.RealizedAmount)
	}
	if contract.Result.RealizedAmount != 5000 {
		t.Fatalf("contract realized = %v, want 5000", contract.Result.RealizedAmount)
	}
	if got := runtime.State.Balances["checking"]; got != 10000 {
		t.Fatalf("checking = %v, want 10000", got)
	}
	if got := runtime.State.Balances["savings"]; got != 5000 {
		t.Fatalf("savings = %v, want 5000", got)
	}
}

func TestIncomePostingAnnualCapBindsNetCash(t *testing.T) {
	model, incomeData := multiIncomeModel()
	cap := 15000.0
	model.Postings[0].AnnualCap = &cap
	runtime, err := CreateTransitionRuntime(model, SimulationState{
		Balances:                     map[string]float64{"checking": 0, "savings": 0},
		LatestRealizedPostingAmounts: map[string]float64{},
		RealizedPostingAmountsByYear: map[string]map[string]float64{},
	}, "2026-09-01", nil, incomeData)
	if err != nil {
		t.Fatalf("create runtime: %v", err)
	}
	first, err := runtime.ExecutePosting(DatedPostingOccurrence{Posting: &model.Postings[0], Index: 0}, "2026-09-01")
	if err != nil {
		t.Fatalf("execute first: %v", err)
	}
	if first.Result.RealizedAmount != 10000 {
		t.Fatalf("first realized = %v, want 10000", first.Result.RealizedAmount)
	}
	second, err := runtime.ExecutePosting(DatedPostingOccurrence{Posting: &model.Postings[0], Index: 0}, "2026-10-01")
	if err != nil {
		t.Fatalf("execute second: %v", err)
	}
	// 10000 already deposited against the 15000 cap: 5000 remains.
	if second.Result.RequestedAmount != 10000 {
		t.Fatalf("second requested = %v, want 10000", second.Result.RequestedAmount)
	}
	if second.Result.RealizedAmount != 5000 {
		t.Fatalf("second realized = %v, want 5000", second.Result.RealizedAmount)
	}
}

func TestSourcelessDestinationlessPostingFailsForAnyResolver(t *testing.T) {
	model, _ := multiIncomeModel()
	model.Postings[0].Amount = types.PostingAmountResolution{
		Resolver: "expression",
		Config:   map[string]any{"expression": "700"},
		Inputs:   map[string]types.AmountInputBinding{},
	}
	model.Postings[0].Destinations = []string{}
	document := &types.FinancialModelDocument{
		SourcePath:  "test",
		Accounts:    model.Accounts,
		Checkpoints: []types.Checkpoint{},
		Evaluations: types.EmptyEvaluationTables(),
		Postings:    model.Postings[:1],
	}
	found := false
	for _, issue := range ValidateFinancialModel(document, nil) {
		if issue.Code == "posting.accounts.empty" {
			found = true
		}
	}
	if !found {
		t.Fatalf("expected posting.accounts.empty for a sourceless destinationless posting")
	}
}
