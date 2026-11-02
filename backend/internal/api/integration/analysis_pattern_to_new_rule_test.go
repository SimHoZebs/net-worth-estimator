package integration

import (
	"context"
	"encoding/json"
	"net/http"
	"net/http/httptest"
	"strings"
	"testing"
	"time"

	"github.com/google/uuid"
	"github.com/simhozebs/net-worth-estimator/backend/internal/simplefin"
	"github.com/simhozebs/net-worth-estimator/backend/internal/store"
	"github.com/simhozebs/net-worth-estimator/backend/internal/types"
)

func seedAPIRecurringPattern(t *testing.T, scoped store.Store, cadence string) []types.AnalysisFinding {
	t.Helper()
	if _, err := scoped.CreateAccount(types.Account{ID: "checking", Name: "Checking", Kind: types.AccountKindCash, Enabled: true}); err != nil {
		t.Fatal(err)
	}
	posted := []int64{
		time.Date(2026, 1, 15, 12, 0, 0, 0, time.UTC).Unix(),
		time.Date(2026, 2, 15, 12, 0, 0, 0, time.UTC).Unix(),
		time.Date(2026, 3, 15, 12, 0, 0, 0, time.UTC).Unix(),
	}
	transactions := make([]simplefin.Transaction, 0, len(posted))
	for i, stamp := range posted {
		transactions = append(transactions, simplefin.Transaction{ID: "grocery-" + string(rune('a'+i)), Description: "GROCER 123", Amount: "-30", Posted: stamp})
	}
	set := &simplefin.AccountSet{Accounts: []simplefin.Account{{ID: "bank", Currency: "USD", Balance: "100", Transactions: transactions}}}
	plan, err := simplefin.Map(set, map[string]string{"bank": "checking"}, time.Unix(posted[2], 0))
	if err != nil {
		t.Fatal(err)
	}
	if _, err := scoped.ApplySyncPlan(nil, simplefin.Reconcile(plan.Pending, plan.Settled, nil, map[string]bool{"checking": true})); err != nil {
		t.Fatal(err)
	}
	run, input, claimed, err := scoped.ClaimAnalysis("recurring", "test-v1")
	if err != nil || !claimed || len(input.Transactions) != 3 {
		t.Fatalf("claim=%v %v %+v", claimed, err, input)
	}
	ids := []string{input.Transactions[0].PostingID, input.Transactions[1].PostingID, input.Transactions[2].PostingID}
	detections := make([]types.AnalysisDetection, 0, len(ids))
	for _, id := range ids {
		detections = append(detections, types.AnalysisDetection{PostingID: id, Kind: "recurring", Provider: "grocer", Product: cadence, Role: "outflow", Strength: "moderate",
			Evidence: []types.AnalysisEvidence{{Code: "recurring.cadence", Reason: "test pattern", PostingIDs: ids}}})
	}
	if err := scoped.CompleteAnalysis(run, detections, ""); err != nil {
		t.Fatal(err)
	}
	items, err := scoped.ListAnalysisFindings(types.AnalysisFindingFilter{})
	if err != nil || len(items) != 3 {
		t.Fatalf("findings=%+v err=%v", items, err)
	}
	return items
}

func confirmAPIFinding(t *testing.T, handler http.Handler, finding types.AnalysisFinding) {
	t.Helper()
	input := types.AnalysisFeedbackInput{RequestID: uuid.NewString(), RunID: finding.RunID, Action: "confirm"}
	body, _ := json.Marshal(input)
	res := httptest.NewRecorder()
	req := httptest.NewRequest("POST", "/v1/analysis-findings/"+finding.ID+"/feedback", strings.NewReader(string(body)))
	req.Header.Set("Content-Type", "application/json")
	handler.ServeHTTP(res, req)
	if res.Code != 200 {
		t.Fatalf("confirm=%d %s", res.Code, res.Body.String())
	}
}

func callAPI(t *testing.T, handler http.Handler, method, path, body string) *httptest.ResponseRecorder {
	t.Helper()
	res := httptest.NewRecorder()
	req := httptest.NewRequest(method, path, strings.NewReader(body))
	req.Header.Set("Content-Type", "application/json")
	handler.ServeHTTP(res, req)
	return res
}

func TestPatternToNewRuleHTTPContract(t *testing.T) {
	scoped := openAPIStore(t)
	findings := seedAPIRecurringPattern(t, scoped, "monthly")
	handler := New(scoped, Config{})
	previewPath := "/v1/analysis-findings/" + findings[0].ID + "/pattern-to-new-rule-preview"
	createPath := "/v1/analysis-findings/" + findings[0].ID + "/pattern-to-new-rule"

	var preview struct {
		Preview types.PatternToNewRulePreview `json:"preview"`
	}
	res := callAPI(t, handler, "GET", previewPath, "")
	if res.Code != 200 || res.Header().Get("Cache-Control") != "private, no-store" {
		t.Fatalf("preview=%d %s", res.Code, res.Body.String())
	}
	if err := json.Unmarshal(res.Body.Bytes(), &preview); err != nil {
		t.Fatal(err)
	}
	if preview.Preview.Creatable {
		t.Fatal("unconfirmed pattern previews as creatable")
	}
	if res := callAPI(t, handler, "POST", createPath, ""); res.Code != 409 {
		t.Fatalf("unconfirmed create=%d %s", res.Code, res.Body.String())
	}
	confirmAPIFinding(t, handler, findings[0])
	res = callAPI(t, handler, "GET", previewPath, "")
	if res.Code != 200 {
		t.Fatalf("preview=%d %s", res.Code, res.Body.String())
	}
	preview = struct {
		Preview types.PatternToNewRulePreview `json:"preview"`
	}{}
	if err := json.Unmarshal(res.Body.Bytes(), &preview); err != nil {
		t.Fatal(err)
	}
	if !preview.Preview.Creatable || preview.Preview.Rule == nil || preview.Preview.Rule.Frequency != types.FrequencyMonthly || preview.Preview.Rule.StartDate != "2026-04-15" {
		t.Fatalf("preview=%+v", preview.Preview)
	}
	if len(preview.Preview.Upcoming) != 6 || preview.Preview.Upcoming[0].Date != "2026-04-15" {
		t.Fatalf("upcoming=%+v", preview.Preview.Upcoming)
	}
	for _, item := range preview.Preview.Upcoming {
		if item.Date <= "2026-03-15" {
			t.Fatalf("forecast duplicates recorded movement: %+v", preview.Preview.Upcoming)
		}
	}
	var created struct {
		Row        types.RecurrenceRule         `json:"row"`
		Issues     []types.ModelValidationIssue `json:"issues"`
		Persisted  bool                         `json:"persisted"`
		Revision   string                       `json:"revision"`
		PatternKey string                       `json:"patternKey"`
	}
	res = callAPI(t, handler, "POST", createPath, "")
	if res.Code != 200 {
		t.Fatalf("create=%d %s", res.Code, res.Body.String())
	}
	if err := json.Unmarshal(res.Body.Bytes(), &created); err != nil {
		t.Fatal(err)
	}
	if !created.Persisted || created.Row.Frequency != types.FrequencyMonthly || created.Row.StartDate != "2026-04-15" || !created.Row.Enabled || created.PatternKey == "" {
		t.Fatalf("created=%+v", created)
	}
	model, err := scoped.LoadModel()
	if err != nil || len(model.RecurrenceRules) != 1 {
		t.Fatalf("model=%+v err=%v", model, err)
	}
	res = callAPI(t, handler, "GET", previewPath, "")
	preview = struct {
		Preview types.PatternToNewRulePreview `json:"preview"`
	}{}
	if err := json.Unmarshal(res.Body.Bytes(), &preview); err != nil {
		t.Fatal(err)
	}
	if preview.Preview.Creatable || preview.Preview.ExistingRuleID != created.Row.ID {
		t.Fatalf("second preview=%+v", preview.Preview)
	}
	if res := callAPI(t, handler, "POST", createPath, ""); res.Code != 409 {
		t.Fatalf("second create=%d %s", res.Code, res.Body.String())
	}
	disable, _ := json.Marshal(map[string]any{
		"name": created.Row.Name, "sourceAccountId": "checking", "amount": created.Row.Amount,
		"frequency": created.Row.Frequency, "startDate": created.Row.StartDate, "enabled": false,
	})
	if res := callAPI(t, handler, "PATCH", "/v1/recurrence-rules/"+created.Row.ID, string(disable)); res.Code != 200 {
		t.Fatalf("disable=%d %s", res.Code, res.Body.String())
	}
	res = callAPI(t, handler, "POST", createPath, "")
	if res.Code != 200 {
		t.Fatalf("recreate=%d %s", res.Code, res.Body.String())
	}
	var second struct {
		Row       types.RecurrenceRule `json:"row"`
		Persisted bool                 `json:"persisted"`
	}
	if err := json.Unmarshal(res.Body.Bytes(), &second); err != nil {
		t.Fatal(err)
	}
	if !second.Persisted || second.Row.ID == created.Row.ID {
		t.Fatalf("recreate=%+v", second)
	}
	if res := callAPI(t, handler, "DELETE", "/v1/recurrence-rules/"+second.Row.ID, ""); res.Code != 200 {
		t.Fatalf("delete=%d %s", res.Code, res.Body.String())
	}
	findingsAfter, err := scoped.ListAnalysisFindings(types.AnalysisFindingFilter{})
	if err != nil || len(findingsAfter) != 3 {
		t.Fatalf("evidence=%+v err=%v", findingsAfter, err)
	}
	feedback, err := scoped.ListAnalysisFeedback(types.AnalysisFeedbackFilter{})
	if err != nil || len(feedback) != 1 {
		t.Fatalf("feedback=%+v err=%v", feedback, err)
	}
	for _, config := range []Config{{ReadOnly: true}, {CanWrite: func(context.Context) bool { return false }}} {
		if res := callAPI(t, New(scoped, config), "POST", createPath, ""); res.Code != 403 {
			t.Fatalf("guard=%d %s", res.Code, res.Body.String())
		}
		if res := callAPI(t, New(scoped, config), "GET", previewPath, ""); res.Code != 200 {
			t.Fatalf("read-only preview=%d %s", res.Code, res.Body.String())
		}
	}
	if res := callAPI(t, handler, "GET", "/v1/analysis-findings/missing/pattern-to-new-rule-preview", ""); res.Code != 404 {
		t.Fatalf("missing=%d %s", res.Code, res.Body.String())
	}
}

func TestPatternToNewRuleRejectsBiweekly(t *testing.T) {
	scoped := openAPIStore(t)
	findings := seedAPIRecurringPattern(t, scoped, "biweekly")
	handler := New(scoped, Config{})
	confirmAPIFinding(t, handler, findings[0])
	res := callAPI(t, handler, "GET", "/v1/analysis-findings/"+findings[0].ID+"/pattern-to-new-rule-preview", "")
	if res.Code != 200 {
		t.Fatalf("preview=%d %s", res.Code, res.Body.String())
	}
	var preview struct {
		Preview types.PatternToNewRulePreview `json:"preview"`
	}
	if err := json.Unmarshal(res.Body.Bytes(), &preview); err != nil {
		t.Fatal(err)
	}
	if preview.Preview.Creatable || preview.Preview.Reason == "" {
		t.Fatalf("preview=%+v", preview.Preview)
	}
	if res := callAPI(t, handler, "POST", "/v1/analysis-findings/"+findings[0].ID+"/pattern-to-new-rule", ""); res.Code != 422 {
		t.Fatalf("create=%d %s", res.Code, res.Body.String())
	}
	model, err := scoped.LoadModel()
	if err != nil || len(model.RecurrenceRules) != 0 {
		t.Fatalf("rules=%d err=%v", len(model.RecurrenceRules), err)
	}
}
