package integration

import (
	"context"
	"encoding/json"
	"net/http"
	"net/http/httptest"
	"reflect"
	"strings"
	"testing"
	"time"

	"github.com/google/uuid"
	"github.com/simhozebs/net-worth-estimator/backend/internal/simplefin"
	"github.com/simhozebs/net-worth-estimator/backend/internal/store"
	"github.com/simhozebs/net-worth-estimator/backend/internal/types"
)

func seedAPIFinding(t *testing.T, scoped store.Store) types.AnalysisFinding {
	t.Helper()
	if _, err := scoped.CreateAccount(types.Account{ID: "checking", Name: "Checking", Kind: types.AccountKindCash, Enabled: true}); err != nil {
		t.Fatal(err)
	}
	set := &simplefin.AccountSet{Accounts: []simplefin.Account{{ID: "bank", Currency: "USD", Balance: "100", Transactions: []simplefin.Transaction{{ID: "charge", Description: "Klarna Pay in 4", Amount: "-25", Posted: 1792454400}}}}}
	plan, err := simplefin.Map(set, map[string]string{"bank": "checking"}, time.Unix(1792454400, 0))
	if err != nil {
		t.Fatal(err)
	}
	_, err = scoped.ApplySyncPlan(nil, simplefin.Reconcile(plan.Pending, plan.Settled, nil, map[string]bool{"checking": true}))
	if err != nil {
		t.Fatal(err)
	}
	run, input, claimed, err := scoped.ClaimAnalysis("bnpl", "test-v1")
	if err != nil || !claimed || len(input.Transactions) != 1 {
		t.Fatalf("claim=%v %v %+v", claimed, err, input)
	}
	if err := scoped.CompleteAnalysis(run, []types.AnalysisDetection{{PostingID: input.Transactions[0].PostingID, Kind: "bnpl", Provider: "klarna", Strength: "strong"}}, ""); err != nil {
		t.Fatal(err)
	}
	items, err := scoped.ListAnalysisFindings(types.AnalysisFindingFilter{})
	if err != nil || len(items) != 1 {
		t.Fatalf("findings=%+v %v", items, err)
	}
	return items[0]
}

func TestAnalysisFeedbackHTTPContract(t *testing.T) {
	scoped := openAPIStore(t)
	finding := seedAPIFinding(t, scoped)
	before, _ := scoped.LoadDocument()
	request := func(handler http.Handler, method, path, body string) *httptest.ResponseRecorder {
		t.Helper()
		res := httptest.NewRecorder()
		req := httptest.NewRequest(method, path, strings.NewReader(body))
		req.Header.Set("Content-Type", "application/json")
		handler.ServeHTTP(res, req)
		return res
	}
	input := types.AnalysisFeedbackInput{RequestID: uuid.NewString(), RunID: finding.RunID, Action: "confirm"}
	body, _ := json.Marshal(input)
	path := "/v1/analysis-findings/" + finding.ID + "/feedback"
	for _, config := range []Config{{ReadOnly: true}, {CanWrite: func(context.Context) bool { return false }}} {
		res := request(New(scoped, config), "POST", path, string(body))
		if res.Code != 403 {
			t.Fatalf("guard=%d %s", res.Code, res.Body.String())
		}
	}
	handler := New(scoped, Config{Actor: func(context.Context) string { return "verified-subject" }})
	res := request(handler, "POST", path, string(body))
	if res.Code != 200 || res.Header().Get("Cache-Control") != "private, no-store" {
		t.Fatalf("confirm=%d %s", res.Code, res.Body.String())
	}
	var output struct {
		Feedback types.AnalysisFeedback `json:"feedback"`
	}
	if err := json.Unmarshal(res.Body.Bytes(), &output); err != nil {
		t.Fatal(err)
	}
	if output.Feedback.Actor != "verified-subject" || output.Feedback.Review.Decision != "confirmed" {
		t.Fatalf("event=%+v", output)
	}
	replay := request(handler, "POST", path, string(body))
	if replay.Code != 200 || replay.Body.String() != res.Body.String() {
		t.Fatalf("replay=%d %s", replay.Code, replay.Body.String())
	}
	input.RequestID = uuid.NewString()
	body, _ = json.Marshal(input)
	if res := request(handler, "POST", path, string(body)); res.Code != 409 {
		t.Fatalf("stale=%d %s", res.Code, res.Body.String())
	}
	input.Revision = 1
	input.Action = "set-duration"
	input.Duration = &types.AnalysisDuration{Count: 6, Unit: "months"}
	body, _ = json.Marshal(input)
	if res := request(handler, "POST", path, string(body)); res.Code != 200 {
		t.Fatalf("duration=%d %s", res.Code, res.Body.String())
	}
	input.RequestID = uuid.NewString()
	input.Revision = 2
	input.Duration.Count = 0
	body, _ = json.Marshal(input)
	if res := request(handler, "POST", path, string(body)); res.Code != 422 {
		t.Fatalf("invalid=%d %s", res.Code, res.Body.String())
	}
	input.Duration.Count = 6
	body, _ = json.Marshal(input)
	if res := request(handler, "POST", "/v1/analysis-findings/missing/feedback", string(body)); res.Code != 404 {
		t.Fatalf("missing=%d", res.Code)
	}
	res = request(handler, "GET", "/v1/analysis-feedback?findingId="+finding.ID+"&limit=1", "")
	var history struct {
		Feedback   []types.AnalysisFeedback `json:"feedback"`
		NextCursor string                   `json:"nextCursor"`
	}
	if res.Code != 200 || res.Header().Get("Cache-Control") != "private, no-store" || json.Unmarshal(res.Body.Bytes(), &history) != nil || len(history.Feedback) != 1 || history.NextCursor == "" {
		t.Fatalf("history=%d %s", res.Code, res.Body.String())
	}
	res = request(handler, "GET", "/v1/analysis-feedback?cursor="+history.NextCursor, "")
	if res.Code != 200 || json.Unmarshal(res.Body.Bytes(), &history) != nil || len(history.Feedback) != 1 || history.Feedback[0].Request.Action != "set-duration" {
		t.Fatalf("next=%d %s", res.Code, res.Body.String())
	}
	after, _ := scoped.LoadDocument()
	if !reflect.DeepEqual(before, after) {
		t.Fatal("feedback changed financial model")
	}
	for _, body := range []string{`{"dismissed":true}`, `{"dismissed":false}`} {
		res := request(handler, "PATCH", "/v1/analysis-findings/"+finding.ID, body)
		if res.Code != 200 {
			t.Fatalf("visibility=%d %s", res.Code, res.Body.String())
		}
	}
	events, err := scoped.ListAnalysisFeedback(types.AnalysisFeedbackFilter{})
	if err != nil || len(events) != 4 {
		t.Fatalf("visibility history=%+v %v", events, err)
	}
	for _, event := range events {
		if event.Actor != "verified-subject" {
			t.Fatalf("inconsistent actor=%q", event.Actor)
		}
	}
}
