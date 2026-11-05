package analysis

import (
	"testing"
	"time"

	"github.com/simhozebs/net-worth-estimator/backend/internal/types"
)

func existingRuleTestRule() types.Schedule {
	account := "checking"
	return types.Schedule{
		ID:              "rent",
		Name:            "Rent",
		SourceAccountID: &account,
		Destinations:    []string{},
		Amount:          types.PostingAmountResolution{Resolver: "expression", Config: map[string]any{"expression": "1200.00"}, Inputs: map[string]types.AmountInputBinding{}},
		Frequency:       types.FrequencyMonthly,
		StartDate:       "2026-01-01",
		Enabled:         true,
	}
}

func existingRuleTestPostings() []types.Posting {
	account := "checking"
	amount := func(value string) types.PostingAmountResolution {
		return types.PostingAmountResolution{Resolver: "expression", Config: map[string]any{"expression": value}, Inputs: map[string]types.AmountInputBinding{}}
	}
	return []types.Posting{
		{ID: "p1", Name: "Rent", SourceAccountID: &account, Amount: amount("1200.00"), TransactionTime: time.Date(2026, 1, 1, 12, 0, 0, 0, time.UTC).Unix(), Enabled: true},
		{ID: "p2", Name: "Rent", SourceAccountID: &account, Amount: amount("1200.00"), TransactionTime: time.Date(2026, 2, 1, 12, 0, 0, 0, time.UTC).Unix(), Enabled: true},
		{ID: "p3", Name: "Rent", SourceAccountID: &account, Amount: amount("1200.00"), TransactionTime: time.Date(2026, 4, 2, 12, 0, 0, 0, time.UTC).Unix(), Enabled: true},
	}
}

func existingRuleTestFinding() types.AnalysisFinding {
	return types.AnalysisFinding{
		AnalysisDetection: types.AnalysisDetection{
			PostingID: "p1", Kind: "recurring", Provider: "rent", Product: "monthly",
			Role: "outflow", Strength: "moderate",
			Evidence: []types.AnalysisEvidence{{Code: "recurring.cadence", Reason: "test", PostingIDs: []string{"p1", "p2", "p3"}}},
		},
		ID:     "finding-1",
		Status: "active",
		Review: &types.AnalysisReview{Decision: "confirmed", Provider: "rent", AnsweredAt: 1},
	}
}

func TestBuildPatternToExistingScheduleMapsToSchedule(t *testing.T) {
	assignments, err := BuildPatternToExistingSchedule(PatternToExistingScheduleInput{
		Anchor: existingRuleTestFinding(), Postings: existingRuleTestPostings(), Facts: map[string]types.TransactionFacts{
			"p1": {Amount: "-1200.00", Currency: "USD"},
			"p2": {Amount: "-1200.00", Currency: "USD"},
			"p3": {Amount: "-1200.00", Currency: "USD"},
		}, Rule: existingRuleTestRule(), OccurrenceIDs: []string{"p1", "p2", "p3"},
	})
	if err != nil {
		t.Fatal(err)
	}
	if len(assignments) != 3 {
		t.Fatalf("assignments=%+v", assignments)
	}
	want := map[string]string{"p1": "2026-01-01", "p2": "2026-02-01", "p3": "2026-04-01"}
	for _, item := range assignments {
		if want[item.PostingID] != item.Date {
			t.Fatalf("assignment=%+v want %v", item, want)
		}
	}
}

func TestBuildPatternToExistingScheduleRejectsRoutingMismatch(t *testing.T) {
	rule := existingRuleTestRule()
	other := "savings"
	rule.SourceAccountID = &other
	if _, err := BuildPatternToExistingSchedule(PatternToExistingScheduleInput{
		Anchor: existingRuleTestFinding(), Postings: existingRuleTestPostings(), Rule: rule, OccurrenceIDs: []string{"p1", "p2", "p3"},
	}); err == nil {
		t.Fatal("expected routing mismatch")
	}
}

func TestBuildPatternToExistingScheduleRejectsDisabledRule(t *testing.T) {
	rule := existingRuleTestRule()
	rule.Enabled = false
	if _, err := BuildPatternToExistingSchedule(PatternToExistingScheduleInput{
		Anchor: existingRuleTestFinding(), Postings: existingRuleTestPostings(), Rule: rule, OccurrenceIDs: []string{"p1", "p2", "p3"},
	}); err == nil {
		t.Fatal("expected disabled rule")
	}
}

func TestBuildPatternToExistingScheduleIgnoresDisabledTakers(t *testing.T) {
	postings := existingRuleTestPostings()
	// A disabled outsider claims 2026-02-01, but projections ignore disabled
	// claims, so the pattern may still take that date.
	outsider := postings[0]
	outsider.ID = "other"
	outsider.Enabled = false
	outsider.Claim = &types.PostingClaim{ScheduleID: "rent", OccurrenceDate: "2026-02-01"}
	postings = append(postings, outsider)
	assignments, err := BuildPatternToExistingSchedule(PatternToExistingScheduleInput{
		Anchor: existingRuleTestFinding(), Postings: postings, Facts: map[string]types.TransactionFacts{
			"p1": {Amount: "-1200.00", Currency: "USD"},
			"p2": {Amount: "-1200.00", Currency: "USD"},
			"p3": {Amount: "-1200.00", Currency: "USD"},
		}, Rule: existingRuleTestRule(), OccurrenceIDs: []string{"p1", "p2", "p3"},
	})
	if err != nil {
		t.Fatal(err)
	}
	for _, item := range assignments {
		if item.PostingID == "p2" && item.Date != "2026-02-01" {
			t.Fatalf("p2=%+v, want 2026-02-01", item)
		}
	}
}

func TestBuildPatternToExistingScheduleKeepsCorrectClaims(t *testing.T) {
	postings := existingRuleTestPostings()
	postings[0].Claim = &types.PostingClaim{ScheduleID: "rent", OccurrenceDate: "2026-01-01"}
	assignments, err := BuildPatternToExistingSchedule(PatternToExistingScheduleInput{
		Anchor: existingRuleTestFinding(), Postings: postings, Rule: existingRuleTestRule(), OccurrenceIDs: []string{"p1", "p2", "p3"},
	})
	if err != nil {
		t.Fatal(err)
	}
	for _, item := range assignments {
		if item.PostingID == "p1" && item.Date != "2026-01-01" {
			t.Fatalf("p1=%+v, want kept 2026-01-01", item)
		}
	}
}
