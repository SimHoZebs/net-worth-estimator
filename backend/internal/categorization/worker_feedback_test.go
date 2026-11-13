package categorization_test

import (
	"context"
	"testing"

	"github.com/simhozebs/net-worth-estimator/backend/internal/categorization"
	"github.com/simhozebs/net-worth-estimator/backend/internal/judgment"
	"github.com/simhozebs/net-worth-estimator/backend/internal/types"
)

type captureSession struct{ judgments []types.AnalysisJudgment }

func (captureSession) Revision() string { return "capture" }

func (s captureSession) Evaluate(context.Context, []types.AnalysisJudgmentInput) ([]types.AnalysisJudgment, error) {
	return s.judgments, nil
}

type captureProvider struct {
	sources []judgment.FeedbackSource
}

func (p *captureProvider) Open(_ context.Context, source judgment.FeedbackSource) (judgment.Session, error) {
	p.sources = append(p.sources, source)
	return captureSession{}, nil
}

func TestWorkerDeliversJournalThroughSessionOpen(t *testing.T) {
	scoped, database := newCategoryStore(t)
	transactionID := seedCharge(t, scoped, "SHELL OIL", "gas", "")
	provider := &captureProvider{}
	classifier := categorization.NewMLClassifier(provider)
	worker, err := categorization.NewWorker(database, classifier)
	if err != nil {
		t.Fatal(err)
	}
	if err := worker.RunOnce(context.Background()); err != nil {
		t.Fatal(err)
	}
	if len(provider.sources) != 1 {
		t.Fatalf("sources=%d", len(provider.sources))
	}
	source := provider.sources[0]
	// The worker wires the user's journal on every tick, namespaced away
	// from the payment checkpoint that shares the learner.
	if source.Owner() != "categorization:category-user" {
		t.Fatalf("owner=%q", source.Owner())
	}
	page, err := source.Page("", 200)
	if err != nil {
		t.Fatal(err)
	}
	if len(page.Feedback) != 0 || page.Cursor != "" {
		t.Fatalf("empty journal must open clean=%+v", page)
	}
	// A fresh user label exists but has not matured: delivery holds it.
	// The assignment also removes the only candidate, so the second tick
	// opens nothing new; the tick-one source already sees the journal.
	travel := types.CategoryTravel
	if _, err := scoped.SetUserTransactionCategory(transactionID, &travel); err != nil {
		t.Fatal(err)
	}
	if err := worker.RunOnce(context.Background()); err != nil {
		t.Fatal(err)
	}
	if len(provider.sources) != 1 {
		t.Fatalf("sources=%d", len(provider.sources))
	}
	held, err := provider.sources[0].Page("", 200)
	if err != nil {
		t.Fatal(err)
	}
	if len(held.Feedback) != 0 || held.Cursor != "" {
		t.Fatalf("fresh label trained=%+v", held)
	}
}
