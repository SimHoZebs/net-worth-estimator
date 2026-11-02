package integration

import (
	"context"
	"encoding/json"
	"testing"

	"github.com/simhozebs/net-worth-estimator/backend/internal/types"
)

func TestRecurringLinkHTTPContract(t *testing.T) {
	scoped := openAPIStore(t)
	findings := seedAPIRecurringPattern(t, scoped, "monthly")
	handler := New(scoped, Config{})
	// Create an existing monthly rule that matches the pattern routing.
	ruleBody, _ := json.Marshal(map[string]any{
		"name": "Grocer", "sourceAccountId": "checking",
		"amount":    map[string]any{"resolver": "expression", "config": map[string]any{"expression": "30.00"}, "inputs": map[string]any{}},
		"frequency": "monthly", "startDate": "2026-01-15", "enabled": true,
	})
	res := callAPI(t, handler, "POST", "/v1/recurrence-rules", string(ruleBody))
	if res.Code != 200 {
		t.Fatalf("create rule=%d %s", res.Code, res.Body.String())
	}
	var created struct {
		Row types.RecurrenceRule `json:"row"`
	}
	if err := json.Unmarshal(res.Body.Bytes(), &created); err != nil {
		t.Fatal(err)
	}
	ruleID := created.Row.ID
	previewPath := "/v1/analysis-findings/" + findings[0].ID + "/recurring-link-preview?ruleId=" + ruleID
	linkPath := "/v1/analysis-findings/" + findings[0].ID + "/recurring-link"

	var preview struct {
		Preview types.RecurringLinkPreview `json:"preview"`
	}
	res = callAPI(t, handler, "GET", previewPath, "")
	if res.Code != 200 {
		t.Fatalf("preview=%d %s", res.Code, res.Body.String())
	}
	if err := json.Unmarshal(res.Body.Bytes(), &preview); err != nil {
		t.Fatal(err)
	}
	if preview.Preview.Linkable {
		t.Fatalf("unconfirmed preview linkable=%+v", preview.Preview)
	}
	linkBody, _ := json.Marshal(map[string]any{"ruleId": ruleID})
	// Linking before confirmation is rejected without touching the model.
	if res := callAPI(t, handler, "POST", linkPath, string(linkBody)); res.Code != 422 {
		t.Fatalf("unconfirmed link=%d %s", res.Code, res.Body.String())
	}
	confirmAPIFinding(t, handler, findings[0])
	res = callAPI(t, handler, "GET", previewPath, "")
	if err := json.Unmarshal(res.Body.Bytes(), &preview); err != nil {
		t.Fatal(err)
	}
	if !preview.Preview.Linkable || len(preview.Preview.Assignments) != 3 {
		t.Fatalf("preview=%+v", preview.Preview)
	}
	want := map[string]string{}
	for _, item := range preview.Preview.Assignments {
		want[item.PostingID] = item.Date
	}
	if len(want) != 3 {
		t.Fatalf("assignments=%+v", preview.Preview.Assignments)
	}
	linkBody, _ = json.Marshal(map[string]any{"ruleId": ruleID})
	res = callAPI(t, handler, "POST", linkPath, string(linkBody))
	if res.Code != 200 {
		t.Fatalf("link=%d %s", res.Code, res.Body.String())
	}
	var linked struct {
		Rows       []types.Posting              `json:"rows"`
		Persisted  bool                         `json:"persisted"`
		PatternKey string                       `json:"patternKey"`
		RuleID     string                       `json:"ruleId"`
		Revision   string                       `json:"revision"`
		Issues     []types.ModelValidationIssue `json:"issues"`
	}
	if err := json.Unmarshal(res.Body.Bytes(), &linked); err != nil {
		t.Fatal(err)
	}
	if !linked.Persisted || len(linked.Rows) != 3 || linked.RuleID != ruleID {
		t.Fatalf("linked=%+v", linked)
	}
	model, err := scoped.LoadModel()
	if err != nil {
		t.Fatal(err)
	}
	claimed := 0
	for _, posting := range model.Postings {
		if posting.Claim != nil && posting.Claim.RuleID == ruleID {
			claimed++
		}
	}
	if claimed != 3 {
		t.Fatalf("claimed=%d model=%+v", claimed, model.Postings)
	}
	// Idempotent retry keeps the same claims.
	res = callAPI(t, handler, "POST", linkPath, string(linkBody))
	if res.Code != 200 {
		t.Fatalf("relink=%d %s", res.Code, res.Body.String())
	}
	// Unknown rule is invalid.
	badBody, _ := json.Marshal(map[string]any{"ruleId": "missing-rule"})
	if res := callAPI(t, handler, "POST", linkPath, string(badBody)); res.Code != 422 {
		t.Fatalf("bad rule=%d %s", res.Code, res.Body.String())
	}
	// A disabled rule refuses new links.
	disable, _ := json.Marshal(map[string]any{
		"name": "Grocer", "sourceAccountId": "checking",
		"amount":    map[string]any{"resolver": "expression", "config": map[string]any{"expression": "30.00"}, "inputs": map[string]any{}},
		"frequency": "monthly", "startDate": "2026-01-15", "enabled": false,
	})
	if res := callAPI(t, handler, "PATCH", "/v1/recurrence-rules/"+ruleID, string(disable)); res.Code != 200 {
		t.Fatalf("disable=%d %s", res.Code, res.Body.String())
	}
	if res := callAPI(t, handler, "POST", linkPath, string(linkBody)); res.Code != 422 {
		t.Fatalf("disabled link=%d %s", res.Code, res.Body.String())
	}
	// Read-only and write-denied callers cannot link but can preview.
	for _, config := range []Config{{ReadOnly: true}, {CanWrite: func(context.Context) bool { return false }}} {
		if res := callAPI(t, New(scoped, config), "POST", linkPath, string(linkBody)); res.Code != 403 {
			t.Fatalf("guard=%d %s", res.Code, res.Body.String())
		}
		if res := callAPI(t, New(scoped, config), "GET", previewPath, ""); res.Code != 200 {
			t.Fatalf("read-only preview=%d %s", res.Code, res.Body.String())
		}
	}
}
