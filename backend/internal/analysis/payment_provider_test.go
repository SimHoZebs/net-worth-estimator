package analysis

import (
	"testing"
	"time"

	"github.com/simhozebs/net-worth-estimator/backend/internal/judgment"
	"github.com/simhozebs/net-worth-estimator/backend/internal/store"
	"github.com/simhozebs/net-worth-estimator/backend/internal/types"
)

type stubPaymentFeedbackStore struct {
	store.AnalysisStore
	events []types.AnalysisFeedback
}

func (s *stubPaymentFeedbackStore) ListAnalysisFeedback(filter types.AnalysisFeedbackFilter) ([]types.AnalysisFeedback, error) {
	out := []types.AnalysisFeedback{}
	for _, event := range s.events {
		if event.ID <= filter.Cursor {
			continue
		}
		out = append(out, event)
		if filter.Limit > 0 && len(out) >= filter.Limit {
			break
		}
	}
	return out, nil
}

func paymentEvent(id, findingID, analysisType, action, requestID string, createdAt int64) types.AnalysisFeedback {
	event := types.AnalysisFeedback{
		ID: id, FindingID: findingID, TransactionID: "txn",
		AnalysisType: analysisType, RunID: "run-1", CreatedAt: createdAt,
		Request: types.AnalysisFeedbackInput{Action: action},
	}
	if requestID != "" {
		event.Prediction = types.AnalysisDetection{JudgmentInput: &types.AnalysisJudgmentInput{ID: requestID, Kind: "income"}}
	}
	return event
}

func fixedPaymentSource(events []types.AnalysisFeedback, now time.Time) paymentFeedbackSource {
	return paymentFeedbackSource{scoped: &stubPaymentFeedbackStore{events: events}, owner: "owner-1", now: func() time.Time { return now }}
}

var paymentNow = time.Unix(1785628800, 0)

func maturedPayment(at time.Time) int64 { return at.Add(-judgment.FeedbackQuarantine).Unix() }

func TestPaymentPageKeepsOldFlowForMatured(t *testing.T) {
	old := maturedPayment(paymentNow)
	events := []types.AnalysisFeedback{
		paymentEvent("event-001", "finding-bnpl", "bnpl", "confirm", "request-bnpl", old),
		paymentEvent("event-002", "finding-hide", "payments", "hide", "request-hide", old),
		paymentEvent("event-003", "finding-pay", "payments", "confirm", "request-pay", old),
		paymentEvent("event-004", "finding-reject", "payments", "reject", "request-reject", old),
	}
	source := fixedPaymentSource(events, paymentNow)
	page, err := source.Page("", 200)
	if err != nil {
		t.Fatal(err)
	}
	if len(page.Feedback) != 2 {
		t.Fatalf("feedback=%+v", page.Feedback)
	}
	if page.Feedback[0].EventID != "event-003" || page.Feedback[0].Action != "confirm" {
		t.Fatalf("first=%+v", page.Feedback[0])
	}
	if page.Feedback[1].EventID != "event-004" || page.Feedback[1].Action != "reject" {
		t.Fatalf("second=%+v", page.Feedback[1])
	}
	// Non-label events still advance the checkpoint exactly like before.
	if page.Cursor != "event-004" {
		t.Fatalf("cursor=%q", page.Cursor)
	}
	next, err := source.Page(page.Cursor, 200)
	if err != nil {
		t.Fatal(err)
	}
	if len(next.Feedback) != 0 || next.Cursor != page.Cursor {
		t.Fatalf("redelivery=%+v cursor=%q", next.Feedback, next.Cursor)
	}
}

func TestPaymentPageHoldsFreshAnswers(t *testing.T) {
	old := maturedPayment(paymentNow)
	events := []types.AnalysisFeedback{
		paymentEvent("event-001", "finding-old", "payments", "confirm", "request-old", old),
		paymentEvent("event-002", "finding-fresh", "payments", "confirm", "request-fresh", paymentNow.Unix()),
	}
	source := fixedPaymentSource(events, paymentNow)
	page, err := source.Page("", 200)
	if err != nil {
		t.Fatal(err)
	}
	if len(page.Feedback) != 1 || page.Feedback[0].EventID != "event-001" {
		t.Fatalf("feedback=%+v", page.Feedback)
	}
	if page.Cursor != "event-001" {
		t.Fatalf("cursor trained past a fresh answer=%q", page.Cursor)
	}
	held, err := source.Page(page.Cursor, 200)
	if err != nil {
		t.Fatal(err)
	}
	if len(held.Feedback) != 0 || held.Cursor != page.Cursor {
		t.Fatalf("fresh answer leaked=%+v cursor=%q", held.Feedback, held.Cursor)
	}
	// Quarantine is inclusive: an answer exactly fourteen days old trains.
	matured, err := fixedPaymentSource(events, paymentNow.Add(14*24*time.Hour)).Page(page.Cursor, 200)
	if err != nil {
		t.Fatal(err)
	}
	if len(matured.Feedback) != 1 || matured.Feedback[0].EventID != "event-002" {
		t.Fatalf("boundary answer held=%+v", matured.Feedback)
	}
}

func TestPaymentPageLatestWinsPerJudgmentRequest(t *testing.T) {
	old := maturedPayment(paymentNow)
	events := []types.AnalysisFeedback{
		paymentEvent("event-001", "finding-a", "payments", "reject", "request-same", old),
		paymentEvent("event-002", "finding-a", "payments", "confirm", "request-same", old),
	}
	source := fixedPaymentSource(events, paymentNow)
	page, err := source.Page("", 200)
	if err != nil {
		t.Fatal(err)
	}
	// Single-shot immutable answers never repeat a request; the rule is a
	// safeguard that absorbs the superseded review.
	if len(page.Feedback) != 1 || page.Feedback[0].EventID != "event-002" || page.Feedback[0].Action != "confirm" {
		t.Fatalf("feedback=%+v", page.Feedback)
	}
	if page.Cursor != "event-002" {
		t.Fatalf("cursor=%q", page.Cursor)
	}
}

func TestPaymentPagePaginates(t *testing.T) {
	old := maturedPayment(paymentNow)
	events := []types.AnalysisFeedback{
		paymentEvent("event-001", "finding-a", "payments", "confirm", "request-a", old),
		paymentEvent("event-002", "finding-b", "payments", "confirm", "request-b", old),
	}
	source := fixedPaymentSource(events, paymentNow)
	first, err := source.Page("", 1)
	if err != nil {
		t.Fatal(err)
	}
	if len(first.Feedback) != 1 || first.Cursor != "event-001" {
		t.Fatalf("first=%+v", first)
	}
	second, err := source.Page(first.Cursor, 1)
	if err != nil {
		t.Fatal(err)
	}
	if len(second.Feedback) != 1 || second.Feedback[0].EventID != "event-002" || second.Cursor != "event-002" {
		t.Fatalf("second=%+v", second)
	}
}

func TestPaymentPageKeepsMissingEvidenceError(t *testing.T) {
	old := maturedPayment(paymentNow)
	events := []types.AnalysisFeedback{
		paymentEvent("event-001", "finding-broken", "payments", "confirm", "", old),
	}
	if _, err := fixedPaymentSource(events, paymentNow).Page("", 200); err == nil {
		t.Fatal("missing reviewed evidence was swallowed")
	}
}

func TestPaymentPageTrainingGatePausesDelivery(t *testing.T) {
	t.Setenv("ML_TRAINING", "0")
	old := maturedPayment(paymentNow)
	events := []types.AnalysisFeedback{
		paymentEvent("event-001", "finding-a", "payments", "confirm", "request-a", old),
	}
	page, err := fixedPaymentSource(events, paymentNow).Page("", 200)
	if err != nil {
		t.Fatal(err)
	}
	if len(page.Feedback) != 0 || page.Cursor != "" {
		t.Fatalf("gate ignored=%+v", page)
	}
}
