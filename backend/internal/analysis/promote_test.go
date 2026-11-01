package analysis

import (
	"errors"
	"testing"

	"github.com/simhozebs/net-worth-estimator/backend/internal/types"
)

func promotionTestFinding() types.AnalysisFinding {
	return types.AnalysisFinding{
		AnalysisDetection: types.AnalysisDetection{
			PostingID: "p1", Kind: "recurring", Provider: "grocer", Product: "monthly",
			Role: "outflow", Strength: "moderate",
			Evidence: []types.AnalysisEvidence{{Code: "recurring.cadence", Reason: "test", PostingIDs: []string{"p1", "p2"}}},
		},
		ID: "finding-1", Status: "active",
		Review: &types.AnalysisReview{Decision: "confirmed", Provider: "grocer", AnsweredAt: 1},
	}
}

func promotionTestPostings() []types.Posting {
	account := "checking"
	amount := func(value string) types.PostingAmountResolution {
		return types.PostingAmountResolution{Resolver: "expression", Config: map[string]any{"expression": value}, Inputs: map[string]types.AmountInputBinding{}}
	}
	return []types.Posting{
		{ID: "p1", Name: "Grocer", SourceAccountID: &account, Amount: amount("30.00"), TransactionTime: 1768478400, Enabled: true},
		{ID: "p2", Name: "Grocer", SourceAccountID: &account, Amount: amount("30.00"), TransactionTime: 1771156800, Enabled: true},
	}
}

func promotionTestFacts() map[string]types.TransactionFacts {
	return map[string]types.TransactionFacts{
		"p1": {Description: "GROCER", Amount: "-30.00", Currency: "USD", OccurredAt: 1768478400},
		"p2": {Description: "GROCER", Amount: "-30.00", Currency: "USD", OccurredAt: 1771156800},
	}
}

func promotionTestInput() RecurringPatternInput {
	return RecurringPatternInput{Anchor: promotionTestFinding(), Postings: promotionTestPostings(), Facts: promotionTestFacts(), AccountIDs: []string{"checking"}}
}

func TestBuildRecurringPreviewRejectsNonRecurring(t *testing.T) {
	finding := promotionTestFinding()
	finding.Kind = "bnpl"
	input := promotionTestInput()
	input.Anchor = finding
	if _, err := BuildRecurringPreview(input); !errors.Is(err, ErrNotRecurring) {
		t.Fatalf("err=%v", err)
	}
}

func TestBuildRecurringPreviewRejectsSplitEvidence(t *testing.T) {
	input := promotionTestInput()
	other := "savings"
	input.Postings[1].SourceAccountID = &other
	if _, err := BuildRecurringPreview(input); !errors.Is(err, ErrPatternIncoherent) {
		t.Fatalf("err=%v", err)
	}
}

func TestBuildRecurringPreviewRejectsMissingAccount(t *testing.T) {
	input := promotionTestInput()
	input.AccountIDs = []string{"savings"}
	if _, err := BuildRecurringPreview(input); !errors.Is(err, ErrPatternStale) {
		t.Fatalf("err=%v", err)
	}
}

func TestBuildRecurringPreviewClampsMonthEnds(t *testing.T) {
	account := "checking"
	amount := func(value string) types.PostingAmountResolution {
		return types.PostingAmountResolution{Resolver: "expression", Config: map[string]any{"expression": value}, Inputs: map[string]types.AmountInputBinding{}}
	}
	postings := []types.Posting{
		{ID: "p1", Name: "Rent", SourceAccountID: &account, Amount: amount("1200.00"), TransactionTime: 1769899200, Enabled: true},
		{ID: "p2", Name: "Rent", SourceAccountID: &account, Amount: amount("1200.00"), TransactionTime: 1772280000, Enabled: true},
	}
	finding := promotionTestFinding()
	finding.Evidence = []types.AnalysisEvidence{{Code: "recurring.cadence", Reason: "test", PostingIDs: []string{"p1", "p2"}}}
	preview, err := BuildRecurringPreview(RecurringPatternInput{
		Anchor: finding, Postings: postings, AccountIDs: []string{"checking"},
		Facts: map[string]types.TransactionFacts{
			"p1": {Description: "RENT", Amount: "-1200.00", Currency: "USD", OccurredAt: 1769899200},
			"p2": {Description: "RENT", Amount: "-1200.00", Currency: "USD", OccurredAt: 1772280000},
		},
	})
	if err != nil {
		t.Fatal(err)
	}
	// 2026-01-31 and 2026-02-28 evidence produce a clamped 2026-03-28 start.
	if !preview.Promotable || preview.Rule == nil || preview.Rule.StartDate != "2026-03-28" {
		t.Fatalf("preview=%+v", preview)
	}
	if len(preview.Upcoming) == 0 || preview.Upcoming[0].Date != "2026-03-28" {
		t.Fatalf("upcoming=%+v", preview.Upcoming)
	}
}

func TestBuildRecurringPreviewStartsAfterLatestEvidence(t *testing.T) {
	preview, err := BuildRecurringPreview(promotionTestInput())
	if err != nil {
		t.Fatal(err)
	}
	if !preview.Promotable || preview.Rule == nil {
		t.Fatalf("preview=%+v", preview)
	}
	// 2026-01-15 and 2026-02-15 evidence produce a 2026-03-15 monthly start.
	if preview.Rule.StartDate != "2026-03-15" {
		t.Fatalf("start=%s", preview.Rule.StartDate)
	}
	if len(preview.Upcoming) != 6 || preview.Upcoming[0].Date != "2026-03-15" {
		t.Fatalf("upcoming=%+v", preview.Upcoming)
	}
	if preview.PatternKey == "" || preview.PatternKey != RecurringPatternKey("recurring", "monthly", []string{"p2", "p1"}) {
		t.Fatalf("key=%q", preview.PatternKey)
	}
}
