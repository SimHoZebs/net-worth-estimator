package domain

import (
	"testing"

	"github.com/simhozebs/net-worth-estimator/backend/internal/types"
)

// TestMathRoundMatchesJavaScript pins the JS Math.round parity contract:
// halves round toward +Infinity (Math.round(-2.5) === -2).
func TestMathRoundMatchesJavaScript(t *testing.T) {
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
		if got := mathRound(c.input); got != c.expected {
			t.Errorf("mathRound(%v) = %v, want %v", c.input, got, c.expected)
		}
	}
}

// TestLCGMatchesJavaScript replays the TS LCG sequence bit-for-bit,
// including a seed large enough to exceed exact-double products.
func TestLCGMatchesJavaScript(t *testing.T) {
	lcg := newLCG(42)
	expected := []float64{
		0.5046903498026963,
		0.17625009090465033,
		0.15456239653498047,
	}
	for i, want := range expected {
		if got := lcg.next(); got != want {
			t.Errorf("lcg(42).next()[%d] = %v, want %v", i, got, want)
		}
	}

	big := newLCG(123456789012345)
	if got := big.next(); got != 0.789016724000227 {
		t.Errorf("lcg(123456789012345).next() = %v, want 0.789016724000227", got)
	}
}

// TestNormalizeStochasticConfigClamps matches TS normalizeStochasticConfig:
// finite run counts truncate and clamp into [1, 10000].
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
	document := &types.FinancialModelDocument{
		Accounts: []types.Account{{ID: "checking", Label: "Checking", Enabled: true}},
		Postings: []types.Posting{{
			ID:           "p1",
			Label:        "Broken dates",
			StartDate:    "not-a-date",
			EndDate:      ptrIsoDate("2026-01-01"),
			Frequency:    types.FrequencyMonthly,
			AnnualRate:   0,
			Priority:     1,
			Enabled:      true,
			Destinations: []string{"checking"},
			Amount: types.PostingAmountResolution{
				Resolver: "expression",
				Config:   map[string]any{"expression": "100"},
			},
		}},
		Checkpoints: []types.Checkpoint{{AccountID: "checking", Date: "2026-13-40", Balance: 100}},
	}

	issues := ValidateFinancialModel(document, nil)

	found := map[string]bool{}
	for _, issue := range issues {
		if issue.Severity == types.SeverityError {
			found[issue.Code] = true
		}
	}
	for _, code := range []string{"posting.start-date.format", "checkpoint.date.format"} {
		if !found[code] {
			t.Errorf("expected validation issue %q for malformed dates, got issues %v", code, found)
		}
	}
}

func TestPrepareSimulationRejectsMalformedProjectionStart(t *testing.T) {
	document := &types.FinancialModelDocument{
		Accounts: []types.Account{{ID: "checking", Label: "Checking", Enabled: true}},
	}
	settings := &types.ProjectionRuntimeSettings{
		FallbackProjectionStartDate: "01/02/2026",
		HorizonYears:                1,
	}
	_, err := PrepareSimulationRequest(document, settings, types.EmptyModelOverrides(), nil, nil)
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
