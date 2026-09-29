package domain

import (
	"testing"

	"github.com/simhozebs/net-worth-estimator/backend/internal/types"
)

// Regression tests for sampled investment losses. Growth postings are
// sourceless inflows shaped like `balance * rate`; a negative sampled rate
// must shrink the destination balance instead of clamping to zero.
// Clamping discards the entire downside of the return distribution and
// biases stochastic bands above the base case.

func lossFloatPtr(value float64) *float64 { return &value }

func lossTestModel(minBalance *float64) types.FinancialModel {
	return types.FinancialModel{
		Accounts: []types.Account{
			{ID: "growth", Name: "Growth", Kind: types.AccountKindInvestment, MinBalance: minBalance, Enabled: true},
			{ID: "checking", Name: "Checking", Kind: types.AccountKindCash, Enabled: true},
		},
		Postings: []types.Posting{
			{
				ID:   "growth",
				Name: "Growth",
				Destinations: []string{
					"growth",
				},
				Amount: types.PostingAmountResolution{
					Resolver: "expression",
					Config:   map[string]any{"expression": "bal * rate"},
					Inputs: map[string]types.AmountInputBinding{
						"bal":  {Source: "provider", Provider: "model-value", Arguments: map[string]any{"id": "growth"}},
						"rate": {Source: "provider", Provider: "occurrence-rate", Arguments: map[string]any{}},
					},
				},
				Frequency:  types.FrequencyMonthly,
				AnnualRate: 0.12,
				Volatility: 0.3,
				StartDate:  "2026-02-01",
				Priority:   1,
				Enabled:    true,
			},
		},
	}
}

func lossTestRuntime(t *testing.T, model types.FinancialModel, balances map[string]float64, sample *types.MonteCarloSample) *TransitionRuntime {
	t.Helper()
	runtime, err := CreateTransitionRuntime(model, SimulationState{
		Balances:                     balances,
		LatestRealizedPostingAmounts: map[string]float64{},
		RealizedPostingAmountsByYear: map[string]map[string]float64{},
	}, "2026-01-15", sample, nil)
	if err != nil {
		t.Fatalf("create runtime: %v", err)
	}
	return runtime
}

func executeLossOccurrence(t *testing.T, runtime *TransitionRuntime, model *types.FinancialModel, date string) PostingExecutionTransition {
	t.Helper()
	transition, err := runtime.ExecutePosting(DatedPostingOccurrence{Posting: &model.Postings[0], Index: 0}, date)
	if err != nil {
		t.Fatalf("execute posting: %v", err)
	}
	return transition
}

func TestNegativeGrowthSampleReducesBalance(t *testing.T) {
	model := lossTestModel(nil)
	runtime := lossTestRuntime(t, model, map[string]float64{"growth": 12000}, &types.MonteCarloSample{
		AnnualRatesByPostingID: map[string][]float64{"growth": {-0.12}},
	})
	transition := executeLossOccurrence(t, runtime, &model, "2026-02-01")
	// 12000 * (-0.12 / 12) = -120, applied in full.
	if transition.Result.RequestedAmount != -120 {
		t.Errorf("requested = %v, want -120", transition.Result.RequestedAmount)
	}
	if transition.Result.RealizedAmount != -120 {
		t.Errorf("realized = %v, want -120", transition.Result.RealizedAmount)
	}
	if got := runtime.State.Balances["growth"]; got != 11880 {
		t.Errorf("balance = %v, want 11880", got)
	}
	if len(transition.AccountDeltas) != 1 || transition.AccountDeltas[0].Delta != -120 {
		t.Errorf("deltas = %+v, want one -120 delta", transition.AccountDeltas)
	}
}

func TestNegativeGrowthFlooredAtAccountFloor(t *testing.T) {
	model := lossTestModel(lossFloatPtr(0))
	runtime := lossTestRuntime(t, model, map[string]float64{"growth": 50}, &types.MonteCarloSample{
		AnnualRatesByPostingID: map[string][]float64{"growth": {-24.0}},
	})
	transition := executeLossOccurrence(t, runtime, &model, "2026-02-01")
	// 50 * (-24 / 12) = -100 requested, but only 50 is withdrawable above the floor.
	if transition.Result.RequestedAmount != -100 {
		t.Errorf("requested = %v, want -100", transition.Result.RequestedAmount)
	}
	if transition.Result.RealizedAmount != -50 {
		t.Errorf("realized = %v, want -50", transition.Result.RealizedAmount)
	}
	if got := runtime.State.Balances["growth"]; got != 0 {
		t.Errorf("balance = %v, want 0", got)
	}
}

func TestPositiveGrowthUnchanged(t *testing.T) {
	model := lossTestModel(nil)
	runtime := lossTestRuntime(t, model, map[string]float64{"growth": 12000}, nil)
	transition := executeLossOccurrence(t, runtime, &model, "2026-02-01")
	if transition.Result.RequestedAmount != 120 || transition.Result.RealizedAmount != 120 {
		t.Errorf("result = %+v, want requested and realized 120", transition.Result)
	}
	if got := runtime.State.Balances["growth"]; got != 12120 {
		t.Errorf("balance = %v, want 12120", got)
	}
}

func TestNegativeSourcedOutflowStillClampsToZero(t *testing.T) {
	checking := "checking"
	model := types.FinancialModel{
		Accounts: []types.Account{
			{ID: "checking", Name: "Checking", Kind: types.AccountKindCash, Enabled: true},
		},
		Postings: []types.Posting{
			{
				ID:              "spend",
				Name:            "Spend",
				SourceAccountID: &checking,
				Amount: types.PostingAmountResolution{
					Resolver: "expression",
					Config:   map[string]any{"expression": "0 - 50"},
					Inputs:   map[string]types.AmountInputBinding{},
				},
				Frequency: types.FrequencyMonthly,
				StartDate: "2026-02-01",
				Priority:  1,
				Enabled:   true,
			},
		},
	}
	runtime := lossTestRuntime(t, model, map[string]float64{"checking": 1000}, nil)
	transition, err := runtime.ExecutePosting(DatedPostingOccurrence{Posting: &model.Postings[0], Index: 0}, "2026-02-01")
	if err != nil {
		t.Fatalf("execute posting: %v", err)
	}
	if transition.Result.RequestedAmount != 0 || transition.Result.RealizedAmount != 0 {
		t.Errorf("result = %+v, want requested and realized 0", transition.Result)
	}
	if got := runtime.State.Balances["checking"]; got != 1000 {
		t.Errorf("balance = %v, want 1000", got)
	}
}

func TestLossDoesNotInflateAnnualCapHeadroom(t *testing.T) {
	// Same calendar year for both legs: cap ledgers are per-year, so a
	// cross-year test would pass with or without the fix. The loss leg uses
	// a deterministic negative rate (losses are general kernel semantics,
	// not sampler-specific); the gain leg then proves the loss accrued
	// nothing to the cap ledger.
	model := types.FinancialModel{
		Accounts: []types.Account{
			{ID: "vault", Name: "Vault", Kind: types.AccountKindInvestment, Enabled: true},
		},
		Postings: []types.Posting{
			{
				ID:   "capgrowth",
				Name: "Capped growth",
				Destinations: []string{
					"vault",
				},
				Amount: types.PostingAmountResolution{
					Resolver: "expression",
					Config:   map[string]any{"expression": "bal * rate"},
					Inputs: map[string]types.AmountInputBinding{
						"bal":  {Source: "provider", Provider: "model-value", Arguments: map[string]any{"id": "vault"}},
						"rate": {Source: "provider", Provider: "occurrence-rate", Arguments: map[string]any{}},
					},
				},
				Frequency:  types.FrequencyMonthly,
				AnnualRate: -6.0,
				StartDate:  "2026-02-01",
				AnnualCap:  lossFloatPtr(1000),
				Priority:   1,
				Enabled:    true,
			},
		},
	}
	runtime := lossTestRuntime(t, model, map[string]float64{"vault": 12000}, nil)
	// 12000 * (-6 / 12) = -6000, applied in full.
	loss := executeLossOccurrence(t, runtime, &model, "2026-02-01")
	if loss.Result.RealizedAmount != -6000 {
		t.Fatalf("loss realized = %v, want -6000", loss.Result.RealizedAmount)
	}
	if got := runtime.State.LatestRealizedPostingAmounts["capgrowth"]; got != -6000 {
		t.Errorf("latest realized = %v, want -6000", got)
	}
	// A later gain in the same year requests 6000 * (12 / 12) = 6000 but
	// must see only 1000 of cap headroom. If the loss had accrued to the
	// ledger, headroom would be 7000 and the gain would realize in full.
	model.Postings[0].AnnualRate = 12.0
	gainTransition, err := runtime.ExecutePosting(DatedPostingOccurrence{Posting: &model.Postings[0], Index: 0}, "2026-03-01")
	if err != nil {
		t.Fatalf("execute gain posting: %v", err)
	}
	if gainTransition.Result.RequestedAmount != 6000 {
		t.Errorf("gain requested = %v, want 6000", gainTransition.Result.RequestedAmount)
	}
	if gainTransition.Result.RealizedAmount != 1000 {
		t.Errorf("gain realized = %v, want 1000 (cap headroom uninflated by the loss)", gainTransition.Result.RealizedAmount)
	}
	if got := runtime.State.Balances["vault"]; got != 7000 {
		t.Errorf("balance = %v, want 7000", got)
	}
}
