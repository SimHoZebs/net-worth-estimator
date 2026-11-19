package integration

import (
	"context"
	"encoding/json"
	"testing"

	"github.com/simhozebs/net-worth-estimator/backend/internal/types"
)

func TestPatternToNewSchedulePaymentHTTPContract(t *testing.T) {
	scoped := openAPIStore(t)
	findings := seedAPIPattern(t, scoped, "income", "monthly", "ACME PAYROLL", "3000.00", "ACME PAYROLL", "inflow")
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
	if !preview.Preview.Creatable || preview.Preview.Schedule == nil {
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
	if !created.Saved || !created.Result.Enabled || created.PatternKey == "" {
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
		name, kind, cadence, description, amount, provider, role string
	}{
		{"rent without cadence", "rent", "", "RENT PAYMENT", "-1200.00", "Rent", "outflow"},
	}
	for _, testCase := range cases {
		t.Run(testCase.name, func(t *testing.T) {
			scoped := openAPIStore(t)
			findings := seedAPIPattern(t, scoped, testCase.kind, testCase.cadence, testCase.description, testCase.amount, testCase.provider, testCase.role)
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
	findings := seedAPIPattern(t, scoped, "rent", "monthly", "RENT PAYMENT", "-1200.00", "Rent", "outflow")
	handler := New(scoped, Config{Actor: func(context.Context) string { return "verified-subject" }})
	ruleBody, _ := json.Marshal(map[string]any{
		"name": "Rent", "sourceAccountId": "checking",
		"amount":     map[string]any{"resolver": "expression", "config": map[string]any{"expression": "1200.00"}, "inputs": map[string]any{}},
		"recurrence": map[string]any{"unit": "month", "interval": 1, "monthlyMode": "byDate"}, "startDate": "2026-01-15", "enabled": true,
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
