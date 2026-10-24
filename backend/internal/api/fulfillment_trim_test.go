package api

import (
	"bytes"
	"encoding/json"
	"net/http"
	"net/http/httptest"
	"os"
	"path/filepath"
	"testing"

	"github.com/simhozebs/net-worth-estimator/backend/internal/types"
)

// The served deterministic payload must not duplicate movement evidence:
// per-event fulfillment travels once on movementEvents, so the fulfillment
// envelope keeps scalars only. Regression coverage for the 2.3 MB duplicate.
func TestDeterministicFulfillmentOmitsDetailArrays(t *testing.T) {
	fixturePath := filepath.Join(apiProjectRoot(t), "backend", "testdata", "golden", "deterministic.json")
	fixtureBytes, err := os.ReadFile(fixturePath)
	if err != nil {
		t.Fatalf("read projection fixture: %v", err)
	}
	var fixture struct {
		Document *types.FinancialModelDocument   `json:"document"`
		Settings types.ProjectionRuntimeSettings `json:"settings"`
	}
	if err := json.Unmarshal(fixtureBytes, &fixture); err != nil {
		t.Fatalf("decode projection fixture: %v", err)
	}
	body, err := json.Marshal(projectionRequestBody{Document: fixture.Document, Settings: fixture.Settings})
	if err != nil {
		t.Fatalf("encode projection request: %v", err)
	}
	database := openAPIStore(t)
	handler := New(database, Config{})
	response := httptest.NewRecorder()
	request := httptest.NewRequest(http.MethodPost, "/v1/projections/deterministic", bytes.NewReader(body))
	request.Header.Set("Content-Type", "application/json")
	handler.ServeHTTP(response, request)
	if response.Code != http.StatusOK {
		t.Fatalf("projection status = %d, body %s", response.Code, response.Body.String())
	}
	var payload struct {
		Result *types.ProjectionResult `json:"result"`
	}
	if err := json.Unmarshal(response.Body.Bytes(), &payload); err != nil {
		t.Fatalf("decode projection response: %v", err)
	}
	if payload.Result == nil || len(payload.Result.MovementEvents) == 0 {
		t.Fatal("movementEvents copy is missing; the kept evidence must stay")
	}
	if len(payload.Result.Evaluations.PostingFulfillment) == 0 {
		t.Fatal("postingFulfillment envelope is missing")
	}
	detail, ok := payload.Result.Evaluations.PostingFulfillment[0].Deterministic.(map[string]any)
	if !ok {
		t.Fatalf("fulfillment deterministic has unexpected shape %T", payload.Result.Evaluations.PostingFulfillment[0].Deterministic)
	}
	for _, key := range []string{"completionRate", "requestedAmount", "realizedAmount", "firstUnderfulfilledDate"} {
		if _, ok := detail[key]; !ok {
			t.Errorf("fulfillment scalar %q is missing", key)
		}
	}
	for _, key := range []string{"events", "dates", "postings"} {
		if items, ok := detail[key].([]any); !ok || len(items) != 0 {
			t.Errorf("fulfillment %q has %d entries, want empty", key, len(items))
		}
	}
}
