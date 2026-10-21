package api

import (
	"encoding/json"
	"net/http"
	"testing"

	"github.com/simhozebs/net-worth-estimator/backend/internal/types"
)

func TestPurchaseEvaluationSettingsHaveSeparateArtifactIdentity(t *testing.T) {
	settings := types.ProjectionRuntimeSettings{FallbackProjectionStartDate: "2026-02-01", HorizonYears: 1}
	base := artifactKey("deterministic", projectionSettingsDescriptor(settings))
	settings.Evaluations.PlannedPurchases = []types.EvaluationInstance[types.JsonValue]{{InstanceID: "purchases", Enabled: true, Config: map[string]any{}}}
	evaluated := artifactKey("deterministic", projectionSettingsDescriptor(settings))
	if base == evaluated {
		t.Fatal("purchase analysis reused baseline artifact")
	}
	settings.Evaluations.PlannedPurchases[0].Enabled = false
	if artifactKey("deterministic", projectionSettingsDescriptor(settings)) != base {
		t.Fatal("disabled analysis changed computation identity")
	}
}

func TestPurchasePostingHTTPRoundTrip(t *testing.T) {
	database := openAPIStore(t)
	handler := New(database, Config{})
	account := doRowRequest(t, handler, http.MethodPost, "/v1/accounts", `{"id":"cash","name":"Cash","kind":"cash","minBalance":0,"enabled":true}`)
	if account.Code != 200 {
		t.Fatal(account.Body.String())
	}
	body := `{"id":"wish","name":"Laptop","sourceAccountId":"cash","amount":{"resolver":"expression","config":{"expression":"500"},"inputs":{}},"postedTime":1769904000,"transactionTime":1769904000,"enabled":true,"purchase":{"priority":3}}`
	created := doRowRequest(t, handler, http.MethodPost, "/v1/postings", body)
	if created.Code != 200 {
		t.Fatalf("create = %d %s", created.Code, created.Body.String())
	}
	var payload struct {
		Row       types.Posting `json:"row"`
		Persisted bool          `json:"persisted"`
	}
	if err := json.Unmarshal(created.Body.Bytes(), &payload); err != nil {
		t.Fatal(err)
	}
	if !payload.Persisted || payload.Row.Purchase == nil || payload.Row.Purchase.Priority != 3 {
		t.Fatalf("create = %s", created.Body.String())
	}
	model := doRowRequest(t, handler, http.MethodGet, "/v1/financial-model", "")
	var read struct {
		Document types.FinancialModelDocument `json:"document"`
	}
	if err := json.Unmarshal(model.Body.Bytes(), &read); err != nil {
		t.Fatal(err)
	}
	if read.Document.Postings[0].Purchase.Priority != 3 {
		t.Fatal("policy absent from saved model")
	}
	posting := payload.Row
	posting.Purchase.Priority = 1
	updatedBody, _ := json.Marshal(posting)
	updated := doRowRequest(t, handler, http.MethodPatch, "/v1/postings/wish", string(updatedBody))
	if updated.Code != 200 {
		t.Fatal(updated.Body.String())
	}
	if err := json.Unmarshal(updated.Body.Bytes(), &payload); err != nil {
		t.Fatal(err)
	}
	if !payload.Persisted || payload.Row.Purchase.Priority != 1 {
		t.Fatalf("patch = %s", updated.Body.String())
	}
	posting.Amount.Config["expression"] = "-500"
	invalidBody, _ := json.Marshal(posting)
	rejected := doRowRequest(t, handler, http.MethodPatch, "/v1/postings/wish", string(invalidBody))
	if err := json.Unmarshal(rejected.Body.Bytes(), &payload); err != nil {
		t.Fatal(err)
	}
	if payload.Persisted {
		t.Fatal("negative purchase persisted")
	}
	loaded, err := database.LoadDocument()
	if err != nil || loaded.Postings[0].Amount.Config["expression"] != "500" {
		t.Fatalf("rejected write changed model: %+v %v", loaded, err)
	}
	readOnly := New(database, Config{ReadOnly: true})
	blocked := doRowRequest(t, readOnly, http.MethodPatch, "/v1/postings/wish", body)
	if blocked.Code != http.StatusForbidden {
		t.Fatalf("read-only = %d", blocked.Code)
	}
}
