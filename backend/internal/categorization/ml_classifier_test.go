package categorization

import (
	"context"
	"errors"
	"fmt"
	"testing"

	"github.com/simhozebs/net-worth-estimator/backend/internal/judgment"
	"github.com/simhozebs/net-worth-estimator/backend/internal/types"
)

type stubSession struct {
	judgments []types.AnalysisJudgment
	err       error
}

func (s stubSession) Revision() string { return "stub" }

func (s stubSession) Evaluate(context.Context, []types.AnalysisJudgmentInput) ([]types.AnalysisJudgment, error) {
	return s.judgments, s.err
}

type stubProvider struct {
	session judgment.Session
	err     error
}

func (p stubProvider) Open(context.Context, judgment.FeedbackSource) (judgment.Session, error) {
	return p.session, p.err
}

func supportedJudgments(requests []types.AnalysisJudgmentInput, decision, strength string) []types.AnalysisJudgment {
	judgments := make([]types.AnalysisJudgment, len(requests))
	for index, request := range requests {
		judgments[index] = types.AnalysisJudgment{RequestID: request.ID, Status: "ready", Decision: decision, Strength: strength}
	}
	return judgments
}

func TestMLClassifierMapsStrongSupportedJudgments(t *testing.T) {
	input := Input{TransactionID: "txn-ml", Name: "SHELL OIL", Direction: "out"}
	requests := CategoryJudgmentRequests(input)
	provider := stubProvider{session: stubSession{judgments: supportedJudgments(requests, "supported", "strong")}}
	results, err := NewMLClassifier(provider).Classify(context.Background(), []Input{input})
	if err != nil {
		t.Fatal(err)
	}
	got, ok := results["txn-ml"]
	if !ok || got.Category != types.CategoryTransportation {
		t.Fatalf("results=%+v", results)
	}
	if got.Producer != "ml-categories-v1" {
		t.Fatalf("producer=%q", got.Producer)
	}
}

func TestMLClassifierIgnoresWeakJudgments(t *testing.T) {
	input := Input{TransactionID: "txn-weak", Name: "SHELL OIL", Direction: "out"}
	requests := CategoryJudgmentRequests(input)
	provider := stubProvider{session: stubSession{judgments: supportedJudgments(requests, "uncertain", "moderate")}}
	results, err := NewMLClassifier(provider).Classify(context.Background(), []Input{input})
	if err != nil {
		t.Fatal(err)
	}
	if got := results["txn-weak"]; got.Outcome != OutcomeEvaluated || got.Category != "" {
		t.Fatalf("weak judgment was not terminal: %+v", results)
	}
}

func TestMLClassifierUnsupportedIsTerminalEvaluated(t *testing.T) {
	input := Input{TransactionID: "txn-unsupported", Name: "SHELL OIL", Direction: "out"}
	requests := CategoryJudgmentRequests(input)
	provider := stubProvider{session: stubSession{judgments: supportedJudgments(requests, "unsupported", "strong")}}
	results, err := NewMLClassifier(provider).Classify(context.Background(), []Input{input})
	if err != nil {
		t.Fatal(err)
	}
	if got := results[input.TransactionID]; got.Outcome != OutcomeEvaluated || got.Category != "" {
		t.Fatalf("unsupported outcome=%+v", got)
	}
}

func TestMLClassifierTiebreaksByCategoryOrder(t *testing.T) {
	input := Input{TransactionID: "txn-tie", Name: "NETFLIX WHOLE FOODS", Direction: "out"}
	requests := CategoryJudgmentRequests(input)
	if len(requests) < 2 {
		t.Fatalf("expected competing requests, got %+v", requests)
	}
	provider := stubProvider{session: stubSession{judgments: supportedJudgments(requests, "supported", "strong")}}
	results, err := NewMLClassifier(provider).Classify(context.Background(), []Input{input})
	if err != nil {
		t.Fatal(err)
	}
	// ENTERTAINMENT precedes FOOD_AND_DRINK in CategoryKeys.
	if results["txn-tie"].Category != types.CategoryEntertainment {
		t.Fatalf("results=%+v", results)
	}
}

func TestMLClassifierDefersProviderErrors(t *testing.T) {
	provider := stubProvider{err: errors.New("provider down: PRIVATE DESCRIPTOR")}
	results, err := NewMLClassifier(provider).Classify(context.Background(), []Input{{TransactionID: "txn-err", Name: "SHELL OIL", Direction: "out"}})
	if err != nil {
		t.Fatal(err)
	}
	got := results["txn-err"]
	if got.Outcome != OutcomeDeferred || got.ProblemCode != types.TransactionCategoryProblemProvider || got.Category != "" {
		t.Fatalf("provider failure=%+v", got)
	}
}

func TestMLClassifierNoRequestIsTerminalEvaluated(t *testing.T) {
	input := Input{TransactionID: "txn-empty", Name: "LOCAL SHOP", Direction: "out"}
	if len(CategoryJudgmentRequests(input)) != 0 {
		t.Fatal("test input unexpectedly emitted requests")
	}
	results, err := NewMLClassifier(stubProvider{err: errors.New("provider should not open")}).Classify(context.Background(), []Input{input})
	if err != nil {
		t.Fatal(err)
	}
	if got := results[input.TransactionID]; got.Outcome != OutcomeEvaluated || got.ProblemCode != "" {
		t.Fatalf("no-request outcome=%+v", got)
	}
}

func TestMLClassifierCancellationRemainsAnError(t *testing.T) {
	ctx, cancel := context.WithCancel(context.Background())
	cancel()
	if _, err := NewMLClassifier(stubProvider{}).Classify(ctx, []Input{{TransactionID: "txn-cancel", Name: "SHELL OIL", Direction: "out"}}); !errors.Is(err, context.Canceled) {
		t.Fatalf("cancellation error=%v", err)
	}
}

func TestMLClassifierProviderTimeoutIsDeferred(t *testing.T) {
	provider := stubProvider{err: fmt.Errorf("provider timeout: %w", context.DeadlineExceeded)}
	results, err := NewMLClassifier(provider).Classify(context.Background(), []Input{{TransactionID: "txn-timeout", Name: "SHELL OIL", Direction: "out"}})
	if err != nil {
		t.Fatal(err)
	}
	if got := results["txn-timeout"]; got.Outcome != OutcomeDeferred || got.ProblemCode != types.TransactionCategoryProblemProvider {
		t.Fatalf("provider timeout=%+v", got)
	}
}

func TestCompositeClassifierFallsBackOnMLError(t *testing.T) {
	composite := CompositeClassifier{
		ML:      NewMLClassifier(stubProvider{err: errors.New("provider down")}),
		Keyword: KeywordClassifier{},
	}
	if composite.Version() != "composite/ml-categories-v1+keyword-v1" {
		t.Fatalf("version=%q", composite.Version())
	}
	results, err := composite.Classify(context.Background(), []Input{{TransactionID: "txn-kw", Name: "SHELL OIL", Direction: "out"}})
	if err != nil {
		t.Fatal(err)
	}
	got, ok := results["txn-kw"]
	if !ok || got.Category != types.CategoryTransportation || got.Producer != "keyword-v1" {
		t.Fatalf("results=%+v", results)
	}
}

func TestCompositeClassifierCancellationRemainsAnError(t *testing.T) {
	composite := CompositeClassifier{
		ML:      NewMLClassifier(stubProvider{}),
		Keyword: KeywordClassifier{},
	}
	ctx, cancel := context.WithCancel(context.Background())
	cancel()
	if _, err := composite.Classify(ctx, []Input{{TransactionID: "txn-ml", Name: "QFC #5881", Direction: "out"}}); !errors.Is(err, context.Canceled) {
		t.Fatalf("cancellation error=%v", err)
	}
}

func TestCompositeClassifierDefinesEveryOutcomeOnMLError(t *testing.T) {
	composite := CompositeClassifier{
		ML:      NewMLClassifier(stubProvider{err: errors.New("provider down")}),
		Keyword: KeywordClassifier{},
	}
	inputs := []Input{
		{TransactionID: "txn-kw", Name: "SHELL OIL", Direction: "out"},
		{TransactionID: "txn-ml", Name: "QFC #5881", Direction: "out"},
		{TransactionID: "txn-empty", Name: "LOCAL SHOP", Direction: "out"},
	}
	results, err := composite.Classify(context.Background(), inputs)
	if err != nil {
		t.Fatal(err)
	}
	if got := results["txn-kw"]; got.Outcome != OutcomeAssigned || got.Category != types.CategoryTransportation {
		t.Fatalf("keyword answer=%+v", got)
	}
	if got := results["txn-ml"]; got.Outcome != OutcomeDeferred || got.ProblemCode != types.TransactionCategoryProblemProvider {
		t.Fatalf("provider failure=%+v", got)
	}
	if got := results["txn-empty"]; got.Outcome != OutcomeEvaluated {
		t.Fatalf("no-request outcome=%+v", got)
	}
}

func TestCompositeClassifierBackfillsSkippedTransactions(t *testing.T) {
	inputs := []Input{
		{TransactionID: "txn-kw", Name: "SHELL OIL", Direction: "out"},
		{TransactionID: "txn-ml", Name: "QFC #5881", Direction: "out"},
	}
	requests := CategoryJudgmentRequests(inputs[1])
	var judgments []types.AnalysisJudgment
	for _, request := range requests {
		judgments = append(judgments, types.AnalysisJudgment{RequestID: request.ID, Status: "ready", Decision: "supported", Strength: "strong"})
	}
	composite := CompositeClassifier{
		ML:      NewMLClassifier(stubProvider{session: stubSession{judgments: judgments}}),
		Keyword: KeywordClassifier{},
	}
	results, err := composite.Classify(context.Background(), inputs)
	if err != nil {
		t.Fatal(err)
	}
	if got := results["txn-kw"]; got.Category != types.CategoryTransportation || got.Producer != "keyword-v1" {
		t.Fatalf("keyword answer=%+v", results)
	}
	if got := results["txn-ml"]; got.Category != types.CategoryFoodAndDrink || got.Producer != "ml-categories-v1" {
		t.Fatalf("ml backfill=%+v", results)
	}
}

func TestCompositeClassifierNeverReplacesKeywordAnswers(t *testing.T) {
	// NETFLIX WHOLE FOODS is claimed by both sides with different answers:
	// keywords match WHOLE FOODS before the entertainment branch, while the
	// learner with all-supported judgments picks ENTERTAINMENT first in
	// CategoryKeys order. Only keyword-first keeps FOOD_AND_DRINK here; the
	// old ML-first order returns ENTERTAINMENT and fails this test.
	input := Input{TransactionID: "txn-both", Name: "NETFLIX WHOLE FOODS", Direction: "out"}
	var judgments []types.AnalysisJudgment
	for _, request := range CategoryJudgmentRequests(input) {
		judgments = append(judgments, types.AnalysisJudgment{RequestID: request.ID, Status: "ready", Decision: "supported", Strength: "strong"})
	}
	composite := CompositeClassifier{
		ML:      NewMLClassifier(stubProvider{session: stubSession{judgments: judgments}}),
		Keyword: KeywordClassifier{},
	}
	results, err := composite.Classify(context.Background(), []Input{input})
	if err != nil {
		t.Fatal(err)
	}
	if got := results["txn-both"]; got.Category != types.CategoryFoodAndDrink || got.Producer != "keyword-v1" {
		t.Fatalf("keyword answer replaced=%+v", results)
	}
}
