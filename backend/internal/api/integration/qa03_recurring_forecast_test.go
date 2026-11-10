package integration

import (
	"bytes"
	"encoding/json"
	"math"
	"net/http"
	"net/http/httptest"
	"testing"

	"github.com/simhozebs/net-worth-estimator/backend/internal/types"
)

// QA-03 journey 2: a detected spending pattern becomes a forecast rule.
//
// The bank rows enter through the real sync reconcile, the detection lands
// through the real analysis persistence path, and every step after that —
// confirm, new-rule preview, approval, the deterministic forecast, and the
// rule edit — runs over production HTTP against the stored model. The only
// shortcut is invoking the analysis claim directly instead of waiting for
// the background runner tick; the claim and completion calls are the same
// production storage path the runner uses.

func qa03ProjectionSettings() types.ProjectionRuntimeSettings {
	return types.ProjectionRuntimeSettings{
		FallbackProjectionStartDate: "2026-04-01",
		HorizonYears:                1,
		Evaluations:                 types.EmptyEvaluationTables(),
	}
}

func qa03StoredProjection(t *testing.T, handler http.Handler) *types.ProjectionResult {
	t.Helper()
	raw, err := json.Marshal(projectionRequestBody{Settings: qa03ProjectionSettings(), Range: fullSpanRange()})
	if err != nil {
		t.Fatal(err)
	}
	request := httptest.NewRequest(http.MethodPost, "/v1/projections/deterministic", bytes.NewReader(raw))
	request.Header.Set("Content-Type", "application/json")
	response := httptest.NewRecorder()
	handler.ServeHTTP(response, request)
	if response.Code != http.StatusOK {
		t.Fatalf("projection status = %d, body %s", response.Code, response.Body.String())
	}
	var payload struct {
		Result *types.ProjectionResult      `json:"result"`
		Issues []types.ModelValidationIssue `json:"issues"`
		Error  string                       `json:"error"`
	}
	if err := json.Unmarshal(response.Body.Bytes(), &payload); err != nil {
		t.Fatal(err)
	}
	if payload.Result == nil {
		t.Fatalf("projection has no result: issues=%+v error=%q", payload.Issues, payload.Error)
	}
	if hasErrorIssues(payload.Issues) {
		t.Fatalf("projection issues = %+v", payload.Issues)
	}
	return payload.Result
}

// qa03RuleEvents returns the forecast events on or after the rule start
// carrying the rule's monthly amount.
func qa03RuleEvents(result *types.ProjectionResult) []types.TransactionEvent {
	var matched []types.TransactionEvent
	for _, event := range result.TransactionEvents {
		if event.Date < "2026-04-15" {
			continue
		}
		if math.Abs(math.Abs(event.RequestedAmount)-30) < 0.001 {
			matched = append(matched, event)
		}
	}
	return matched
}

func TestQA03RecurringDetectionCreatesRuleIntoForecastAndDisablesCleanly(t *testing.T) {
	scoped := openAPIStore(t)
	findings := seedAPIRecurringPattern(t, scoped, "monthly")
	handler := New(scoped, Config{})
	previewPath := "/v1/analysis-findings/" + findings[0].ID + "/pattern-to-new-schedule-preview"
	createPath := "/v1/analysis-findings/" + findings[0].ID + "/pattern-to-new-schedule"

	var preview struct {
		Preview types.PatternToNewSchedulePreview `json:"preview"`
	}
	if res := callAPI(t, handler, "GET", previewPath, ""); res.Code != 200 {
		t.Fatalf("preview = %d %s", res.Code, res.Body.String())
	} else if err := json.Unmarshal(res.Body.Bytes(), &preview); err != nil {
		t.Fatal(err)
	}
	if !preview.Preview.Creatable {
		t.Fatal("unanswered pattern should be creatable")
	}

	if res := callAPI(t, handler, "GET", previewPath, ""); res.Code != 200 {
		t.Fatalf("preview = %d %s", res.Code, res.Body.String())
	} else if err := json.Unmarshal(res.Body.Bytes(), &preview); err != nil {
		t.Fatal(err)
	}
	if !preview.Preview.Creatable || preview.Preview.Schedule == nil {
		t.Fatalf("preview = %+v, want a creatable rule", preview.Preview)
	}

	var created struct {
		Result     types.Schedule `json:"value"`
		Saved      bool           `json:"saved"`
		PatternKey string         `json:"patternKey"`
	}
	if res := callAPI(t, handler, "POST", createPath, ""); res.Code != 200 {
		t.Fatalf("create = %d %s", res.Code, res.Body.String())
	} else if err := json.Unmarshal(res.Body.Bytes(), &created); err != nil {
		t.Fatal(err)
	}
	if !created.Saved || created.PatternKey == "" {
		t.Fatalf("created = %+v", created)
	}

	// The generated rule appears in the stored-model forecast as monthly
	// occurrences starting the month after the last observed row.
	forecast := qa03StoredProjection(t, handler)
	occurrences := qa03RuleEvents(forecast)
	if len(occurrences) < 3 {
		t.Fatalf("forecast rule events = %+v, want at least 3 monthly occurrences", occurrences)
	}
	for i, event := range occurrences {
		want := map[int]string{0: "2026-04-15", 1: "2026-05-15", 2: "2026-06-15"}[i]
		if want != "" && string(event.Date) != want {
			t.Fatalf("occurrence %d date = %s, want %s", i, event.Date, want)
		}
	}
	before, _ := json.Marshal(forecast)
	if res := qa03StoredProjection(t, handler); res != nil {
		after, _ := json.Marshal(res)
		if string(before) != string(after) {
			t.Fatal("repeated forecast differs without any model change")
		}
	}

	// A duplicate approval is rejected and creates no second rule.
	if res := callAPI(t, handler, "POST", createPath, ""); res.Code != 409 {
		t.Fatalf("second create = %d %s, want 409", res.Code, res.Body.String())
	}
	if model, err := scoped.LoadModel(); err != nil || len(model.Schedules) != 1 {
		t.Fatalf("rules = %+v err = %v, want exactly one", model, err)
	}

	// Disabling the rule drops it from the forecast but leaves the
	// detection evidence — findings and confirmation — intact.
	if res := callAPI(t, handler, "POST", "/v1/schedules/"+created.Result.ID+"/amend", `{"enabled":false}`); res.Code != 200 {
		t.Fatalf("disable = %d %s", res.Code, res.Body.String())
	}
	clean := qa03StoredProjection(t, handler)
	if len(qa03RuleEvents(clean)) != 0 {
		t.Fatalf("disabled rule still forecasts: %+v", qa03RuleEvents(clean))
	}
	findingsAfter, err := scoped.ListAnalysisFindings(types.AnalysisFindingFilter{})
	if err != nil || len(findingsAfter) != 3 {
		t.Fatalf("findings = %+v err = %v, want the 3 detection rows intact", findingsAfter, err)
	}
	feedback, err := scoped.ListAnalysisFeedback(types.AnalysisFeedbackFilter{})
	if err != nil || len(feedback) != 1 {
		t.Fatalf("feedback = %+v err = %v, want the confirmation intact", feedback, err)
	}
}
