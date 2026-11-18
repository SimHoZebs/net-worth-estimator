package integration

import (
	"context"
	"encoding/json"
	"testing"

	"github.com/simhozebs/net-worth-estimator/backend/internal/types"
)

func TestPatternToNewScheduleHTTPContract(t *testing.T) {
	scoped := openAPIStore(t)
	findings := seedAPIPattern(t, scoped, "recurring", "monthly", "GROCER 123", "-30", "grocer", "outflow")
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
	if !preview.Preview.Creatable {
		t.Fatal("unanswered pattern should be creatable")
	}
	feedbackBefore, err := scoped.ListAnalysisFeedback(types.AnalysisFeedbackFilter{})
	if err != nil || len(feedbackBefore) != 0 {
		t.Fatalf("preview wrote feedback: %+v %v", feedbackBefore, err)
	}
	res = callAPI(t, handler, "GET", previewPath, "")
	if res.Code != 200 {
		t.Fatalf("preview=%d %s", res.Code, res.Body.String())
	}
	preview = struct {
		Preview types.PatternToNewSchedulePreview `json:"preview"`
	}{}
	if err := json.Unmarshal(res.Body.Bytes(), &preview); err != nil {
		t.Fatal(err)
	}
	if !preview.Preview.Creatable || preview.Preview.Schedule == nil {
		t.Fatalf("preview=%+v", preview.Preview)
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
	if res := callAPI(t, handler, "POST", "/v1/schedules/"+created.Result.ID+"/amend", `{"enabled":false}`); res.Code != 200 {
		t.Fatalf("disable=%d %s", res.Code, res.Body.String())
	}
	res = callAPI(t, handler, "POST", createPath, "")
	if res.Code != 200 {
		t.Fatalf("recreate=%d %s", res.Code, res.Body.String())
	}
	var second struct {
		Result types.Schedule `json:"value"`
		Saved  bool           `json:"saved"`
	}
	if err := json.Unmarshal(res.Body.Bytes(), &second); err != nil {
		t.Fatal(err)
	}
	if !second.Saved || second.Result.ID == created.Result.ID {
		t.Fatalf("recreate=%+v", second)
	}
	if res := callAPI(t, handler, "DELETE", "/v1/schedules/"+second.Result.ID, ""); res.Code != 200 {
		t.Fatalf("delete=%d %s", res.Code, res.Body.String())
	}
	findingsAfter, err := scoped.ListAnalysisFindings(types.AnalysisFindingFilter{})
	if err != nil || len(findingsAfter) != 3 {
		t.Fatalf("evidence=%+v err=%v", findingsAfter, err)
	}
	feedback, err := scoped.ListAnalysisFeedback(types.AnalysisFeedbackFilter{})
	if err != nil || len(feedback) != 1 || feedback[0].Actor != "verified-subject" {
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
	if res := callAPI(t, handler, "GET", "/v1/analysis-findings/missing/pattern-to-new-schedule-preview", ""); res.Code != 404 {
		t.Fatalf("missing=%d %s", res.Code, res.Body.String())
	}
}
