package analysis

import (
	"errors"
	"testing"

	"github.com/simhozebs/net-worth-estimator/backend/internal/types"
)

func newRuleTestFinding() types.AnalysisFinding {
	return types.AnalysisFinding{
		AnalysisDetection: types.AnalysisDetection{
			TransactionID: "p1", Kind: "recurring", Provider: "grocer", Product: "monthly",
			Role: "outflow", Strength: "moderate",
			Evidence: []types.AnalysisEvidence{{Code: "recurring.cadence", Reason: "test", TransactionIDs: []string{"p1", "p2"}}},
		},
		ID: "finding-1", Status: "active",
		Review: &types.AnalysisReview{Decision: "confirmed", Provider: "grocer", AnsweredAt: 1},
	}
}

func newRuleTestTransactions() []types.Transaction {
	account := "checking"
	amount := func(value string) types.TransactionAmountResolution {
		return types.TransactionAmountResolution{Resolver: "expression", Config: map[string]any{"expression": value}, Inputs: map[string]types.AmountInputBinding{}}
	}
	return []types.Transaction{
		{ID: "p1", Name: "Grocer", SourceAccountID: &account, Amount: amount("30.00"), TransactionTime: 1768478400, Enabled: true},
		{ID: "p2", Name: "Grocer", SourceAccountID: &account, Amount: amount("30.00"), TransactionTime: 1771156800, Enabled: true},
	}
}

func newRuleTestFacts() map[string]types.TransactionFacts {
	return map[string]types.TransactionFacts{
		"p1": {Description: "GROCER", Amount: "-30.00", Currency: "USD", OccurredAt: 1768478400},
		"p2": {Description: "GROCER", Amount: "-30.00", Currency: "USD", OccurredAt: 1771156800},
	}
}

func newRuleTestInput() PatternToNewScheduleInput {
	return PatternToNewScheduleInput{Anchor: newRuleTestFinding(), Transactions: newRuleTestTransactions(), Facts: newRuleTestFacts(), AccountIDs: []string{"checking"}}
}

func TestBuildPatternToNewSchedulePreviewRejectsNonRecurring(t *testing.T) {
	finding := newRuleTestFinding()
	finding.Kind = "bnpl"
	input := newRuleTestInput()
	input.Anchor = finding
	if _, err := BuildPatternToNewSchedulePreview(input); !errors.Is(err, ErrNotRecurring) {
		t.Fatalf("err=%v", err)
	}
}

func TestBuildPatternToNewSchedulePreviewRejectsSplitEvidence(t *testing.T) {
	input := newRuleTestInput()
	other := "savings"
	input.Transactions[1].SourceAccountID = &other
	if _, err := BuildPatternToNewSchedulePreview(input); !errors.Is(err, ErrPatternIncoherent) {
		t.Fatalf("err=%v", err)
	}
}

func TestBuildPatternToNewSchedulePreviewRejectsMissingAccount(t *testing.T) {
	input := newRuleTestInput()
	input.AccountIDs = []string{"savings"}
	if _, err := BuildPatternToNewSchedulePreview(input); !errors.Is(err, ErrPatternStale) {
		t.Fatalf("err=%v", err)
	}
}

func TestBuildPatternToNewSchedulePreviewClampsMonthEnds(t *testing.T) {
	account := "checking"
	amount := func(value string) types.TransactionAmountResolution {
		return types.TransactionAmountResolution{Resolver: "expression", Config: map[string]any{"expression": value}, Inputs: map[string]types.AmountInputBinding{}}
	}
	transactions := []types.Transaction{
		{ID: "p1", Name: "Rent", SourceAccountID: &account, Amount: amount("1200.00"), TransactionTime: 1769899200, Enabled: true},
		{ID: "p2", Name: "Rent", SourceAccountID: &account, Amount: amount("1200.00"), TransactionTime: 1772280000, Enabled: true},
	}
	finding := newRuleTestFinding()
	finding.Evidence = []types.AnalysisEvidence{{Code: "recurring.cadence", Reason: "test", TransactionIDs: []string{"p1", "p2"}}}
	preview, err := BuildPatternToNewSchedulePreview(PatternToNewScheduleInput{
		Anchor: finding, Transactions: transactions, AccountIDs: []string{"checking"},
		Facts: map[string]types.TransactionFacts{
			"p1": {Description: "RENT", Amount: "-1200.00", Currency: "USD", OccurredAt: 1769899200},
			"p2": {Description: "RENT", Amount: "-1200.00", Currency: "USD", OccurredAt: 1772280000},
		},
	})
	if err != nil {
		t.Fatal(err)
	}
	// 2026-01-31 and 2026-02-28 evidence produce a clamped 2026-03-28 start.
	if !preview.Creatable || preview.Schedule == nil || preview.Schedule.StartDate != "2026-03-28" {
		t.Fatalf("preview=%+v", preview)
	}
	if len(preview.Upcoming) == 0 || preview.Upcoming[0].Date != "2026-03-28" {
		t.Fatalf("upcoming=%+v", preview.Upcoming)
	}
}

func TestBuildPatternToNewSchedulePreviewStartsAfterLatestEvidence(t *testing.T) {
	preview, err := BuildPatternToNewSchedulePreview(newRuleTestInput())
	if err != nil {
		t.Fatal(err)
	}
	if !preview.Creatable || preview.Schedule == nil {
		t.Fatalf("preview=%+v", preview)
	}
	// 2026-01-15 and 2026-02-15 evidence produce a 2026-03-15 monthly start.
	if preview.Schedule.StartDate != "2026-03-15" {
		t.Fatalf("start=%s", preview.Schedule.StartDate)
	}
	if len(preview.Upcoming) != 6 || preview.Upcoming[0].Date != "2026-03-15" {
		t.Fatalf("upcoming=%+v", preview.Upcoming)
	}
	if preview.PatternKey == "" || preview.PatternKey != RecurringPatternKey("recurring", "monthly", []string{"p2", "p1"}) {
		t.Fatalf("key=%q", preview.PatternKey)
	}
}
