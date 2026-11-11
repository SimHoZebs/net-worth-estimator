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
		Amount:          types.TransactionAmountResolution{Resolver: "expression", Config: map[string]any{"expression": "1200.00"}, Inputs: map[string]types.AmountInputBinding{}},
		Frequency:       types.FrequencyMonthly,
		StartDate:       "2026-01-01",
		Enabled:         true,
	}
}

func existingRuleTestTransactions() []types.Transaction {
	account := "checking"
	amount := func(value string) types.TransactionAmountResolution {
		return types.TransactionAmountResolution{Resolver: "expression", Config: map[string]any{"expression": value}, Inputs: map[string]types.AmountInputBinding{}}
	}
	return []types.Transaction{
		{ID: "p1", Name: "Rent", SourceAccountID: &account, Amount: amount("1200.00"), TransactionTime: time.Date(2026, 1, 1, 12, 0, 0, 0, time.UTC).Unix(), Enabled: true},
		{ID: "p2", Name: "Rent", SourceAccountID: &account, Amount: amount("1200.00"), TransactionTime: time.Date(2026, 2, 1, 12, 0, 0, 0, time.UTC).Unix(), Enabled: true},
		{ID: "p3", Name: "Rent", SourceAccountID: &account, Amount: amount("1200.00"), TransactionTime: time.Date(2026, 4, 2, 12, 0, 0, 0, time.UTC).Unix(), Enabled: true},
	}
}

func existingRuleTestFinding() types.AnalysisFinding {
	return types.AnalysisFinding{
		AnalysisDetection: types.AnalysisDetection{
			TransactionID: "p1", Kind: "recurring", Provider: "rent", Product: "monthly",
			Role: "outflow", Strength: "moderate",
			Evidence: []types.AnalysisEvidence{{Code: "recurring.cadence", Reason: "test", TransactionIDs: []string{"p1", "p2", "p3"}}},
		},
		ID:     "finding-1",
		Status: "active",
		Review: &types.AnalysisReview{Decision: "confirmed", Provider: "rent", AnsweredAt: 1},
	}
}

func TestBuildPatternToExistingScheduleMapsToSchedule(t *testing.T) {
	assignments, err := BuildPatternToExistingSchedule(PatternToExistingScheduleInput{
		Anchor: existingRuleTestFinding(), Transactions: existingRuleTestTransactions(), Facts: map[string]types.TransactionFacts{
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
		if want[item.TransactionID] != item.Date {
			t.Fatalf("assignment=%+v want %v", item, want)
		}
	}
}

func TestBuildPatternToExistingScheduleAcceptsRentKind(t *testing.T) {
	finding := existingRuleTestFinding()
	finding.Kind = "rent"
	finding.Pattern = &types.AnalysisPaymentPattern{PatternID: "rent-pattern", Currency: "USD", TypicalAmount: "1200.00"}
	assignments, err := BuildPatternToExistingSchedule(PatternToExistingScheduleInput{
		Anchor: finding, Transactions: existingRuleTestTransactions(), Facts: map[string]types.TransactionFacts{
			"p1": {Amount: "-1200.00", Currency: "USD"},
			"p2": {Amount: "-1200.00", Currency: "USD"},
			"p3": {Amount: "-1200.00", Currency: "USD"},
		}, Rule: existingRuleTestRule(), OccurrenceIDs: []string{"p1", "p2", "p3"},
	})
	if err != nil {
		t.Fatal(err)
	}
	want := map[string]string{"p1": "2026-01-01", "p2": "2026-02-01", "p3": "2026-04-01"}
	if len(assignments) != len(want) {
		t.Fatalf("assignments=%+v", assignments)
	}
	for _, item := range assignments {
		if want[item.TransactionID] != item.Date {
			t.Fatalf("assignment=%+v want %v", item, want)
		}
	}
}

func TestBuildPatternToExistingScheduleRejectsRoutingMismatch(t *testing.T) {
	rule := existingRuleTestRule()
	other := "savings"
	rule.SourceAccountID = &other
	if _, err := BuildPatternToExistingSchedule(PatternToExistingScheduleInput{
		Anchor: existingRuleTestFinding(), Transactions: existingRuleTestTransactions(), Rule: rule, OccurrenceIDs: []string{"p1", "p2", "p3"},
	}); err == nil {
		t.Fatal("expected routing mismatch")
	}
}

func TestBuildPatternToExistingScheduleRejectsDisabledRule(t *testing.T) {
	rule := existingRuleTestRule()
	rule.Enabled = false
	if _, err := BuildPatternToExistingSchedule(PatternToExistingScheduleInput{
		Anchor: existingRuleTestFinding(), Transactions: existingRuleTestTransactions(), Rule: rule, OccurrenceIDs: []string{"p1", "p2", "p3"},
	}); err == nil {
		t.Fatal("expected disabled rule")
	}
}

func TestBuildPatternToExistingScheduleIgnoresDisabledTakers(t *testing.T) {
	transactions := existingRuleTestTransactions()
	// A disabled outsider claims 2026-02-01, but projections ignore disabled
	// claims, so the pattern may still take that date.
	outsider := transactions[0]
	outsider.ID = "other"
	outsider.Enabled = false
	outsider.Claim = &types.TransactionClaim{ScheduleID: "rent", OccurrenceDate: "2026-02-01"}
	transactions = append(transactions, outsider)
	assignments, err := BuildPatternToExistingSchedule(PatternToExistingScheduleInput{
		Anchor: existingRuleTestFinding(), Transactions: transactions, Facts: map[string]types.TransactionFacts{
			"p1": {Amount: "-1200.00", Currency: "USD"},
			"p2": {Amount: "-1200.00", Currency: "USD"},
			"p3": {Amount: "-1200.00", Currency: "USD"},
		}, Rule: existingRuleTestRule(), OccurrenceIDs: []string{"p1", "p2", "p3"},
	})
	if err != nil {
		t.Fatal(err)
	}
	for _, item := range assignments {
		if item.TransactionID == "p2" && item.Date != "2026-02-01" {
			t.Fatalf("p2=%+v, want 2026-02-01", item)
		}
	}
}

func TestBuildPatternToExistingScheduleKeepsCorrectClaims(t *testing.T) {
	transactions := existingRuleTestTransactions()
	transactions[0].Claim = &types.TransactionClaim{ScheduleID: "rent", OccurrenceDate: "2026-01-01"}
	assignments, err := BuildPatternToExistingSchedule(PatternToExistingScheduleInput{
		Anchor: existingRuleTestFinding(), Transactions: transactions, Rule: existingRuleTestRule(), OccurrenceIDs: []string{"p1", "p2", "p3"},
	})
	if err != nil {
		t.Fatal(err)
	}
	for _, item := range assignments {
		if item.TransactionID == "p1" && item.Date != "2026-01-01" {
			t.Fatalf("p1=%+v, want kept 2026-01-01", item)
		}
	}
}
