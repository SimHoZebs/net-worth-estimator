package integration

import (
	"context"
	"encoding/json"
	"testing"
	"time"

	"github.com/simhozebs/net-worth-estimator/backend/internal/simplefin"
	"github.com/simhozebs/net-worth-estimator/backend/internal/store"
	"github.com/simhozebs/net-worth-estimator/backend/internal/types"
)

func seedAPIPaymentPattern(t *testing.T, scoped store.Store, kind, cadence, description, amount, provider, role string) []types.AnalysisFinding {
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
		transactions = append(transactions, simplefin.Transaction{ID: "payment-" + string(rune('a'+i)), Description: description, Amount: amount, Posted: stamp})
	}
	set := &simplefin.AccountSet{Accounts: []simplefin.Account{{ID: "bank", ConnID: "test-conn", Currency: "USD", Balance: "100", Transactions: transactions}}}
	translation, err := simplefin.Translate(set, map[string]string{simplefin.AccountKey("test-conn", "bank"): "checking"}, time.Unix(posted[2], 0))
	if err != nil {
		t.Fatal(err)
	}
	if _, err := scoped.ApplySync(nil, simplefin.Reconcile(translation.Pending, translation.Settled, nil, map[string]bool{"checking": true})); err != nil {
		t.Fatal(err)
	}
	run, input, claimed, err := scoped.ClaimAnalysis("payments", "test-v1")
	if err != nil || !claimed || len(input.Transactions) != 3 {
		t.Fatalf("claim=%v %v %+v", claimed, err, input)
	}
	ids := []string{input.Transactions[0].TransactionID, input.Transactions[1].TransactionID, input.Transactions[2].TransactionID}
	detections := make([]types.AnalysisDetection, 0, len(ids))
	for _, id := range ids {
		detections = append(detections, types.AnalysisDetection{
			TransactionID: id, Kind: kind, Provider: provider, Product: cadence, Role: role, Strength: "moderate",
			Evidence:      []types.AnalysisEvidence{{Code: kind + ".cadence", Reason: "test pattern", TransactionIDs: ids}},
			Pattern:       &types.AnalysisPaymentPattern{PatternID: "pattern-" + kind, Currency: "USD", TypicalAmount: "3000.00"},
			JudgmentInput: &types.AnalysisJudgmentInput{ID: "request-" + kind, Kind: kind, PatternID: "pattern-" + kind},
		})
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

func TestPatternToNewSchedulePaymentHTTPContract(t *testing.T) {
	scoped := openAPIStore(t)
	findings := seedAPIPaymentPattern(t, scoped, "income", "monthly", "ACME PAYROLL", "3000.00", "ACME PAYROLL", "inflow")
	handler := New(scoped, Config{Actor: func(context.Context) string { return "verified-subject" }})
	previewPath := "/v1/analysis-findings/" + findings[0].ID + "/pattern-to-new-schedule-preview"
	createPath := "/v1/analysis-findings/" + findings[0].ID + "/pattern-to-new-schedule"

	var preview struct {
		Preview types.PatternToNewSchedulePreview `json:"preview"`
	}
	res := callAPI(t, handler, "GET", previewPath, "")
	if res.Code != 200 || res.Header().Get("Cache-Control") != "private, no-store" {
		t.Fatalf("preview=%d %s", res.Code, res.Body.String())
	}
	if err := json.Unmarshal(res.Body.Bytes(), &preview); err != nil {
		t.Fatal(err)
	}
	if !preview.Preview.Creatable || preview.Preview.Schedule == nil || preview.Preview.Schedule.Frequency != types.FrequencyMonthly || preview.Preview.Schedule.StartDate != "2026-04-15" {
		t.Fatalf("preview=%+v", preview.Preview)
	}
	if preview.Preview.Direction != "inflow" || preview.Preview.TypicalAmount != "3000.00" {
		t.Fatalf("preview=%+v", preview.Preview)
	}
	feedbackBefore, err := scoped.ListAnalysisFeedback(types.AnalysisFeedbackFilter{})
	if err != nil || len(feedbackBefore) != 0 {
		t.Fatalf("preview wrote feedback: %+v %v", feedbackBefore, err)
	}
	var created struct {
		Result     types.Schedule               `json:"value"`
		Issues     []types.ModelValidationIssue `json:"issues"`
		Saved      bool                         `json:"saved"`
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
	if !created.Saved || created.Result.Frequency != types.FrequencyMonthly || created.Result.StartDate != "2026-04-15" || !created.Result.Enabled || created.PatternKey == "" {
		t.Fatalf("created=%+v", created)
	}
	model, err := scoped.LoadModel()
	if err != nil || len(model.Schedules) != 1 {
		t.Fatalf("model=%+v err=%v", model, err)
	}
	res = callAPI(t, handler, "GET", previewPath, "")
	preview = struct {
		Preview types.PatternToNewSchedulePreview `json:"preview"`
	}{}
	if err := json.Unmarshal(res.Body.Bytes(), &preview); err != nil {
		t.Fatal(err)
	}
	if preview.Preview.Creatable || preview.Preview.ExistingScheduleID != created.Result.ID {
		t.Fatalf("second preview=%+v", preview.Preview)
	}
	if res := callAPI(t, handler, "POST", createPath, ""); res.Code != 409 {
		t.Fatalf("second create=%d %s", res.Code, res.Body.String())
	}
	feedback, err := scoped.ListAnalysisFeedback(types.AnalysisFeedbackFilter{})
	if err != nil || len(feedback) != 1 || feedback[0].Actor != "verified-subject" {
		t.Fatalf("feedback=%+v err=%v", feedback, err)
	}
}

func TestPatternToNewSchedulePaymentKeepsUnsupportedCadenceVisible(t *testing.T) {
	cases := []struct {
		name, kind, cadence, description, amount, provider, role, direction string
	}{
		{"biweekly income", "income", "biweekly", "ACME PAYROLL", "3000.00", "ACME PAYROLL", "inflow", "inflow"},
		{"rent without cadence", "rent", "", "RENT PAYMENT", "-1200.00", "Rent", "outflow", "outflow"},
	}
	for _, testCase := range cases {
		t.Run(testCase.name, func(t *testing.T) {
			scoped := openAPIStore(t)
			findings := seedAPIPaymentPattern(t, scoped, testCase.kind, testCase.cadence, testCase.description, testCase.amount, testCase.provider, testCase.role)
			handler := New(scoped, Config{})
			confirmAPIFinding(t, handler, findings[0])
			res := callAPI(t, handler, "GET", "/v1/analysis-findings/"+findings[0].ID+"/pattern-to-new-schedule-preview", "")
			if res.Code != 200 {
				t.Fatalf("preview=%d %s", res.Code, res.Body.String())
			}
			var preview struct {
				Preview types.PatternToNewSchedulePreview `json:"preview"`
			}
			if err := json.Unmarshal(res.Body.Bytes(), &preview); err != nil {
				t.Fatal(err)
			}
			if preview.Preview.Creatable || preview.Preview.Schedule != nil || len(preview.Preview.Upcoming) != 0 || preview.Preview.Reason == "" {
				t.Fatalf("preview=%+v", preview.Preview)
			}
			if preview.Preview.Direction != testCase.direction || len(preview.Preview.Occurrences) != 3 {
				t.Fatalf("preview=%+v", preview.Preview)
			}
			if res := callAPI(t, handler, "POST", "/v1/analysis-findings/"+findings[0].ID+"/pattern-to-new-schedule", ""); res.Code != 422 {
				t.Fatalf("create=%d %s", res.Code, res.Body.String())
			}
			model, err := scoped.LoadModel()
			if err != nil || len(model.Schedules) != 0 {
				t.Fatalf("rules=%d err=%v", len(model.Schedules), err)
			}
		})
	}
}

func TestPatternToExistingSchedulePaymentHTTPContract(t *testing.T) {
	scoped := openAPIStore(t)
	findings := seedAPIPaymentPattern(t, scoped, "rent", "monthly", "RENT PAYMENT", "-1200.00", "Rent", "outflow")
	handler := New(scoped, Config{Actor: func(context.Context) string { return "verified-subject" }})
	ruleBody, _ := json.Marshal(map[string]any{
		"name": "Rent", "sourceAccountId": "checking",
		"amount":    map[string]any{"resolver": "expression", "config": map[string]any{"expression": "1200.00"}, "inputs": map[string]any{}},
		"frequency": "monthly", "startDate": "2026-01-15", "enabled": true,
	})
	res := callAPI(t, handler, "POST", "/v1/schedules", string(ruleBody))
	if res.Code != 200 {
		t.Fatalf("create rule=%d %s", res.Code, res.Body.String())
	}
	var created struct {
		Result types.Schedule `json:"value"`
	}
	if err := json.Unmarshal(res.Body.Bytes(), &created); err != nil {
		t.Fatal(err)
	}
	ruleID := created.Result.ID
	previewPath := "/v1/analysis-findings/" + findings[0].ID + "/pattern-to-existing-schedule-preview?scheduleId=" + ruleID
	addPath := "/v1/analysis-findings/" + findings[0].ID + "/pattern-to-existing-schedule"

	var preview struct {
		Preview types.PatternToExistingSchedulePreview `json:"preview"`
	}
	res = callAPI(t, handler, "GET", previewPath, "")
	if res.Code != 200 {
		t.Fatalf("preview=%d %s", res.Code, res.Body.String())
	}
	if err := json.Unmarshal(res.Body.Bytes(), &preview); err != nil {
		t.Fatal(err)
	}
	if !preview.Preview.Claimable || len(preview.Preview.Assignments) != 3 {
		t.Fatalf("preview=%+v", preview.Preview)
	}
	addBody, _ := json.Marshal(map[string]any{"scheduleId": ruleID})
	res = callAPI(t, handler, "POST", addPath, string(addBody))
	if res.Code != 200 {
		t.Fatalf("add=%d %s", res.Code, res.Body.String())
	}
	var added struct {
		Matches    []types.Transaction          `json:"matches"`
		Saved      bool                         `json:"saved"`
		PatternKey string                       `json:"patternKey"`
		ScheduleID string                       `json:"scheduleId"`
		Revision   string                       `json:"revision"`
		Issues     []types.ModelValidationIssue `json:"issues"`
	}
	if err := json.Unmarshal(res.Body.Bytes(), &added); err != nil {
		t.Fatal(err)
	}
	if !added.Saved || len(added.Matches) != 3 || added.ScheduleID != ruleID {
		t.Fatalf("added=%+v", added)
	}
	model, err := scoped.LoadModel()
	if err != nil {
		t.Fatal(err)
	}
	claimed := 0
	for _, transaction := range model.Transactions {
		if transaction.Claim != nil && transaction.Claim.ScheduleID == ruleID {
			claimed++
		}
	}
	if claimed != 3 {
		t.Fatalf("claimed=%d model=%+v", claimed, model.Transactions)
	}
	feedback, err := scoped.ListAnalysisFeedback(types.AnalysisFeedbackFilter{})
	if err != nil || len(feedback) != 1 || feedback[0].Review.Decision != "confirmed" || feedback[0].Actor != "verified-subject" {
		t.Fatalf("acceptance=%+v err=%v", feedback, err)
	}
}
