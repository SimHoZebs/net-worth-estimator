package analysis_test

import (
	"context"
	"path/filepath"
	"testing"

	"github.com/google/uuid"
	"github.com/simhozebs/net-worth-estimator/backend/internal/analysis"
	"github.com/simhozebs/net-worth-estimator/backend/internal/judgment"
	"github.com/simhozebs/net-worth-estimator/backend/internal/store/adapters/sqlite"
	"github.com/simhozebs/net-worth-estimator/backend/internal/types"
)

// A response-only implementation has no training API, example count, feature
// vector, cursor, or model state. A real LLM adapter can implement the same port.
type responseOnlyProvider struct{}

func (responseOnlyProvider) Open(context.Context, judgment.FeedbackSource) (judgment.Session, error) {
	return fixedJudgmentSession{revision: "response-policy-v1"}, nil
}

// A human-queue implementation returns pending immediately, then changes its
// opaque revision when a reviewer supplies a decision for an exact request ID.
type queuedProvider struct {
	revision string
	requests map[string]types.AnalysisJudgmentInput
	answers  map[string]types.AnalysisJudgment
}

func (q *queuedProvider) Open(context.Context, judgment.FeedbackSource) (judgment.Session, error) {
	return queuedSession{q, q.revision}, nil
}

type queuedSession struct {
	queue    *queuedProvider
	revision string
}

func (s queuedSession) Revision() string { return s.revision }
func (s queuedSession) Evaluate(_ context.Context, requests []types.AnalysisJudgmentInput) ([]types.AnalysisJudgment, error) {
	var decisions []types.AnalysisJudgment
	for _, request := range requests {
		s.queue.requests[request.ID] = request
		decision, ok := s.queue.answers[request.ID]
		if !ok {
			decision = types.AnalysisJudgment{RequestID: request.ID, Status: "pending"}
		}
		decisions = append(decisions, decision)
	}
	return decisions, nil
}

func TestIncomeWorksWithResponseOnlyProviderThatIgnoresFeedback(t *testing.T) {
	db, err := sqlite.SetupDatabase(filepath.Join(t.TempDir(), "app.db"))
	if err != nil {
		t.Fatal(err)
	}
	defer db.Close()
	scoped := seedIncomeUser(t, db, "owner")
	runner, err := analysis.NewRunner(db, analysis.NewPaymentPatterns(responseOnlyProvider{}))
	if err != nil {
		t.Fatal(err)
	}
	if err := runner.RunOnce(context.Background()); err != nil {
		t.Fatal(err)
	}
	finding := incomeFindings(t, scoped)[0]
	if finding.Judgment == nil || finding.Judgment.Status != "ready" || finding.Strength != "strong" {
		t.Fatalf("finding=%+v", finding)
	}
	if _, err := scoped.ReviewAnalysisFinding(finding.ID, types.AnalysisFeedbackInput{RequestID: uuid.NewString(), RunID: finding.RunID, Revision: finding.FeedbackRevision, Action: "reject"}); err != nil {
		t.Fatal(err)
	}
	if err := runner.RunOnce(context.Background()); err != nil {
		t.Fatal(err)
	}
	events, err := scoped.ListAnalysisFeedback(types.AnalysisFeedbackFilter{})
	if err != nil || len(events) != 1 || events[0].Prediction.JudgmentInput.ID != finding.JudgmentInput.ID {
		t.Fatal("non-learning provider lost audited feedback")
	}
}

func TestIncomeHumanQueuePendingThenReadyWithoutBankChanges(t *testing.T) {
	db, err := sqlite.SetupDatabase(filepath.Join(t.TempDir(), "app.db"))
	if err != nil {
		t.Fatal(err)
	}
	defer db.Close()
	scoped := seedIncomeUser(t, db, "owner")
	queue := &queuedProvider{revision: "queue:0", requests: map[string]types.AnalysisJudgmentInput{}, answers: map[string]types.AnalysisJudgment{}}
	runner, err := analysis.NewRunner(db, analysis.NewPaymentPatterns(queue))
	if err != nil {
		t.Fatal(err)
	}
	if err := runner.RunOnce(context.Background()); err != nil {
		t.Fatal(err)
	}
	before := incomeFindings(t, scoped)[0]
	if before.Judgment.Status != "pending" || len(queue.requests) != 1 {
		t.Fatal("pending judgment was not published")
	}
	runs, _, err := scoped.ListAnalysisRuns()
	if err != nil || len(runs) != 1 || runs[0].State != "succeeded" || runs[0].Problem != types.JudgmentPending {
		t.Fatalf("runs=%+v err=%v", runs, err)
	}
	queue.answers[before.JudgmentInput.ID] = types.AnalysisJudgment{RequestID: before.JudgmentInput.ID, Status: "ready", Decision: "uncertain", Strength: "moderate", Reason: "Reviewer could not establish income."}
	queue.revision = "queue:1"
	if err := runner.RunOnce(context.Background()); err != nil {
		t.Fatal(err)
	}
	after := incomeFindings(t, scoped)[0]
	if after.Judgment.Status != "ready" || after.Strength != "moderate" || after.InputRevision != before.InputRevision || after.RunID == before.RunID {
		t.Fatal("late human decision did not refresh the saved finding")
	}
	if after.Review != nil {
		t.Fatal("provider judgment invented a user's explicit answer")
	}
}
