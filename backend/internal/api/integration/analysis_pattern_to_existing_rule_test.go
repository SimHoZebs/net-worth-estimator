package integration

import (
	"context"
	"encoding/json"
	"testing"

	"github.com/simhozebs/net-worth-estimator/backend/internal/types"
)

func TestPatternToExistingScheduleHTTPContract(t *testing.T) {
	scoped := openAPIStore(t)
	findings := seedAPIRecurringPattern(t, scoped, "monthly")
	handler := New(scoped, Config{})
	// Create an existing monthly rule that matches the pattern routing.
	ruleBody, _ := json.Marshal(map[string]any{
		"name": "Grocer", "sourceAccountId": "checking",
		"amount":    map[string]any{"resolver": "expression", "config": map[string]any{"expression": "30.00"}, "inputs": map[string]any{}},
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
	if preview.Preview.Claimable {
		t.Fatalf("unconfirmed preview claimable=%+v", preview.Preview)
	}
	addBody, _ := json.Marshal(map[string]any{"scheduleId": ruleID})
	// Adding before confirmation is rejected without touching the model.
	if res := callAPI(t, handler, "POST", addPath, string(addBody)); res.Code != 422 {
		t.Fatalf("unconfirmed add=%d %s", res.Code, res.Body.String())
	}
	confirmAPIFinding(t, handler, findings[0])
	res = callAPI(t, handler, "GET", previewPath, "")
	if err := json.Unmarshal(res.Body.Bytes(), &preview); err != nil {
		t.Fatal(err)
	}
	if !preview.Preview.Claimable || len(preview.Preview.Assignments) != 3 {
		t.Fatalf("preview=%+v", preview.Preview)
	}
	want := map[string]string{}
	for _, item := range preview.Preview.Assignments {
		want[item.TransactionID] = item.Date
	}
	if len(want) != 3 {
		t.Fatalf("assignments=%+v", preview.Preview.Assignments)
	}
	addBody, _ = json.Marshal(map[string]any{"scheduleId": ruleID})
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
	// Idempotent retry keeps the same claims.
	res = callAPI(t, handler, "POST", addPath, string(addBody))
	if res.Code != 200 {
		t.Fatalf("readd=%d %s", res.Code, res.Body.String())
	}
	// Unknown rule is invalid.
	badBody, _ := json.Marshal(map[string]any{"scheduleId": "missing-rule"})
	if res := callAPI(t, handler, "POST", addPath, string(badBody)); res.Code != 422 {
		t.Fatalf("bad rule=%d %s", res.Code, res.Body.String())
	}
	// A disabled rule refuses new additions.
	if res := callAPI(t, handler, "POST", "/v1/schedules/"+ruleID+"/amend", `{"enabled":false}`); res.Code != 200 {
		t.Fatalf("disable=%d %s", res.Code, res.Body.String())
	}
	if res := callAPI(t, handler, "POST", addPath, string(addBody)); res.Code != 422 {
		t.Fatalf("disabled add=%d %s", res.Code, res.Body.String())
	}
	// Read-only and write-denied callers cannot add but can preview.
	for _, config := range []Config{{ReadOnly: true}, {CanWrite: func(context.Context) bool { return false }}} {
		if res := callAPI(t, New(scoped, config), "POST", addPath, string(addBody)); res.Code != 403 {
			t.Fatalf("guard=%d %s", res.Code, res.Body.String())
		}
		if res := callAPI(t, New(scoped, config), "GET", previewPath, ""); res.Code != 200 {
			t.Fatalf("read-only preview=%d %s", res.Code, res.Body.String())
		}
	}
}
