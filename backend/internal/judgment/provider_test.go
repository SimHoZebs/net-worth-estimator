package judgment_test

import (
	"context"
	"encoding/json"
	"errors"
	"net/http"
	"net/http/httptest"
	"strings"
	"testing"
	"time"

	"github.com/simhozebs/net-worth-estimator/backend/internal/judgment"
	"github.com/simhozebs/net-worth-estimator/backend/internal/types"
)

type evaluator func(context.Context, []types.AnalysisJudgmentInput) ([]types.AnalysisJudgment, error)

func (f evaluator) Evaluate(ctx context.Context, requests []types.AnalysisJudgmentInput) ([]types.AnalysisJudgment, error) {
	return f(ctx, requests)
}

func TestAssessmentValidatesExactRequestsAndDeferredStates(t *testing.T) {
	requests := []types.AnalysisJudgmentInput{{ID: "a"}, {ID: "b"}}
	ready := types.AnalysisJudgment{RequestID: "a", Status: "ready", Decision: "supported", Strength: "strong"}
	for _, tc := range []struct {
		name        string
		decisions   []types.AnalysisJudgment
		want        error
		firstStatus string
	}{
		{"ready", []types.AnalysisJudgment{ready, {RequestID: "b", Status: "ready", Decision: "uncertain", Strength: "moderate"}}, nil, "ready"},
		{"negative", []types.AnalysisJudgment{ready, {RequestID: "b", Status: "ready", Decision: "unsupported", Strength: "strong"}}, nil, "ready"},
		{"invalid decision", []types.AnalysisJudgment{ready, {RequestID: "b", Status: "ready", Decision: "maybe", Strength: "strong"}}, judgment.ErrUnavailable, "unavailable"},
		{"mixed pending", []types.AnalysisJudgment{ready, {RequestID: "b", Status: "pending"}}, judgment.ErrPending, "ready"},
		{"unavailable", []types.AnalysisJudgment{ready, {RequestID: "b", Status: "unavailable"}}, judgment.ErrUnavailable, "ready"},
		{"missing response", []types.AnalysisJudgment{ready}, judgment.ErrUnavailable, "unavailable"},
		{"duplicate response", []types.AnalysisJudgment{ready, ready}, judgment.ErrUnavailable, "unavailable"},
		{"different request", []types.AnalysisJudgment{ready, {RequestID: "other", Status: "ready", Strength: "strong"}}, judgment.ErrUnavailable, "unavailable"},
		{"pending cannot invent strength", []types.AnalysisJudgment{ready, {RequestID: "b", Status: "pending", Strength: "strong"}}, judgment.ErrUnavailable, "unavailable"},
		{"invalid strength", []types.AnalysisJudgment{ready, {RequestID: "b", Status: "ready", Strength: "certain"}}, judgment.ErrUnavailable, "unavailable"},
		{"bounded reason", []types.AnalysisJudgment{ready, {RequestID: "b", Status: "ready", Strength: "strong", Reason: strings.Repeat("x", 2001)}}, judgment.ErrUnavailable, "unavailable"},
	} {
		t.Run(tc.name, func(t *testing.T) {
			decisions, err := judgment.Assess(context.Background(), evaluator(func(context.Context, []types.AnalysisJudgmentInput) ([]types.AnalysisJudgment, error) {
				return tc.decisions, nil
			}), requests)
			if !errors.Is(err, tc.want) || len(decisions) != 2 || decisions[0].Status != tc.firstStatus {
				t.Fatalf("decisions=%+v err=%v", decisions, err)
			}
		})
	}
}

type feedbackSource struct{ cursors []string }

func (*feedbackSource) Owner() string { return "store-owner" }
func (s *feedbackSource) Page(after string, _ int) (judgment.FeedbackPage, error) {
	s.cursors = append(s.cursors, after)
	if after == "" {
		return judgment.FeedbackPage{Cursor: "event-1", Feedback: []judgment.Feedback{{EventID: "event-1", RunID: "reviewed-run", Action: "confirm", Request: types.AnalysisJudgmentInput{ID: "exact-request", Kind: "income", PatternID: "account-pattern", Pattern: types.JudgmentPattern{TypicalAmount: "25000.00"}}}}}, nil
	}
	return judgment.FeedbackPage{Cursor: after, Feedback: []judgment.Feedback{}}, nil
}

func TestHTTPProviderOwnsFeedbackDeliveryAndSupportsPending(t *testing.T) {
	cursor := ""
	deliveries := 0
	loseAck := true
	server := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		w.Header().Set("Content-Type", "application/json")
		switch r.URL.Path {
		case "/state":
			_ = json.NewEncoder(w).Encode(map[string]string{"revision": "opaque-epoch:1", "cursor": cursor})
		case "/feedback":
			var batch struct {
				Owner string `json:"owner"`
				After string `json:"after"`
				judgment.FeedbackPage
			}
			if err := json.NewDecoder(r.Body).Decode(&batch); err != nil {
				t.Error(err)
				return
			}
			if batch.Owner != "store-owner" || len(batch.Feedback) != 1 || batch.Feedback[0].Request.Pattern.TypicalAmount != "25000.00" || batch.Feedback[0].Action != "confirm" {
				t.Errorf("batch=%+v", batch)
			}
			cursor = batch.Cursor
			deliveries++
			if loseAck {
				loseAck = false
				w.WriteHeader(503)
				return
			}
			_ = json.NewEncoder(w).Encode(map[string]string{"cursor": cursor})
		case "/evaluate":
			var input struct {
				Requests []types.AnalysisJudgmentInput `json:"requests"`
			}
			if err := json.NewDecoder(r.Body).Decode(&input); err != nil {
				t.Error(err)
				return
			}
			_ = json.NewEncoder(w).Encode(map[string]any{"judgments": []types.AnalysisJudgment{{RequestID: input.Requests[0].ID, Status: "pending"}}})
		default:
			http.NotFound(w, r)
		}
	}))
	defer server.Close()
	provider := judgment.NewHTTPProvider(server.URL, time.Second)
	source := &feedbackSource{}
	if _, err := provider.Open(context.Background(), source); err == nil {
		t.Fatal("lost acknowledgement was ignored")
	}
	session, err := provider.Open(context.Background(), source)
	if err != nil {
		t.Fatal(err)
	}
	if deliveries != 1 || !strings.HasSuffix(session.Revision(), "opaque-epoch:1") {
		t.Fatalf("deliveries=%d revision=%s", deliveries, session.Revision())
	}
	results, err := judgment.Assess(context.Background(), session, []types.AnalysisJudgmentInput{{ID: "exact-request"}})
	if !errors.Is(err, judgment.ErrPending) || results[0].Status != "pending" {
		t.Fatalf("results=%+v err=%v", results, err)
	}
}
