package domain

import (
	"math"
	"testing"

	"github.com/simhozebs/net-worth-estimator/backend/internal/types"
)

// TestRoundSampleValueRoundingContract pins the rounding contract callers
// observe on reported net-worth samples: halves round toward +Infinity.
func TestRoundSampleValueRoundingContract(t *testing.T) {
	cases := []struct {
		input    float64
		expected float64
	}{
		{2.5, 3},
		{-2.5, -2},
		{-0.5, 0},
		{0.5, 1},
		{2.4, 2},
		{-2.6, -3},
		{0, 0},
	}
	for _, c := range cases {
		if got := RoundSampleValue(c.input); got != c.expected {
			t.Errorf("RoundSampleValue(%v) = %v, want %v", c.input, got, c.expected)
		}
	}
}

// TestSeededSamplerDeterministicForLargeSeed pins the caller-visible contract
// that a large seed yields finite, reproducible samples. The exact internal
// recurrence is not observable and is left free to change.
func TestSeededSamplerDeterministicForLargeSeed(t *testing.T) {
	seed := int64(123456789012345)
	first := NewStochasticSampler(&seed)
	second := NewStochasticSampler(&seed)
	for i := 0; i < 4; i++ {
		a, b := first(0.05, 0.2), second(0.05, 0.2)
		if math.IsNaN(a) || math.IsInf(a, 0) || a != b {
			t.Fatalf("draw %d = %v / %v, want a finite reproducible value", i, a, b)
		}
	}
}

// TestNormalizeStochasticConfigClamps verifies that finite run counts clamp
// into [1, 10000].
func TestNormalizeStochasticConfigClamps(t *testing.T) {
	cases := []struct {
		input    int
		expected int
	}{
		{0, 1},
		{-5, 1},
		{7, 7},
		{10_000, 10_000},
		{10_001, 10_000},
	}
	for _, c := range cases {
		got := NormalizeStochasticConfig(types.StochasticConfig{RunCount: c.input})
		if got.RunCount != c.expected {
			t.Errorf("NormalizeStochasticConfig(%d).RunCount = %d, want %d", c.input, got.RunCount, c.expected)
		}
	}
}

func TestIsValidIsoDate(t *testing.T) {
	valid := []string{"2026-02-01", "1999-12-31"}
	for _, value := range valid {
		if !IsValidIsoDate(value) {
			t.Errorf("IsValidIsoDate(%q) = false, want true", value)
		}
	}
	invalid := []string{"", "not-a-date", "2026-2-1", "2026-13-01", "01-02-2026"}
	for _, value := range invalid {
		if IsValidIsoDate(value) {
			t.Errorf("IsValidIsoDate(%q) = true, want false", value)
		}
	}
}

func TestValidateFinancialModelRejectsMalformedDatesWithoutPanic(t *testing.T) {
	model := &types.FinancialModel{
		Accounts:     []types.Account{{ID: "checking", Name: "Checking", Kind: types.AccountKindCash, Enabled: true}},
		Transactions: []types.Transaction{},
		Schedules: []types.Schedule{{
			ID:           "p1",
			Name:         "Broken dates",
			StartDate:    "not-a-date",
			EndDate:      ptrIsoDate("2026-01-01"),
			Frequency:    types.FrequencyMonthly,
			Priority:     1,
			Enabled:      true,
			Destinations: []string{"checking"},
			Amount: types.TransactionAmountResolution{
				Resolver: "expression",
				Config:   map[string]any{"expression": "100"},
			},
		}},
		Checkpoints: []types.Checkpoint{{AccountID: "checking", Balance: 100, ObservedAt: 0}},
	}

	issues := ValidateFinancialModel(model)

	found := map[string]bool{}
	for _, issue := range issues {
		if issue.Severity == types.SeverityError {
			found[issue.Code] = true
		}
	}
	for _, code := range []string{"schedule.start-date.format", "checkpoint.observedAt.required"} {
		if !found[code] {
			t.Errorf("expected validation issue %q for malformed dates, got issues %v", code, found)
		}
	}
}

func TestValidateFinancialModelAllowsMissingPostedDateOnBankLifecycleRows(t *testing.T) {
	account := "checking"
	source := account
	document := &types.FinancialModel{
		Accounts: []types.Account{cashAccount(account)},
		Transactions: []types.Transaction{
			{ID: "pending", Name: "Pending", SourceAccountID: &source, Amount: expenseAmount("100"), TransactionTime: unixAt(10, 11), Enabled: false, Source: "banksync", Pending: true},
			{ID: "voided", Name: "Voided", SourceAccountID: &source, Amount: expenseAmount("100"), TransactionTime: unixAt(10, 11), Enabled: false, Source: "banksync", Void: true},
			{ID: "settled", Name: "Settled", SourceAccountID: &source, Amount: expenseAmount("100"), TransactionTime: unixAt(10, 11), Enabled: true, Source: "banksync"},
		},
		Evaluations: types.EmptyEvaluationTables(),
	}

	issues := ValidateFinancialModel(document)

	counts := map[string]int{}
	for _, issue := range issues {
		if issue.Severity == types.SeverityError {
			counts[issue.Code]++
		}
	}
	if counts["transaction.postedTime.invalid"] != 1 {
		t.Fatalf("expected exactly one transaction.postedTime.invalid for the settled row, got %v", counts)
	}
}

func TestPrepareSimulationRejectsMalformedProjectionStart(t *testing.T) {
	model := &types.FinancialModel{
		Accounts: []types.Account{{ID: "checking", Name: "Checking", Kind: types.AccountKindCash, Enabled: true}},
	}
	settings := &types.ProjectionRuntimeSettings{
		FallbackProjectionStartDate: "01/02/2026",
		HorizonYears:                1,
	}
	_, err := PrepareSimulationRequest(model, settings, types.EmptyModelOverrides(), nil)
	preparationError, ok := err.(*SimulationPreparationError)
	if !ok {
		t.Fatalf("expected SimulationPreparationError, got %v", err)
	}
	if len(preparationError.Issues) == 0 || preparationError.Issues[0].Code != "settings.projection-start.format" {
		t.Fatalf("expected settings.projection-start.format issue, got %+v", preparationError.Issues)
	}
}

func ptrIsoDate(value string) *string { return &value }
func strPtr(value string) *string     { return &value }
