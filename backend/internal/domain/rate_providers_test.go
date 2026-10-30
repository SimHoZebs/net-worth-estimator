package domain

import (
	"math"
	"testing"

	"github.com/simhozebs/net-worth-estimator/backend/internal/types"
)

// Rate behavior lives in amount inputs, shared by one-time and recurring
// transactions. These tests pin the provider math the simulation kernel
// relies on.

func rateTestContext(divisor int, startDate string, sampled *float64) *AmountProviderContext {
	return &AmountProviderContext{
		Balances:                     map[string]float64{},
		LatestRealizedPostingAmounts: map[string]float64{},
		LatestRealizedPostingDates:   map[string]string{},
		RealizedPostingAmountsByYear: map[string]map[string]float64{},
		PaymentTerms:                 map[string]types.PaymentTerms{},
		Date:                         "2026-03-01",
		FrequencyDivisor:             divisor,
		RuleStartDate:                startDate,
		SampledAnnualRate:            sampled,
	}
}

func TestOccurrenceRateDividesByFrequency(t *testing.T) {
	args := map[string]types.JsonValue{"annualRate": 0.12}
	value, err := amountProviders["occurrence-rate"].resolve(args, rateTestContext(12, "", nil))
	if err != nil {
		t.Fatalf("resolve: %v", err)
	}
	if value != 0.01 {
		t.Fatalf("rate = %v, want 0.01", value)
	}
}

func TestOccurrenceRatePrefersSampleWhenVolatile(t *testing.T) {
	sampled := -0.12
	args := map[string]types.JsonValue{"annualRate": 0.12, "volatility": 0.3}
	value, err := amountProviders["occurrence-rate"].resolve(args, rateTestContext(12, "", &sampled))
	if err != nil {
		t.Fatalf("resolve: %v", err)
	}
	if value != -0.01 {
		t.Fatalf("rate = %v, want -0.01", value)
	}
}

func TestOccurrenceRateIgnoresSampleWithoutVolatility(t *testing.T) {
	sampled := -0.12
	args := map[string]types.JsonValue{"annualRate": 0.12}
	value, err := amountProviders["occurrence-rate"].resolve(args, rateTestContext(12, "", &sampled))
	if err != nil {
		t.Fatalf("resolve: %v", err)
	}
	if value != 0.01 {
		t.Fatalf("rate = %v, want 0.01", value)
	}
}

func TestOccurrenceRateRejectsBadArgs(t *testing.T) {
	ctx := rateTestContext(12, "", nil)
	for _, args := range []map[string]types.JsonValue{
		{},
		{"annualRate": "high"},
		{"annualRate": 0.05, "volatility": -0.1},
	} {
		if _, err := amountProviders["occurrence-rate"].resolve(args, ctx); err == nil {
			t.Fatalf("expected an error for args %+v", args)
		}
		if err := amountProviders["occurrence-rate"].validateReferences(args, &AmountReferenceContext{}); err == nil {
			t.Fatalf("expected a validation error for args %+v", args)
		}
	}
}

func TestGrowthFactorCompoundsFromStartDate(t *testing.T) {
	args := map[string]types.JsonValue{"annualGrowthRate": 0.02}
	// 2026-02-01 to 2026-03-01 is 28 days: (1.02)^(28/365).
	value, err := amountProviders["growth-factor"].resolve(args, rateTestContext(1, "2026-02-01", nil))
	if err != nil {
		t.Fatalf("resolve: %v", err)
	}
	days := float64(DaysBetween("2026-02-01", "2026-03-01"))
	want := math.Pow(1.02, days/365)
	if diff := value - want; diff < -1e-12 || diff > 1e-12 {
		t.Fatalf("factor = %v, want %v", value, want)
	}
}

func TestGrowthFactorNeutralWithoutStartDate(t *testing.T) {
	args := map[string]types.JsonValue{"annualGrowthRate": 0.02}
	value, err := amountProviders["growth-factor"].resolve(args, rateTestContext(1, "", nil))
	if err != nil {
		t.Fatalf("resolve: %v", err)
	}
	if value != 1 {
		t.Fatalf("factor = %v, want 1", value)
	}
}

func TestMultipleVolatileInputsRejected(t *testing.T) {
	amount := types.PostingAmountResolution{
		Resolver: "expression",
		Config:   map[string]any{"expression": "a + b"},
		Inputs: map[string]types.AmountInputBinding{
			"a": {Source: "provider", Provider: "occurrence-rate", Arguments: map[string]any{"annualRate": 0.05, "volatility": 0.1}},
			"b": {Source: "provider", Provider: "occurrence-rate", Arguments: map[string]any{"annualRate": 0.03, "volatility": 0.2}},
		},
	}
	if CountVolatileRateInputs(amount) != 2 {
		t.Fatalf("volatile count = %d, want 2", CountVolatileRateInputs(amount))
	}
	model := &types.FinancialModel{
		RecurrenceRules: []types.RecurrenceRule{{
			ID: "growth", Name: "Growth", Amount: amount,
			Frequency: types.FrequencyMonthly, StartDate: "2026-02-01", Enabled: true,
		}},
	}
	issues := ValidateFinancialModel(model)
	found := false
	for _, issue := range issues {
		if issue.Code == "posting.amount.multiple_volatile_rates" {
			found = true
		}
	}
	if !found {
		t.Fatalf("expected multiple_volatile_rates issue, got %+v", issues)
	}
}
