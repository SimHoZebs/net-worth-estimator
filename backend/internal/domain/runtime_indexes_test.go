package domain

import (
	"strings"
	"testing"

	"github.com/simhozebs/net-worth-estimator/backend/internal/types"
)

func TestReplayHistoricalStatePreservesOriginalPostingOrder(t *testing.T) {
	checking := "checking"
	document := &types.FinancialModelDocument{
		Accounts: []types.Account{{ID: checking, Label: "Checking", Enabled: true}},
		Checkpoints: []types.Checkpoint{{
			Date: "2026-01-01", AccountID: checking, Balance: 0,
		}},
		Postings: []types.Posting{
			testExpressionPosting("deposit", nil, []string{checking}, types.FrequencyMonthly, true),
			testExpressionPosting("interleaved-once", nil, []string{checking}, types.FrequencyOnce, false),
			testExpressionPosting("withdrawal", &checking, nil, types.FrequencyMonthly, true),
		},
	}

	state, _, _, err := replayHistoricalState(document, "2026-02-01", nil)
	if err != nil {
		t.Fatalf("replay historical state: %v", err)
	}
	if got := state.Balances[checking]; got != 0 {
		t.Fatalf("historical balance = %v, want 0 from deposit-before-withdrawal order", got)
	}
}

func TestIncomeRuntimeIndexSelectsEffectiveRowsAndPreservesErrors(t *testing.T) {
	juneEnd := types.IsoDate("2026-06-30")
	overlapEnd := types.IsoDate("2026-12-31")
	data := &types.IncomeDataSnapshot{
		IncomeSources: []types.IncomeSourceDefinition{
			{ID: "salary", EffectiveFrom: "2026-01-01", EffectiveTo: &juneEnd, AnnualGrossIncome: 100},
			{ID: "salary", EffectiveFrom: "2026-07-01", AnnualGrossIncome: 200},
		},
		TaxProfiles: []types.IncomeTaxProfile{
			{ID: "tax", Label: "First"},
			{ID: "tax", Label: "Later duplicate"},
		},
	}
	index := newIncomeRuntimeIndex(data, map[string]types.Account{"checking": {ID: "checking"}})

	first, err := findIncomeSource(index, "salary", "2026-06-30")
	if err != nil || first.AnnualGrossIncome != 100 {
		t.Fatalf("first effective source = %+v, err %v", first, err)
	}
	second, err := findIncomeSource(index, "salary", "2026-07-01")
	if err != nil || second.AnnualGrossIncome != 200 {
		t.Fatalf("second effective source = %+v, err %v", second, err)
	}
	profile, err := findTaxProfile(index, "tax")
	if err != nil || profile.Label != "First" {
		t.Fatalf("tax profile = %+v, err %v", profile, err)
	}

	data.IncomeSources[0].EffectiveTo = &overlapEnd
	overlapIndex := newIncomeRuntimeIndex(data, map[string]types.Account{})
	_, err = findIncomeSource(overlapIndex, "salary", "2026-07-01")
	if err == nil || !strings.Contains(err.Error(), "More than one income source") {
		t.Fatalf("overlap error = %v", err)
	}
}

func testExpressionPosting(id string, source *string, destinations []string, frequency types.PostingFrequency, enabled bool) types.Posting {
	return types.Posting{
		ID: id, Label: id, SourceAccountID: source, Destinations: destinations,
		Amount: types.PostingAmountResolution{
			Resolver: "expression",
			Config:   map[string]any{"expression": "100"},
		},
		Frequency: frequency, StartDate: "2026-01-15", Priority: 1, Enabled: enabled,
	}
}
