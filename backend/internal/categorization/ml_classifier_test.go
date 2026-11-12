package categorization

import (
	"context"
	"errors"
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
	if len(results) != 0 {
		t.Fatalf("weak judgments classified: %+v", results)
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

func TestMLClassifierSurfacesProviderErrors(t *testing.T) {
	provider := stubProvider{err: errors.New("provider down")}
	if _, err := NewMLClassifier(provider).Classify(context.Background(), []Input{{TransactionID: "txn-err", Name: "SHELL OIL", Direction: "out"}}); err == nil {
		t.Fatal("provider error swallowed")
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

func TestCompositeClassifierBackfillsSkippedTransactions(t *testing.T) {
	inputs := []Input{
		{TransactionID: "txn-ml", Name: "SHELL OIL", Direction: "out"},
		{TransactionID: "txn-kw", Name: "WHOLE FOODS", Direction: "out"},
	}
	requests := CategoryJudgmentRequests(inputs[0])
	mlOnly := map[string]bool{}
	for _, request := range requests {
		mlOnly[request.ID] = true
	}
	var judgments []types.AnalysisJudgment
	for _, input := range inputs {
		for _, request := range CategoryJudgmentRequests(input) {
			if mlOnly[request.ID] {
				judgments = append(judgments, types.AnalysisJudgment{RequestID: request.ID, Status: "ready", Decision: "supported", Strength: "strong"})
			}
		}
	}
	composite := CompositeClassifier{
		ML:      NewMLClassifier(stubProvider{session: stubSession{judgments: judgments}}),
		Keyword: KeywordClassifier{},
	}
	results, err := composite.Classify(context.Background(), inputs)
	if err != nil {
		t.Fatal(err)
	}
	if results["txn-ml"].Producer != "ml-categories-v1" {
		t.Fatalf("ml result=%+v", results)
	}
	if got := results["txn-kw"]; got.Category != types.CategoryFoodAndDrink || got.Producer != "keyword-v1" {
		t.Fatalf("keyword backfill=%+v", results)
	}
}
