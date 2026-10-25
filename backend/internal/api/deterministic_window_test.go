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

// The window parameter slices one cached full result: history serves past
// rows only, projection serves future rows only, both serves everything.
// A history request warms the full artifact instead of computing twice.
func windowRequest(t *testing.T, handler http.Handler, body []byte) *httptest.ResponseRecorder {
	t.Helper()
	request := httptest.NewRequest(http.MethodPost, "/v1/projections/deterministic", bytes.NewReader(body))
	request.Header.Set("Content-Type", "application/json")
	response := httptest.NewRecorder()
	handler.ServeHTTP(response, request)
	return response
}

func windowBody(t *testing.T, window string) []byte {
	t.Helper()
	fixturePath := filepath.Join(apiProjectRoot(t), "backend", "testdata", "golden", "checkpoints.json")
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
	raw, err := json.Marshal(projectionRequestBody{Document: fixture.Document, Settings: fixture.Settings, Window: window})
	if err != nil {
		t.Fatalf("encode projection request: %v", err)
	}
	return raw
}

func decodeWindowResult(t *testing.T, response *httptest.ResponseRecorder) *types.ProjectionResult {
	t.Helper()
	if response.Code != http.StatusOK {
		t.Fatalf("projection status = %d, body %s", response.Code, response.Body.String())
	}
	var payload struct {
		Result *types.ProjectionResult `json:"result"`
	}
	if err := json.Unmarshal(response.Body.Bytes(), &payload); err != nil {
		t.Fatalf("decode projection response: %v", err)
	}
	if payload.Result == nil {
		t.Fatal("projection has no result")
	}
	return payload.Result
}

func TestDeterministicWindowSlicesOneArtifact(t *testing.T) {
	database := openAPIStore(t)
	handler := New(database, Config{})

	history := decodeWindowResult(t, windowRequest(t, handler, windowBody(t, "history")))
	if history.MovementEvents != nil && len(history.MovementEvents) != 0 {
		t.Fatalf("history movement events = %d, want none", len(history.MovementEvents))
	}
	for _, row := range history.Timeline.Rows {
		if !row.IsHistorical {
			t.Fatalf("history row %s is not historical", row.Date)
		}
	}
	if len(history.Evaluations.PostingFulfillment) != 0 || len(history.Evaluations.NetWorthThreshold) != 0 {
		t.Fatal("history carries evaluations")
	}

	projected := decodeWindowResult(t, windowRequest(t, handler, windowBody(t, "projection")))
	for _, row := range projected.Timeline.Rows {
		if row.IsHistorical {
			t.Fatalf("projected row %s is historical", row.Date)
		}
	}
	if len(projected.Evaluations.PostingFulfillment) == 0 {
		t.Fatal("projected rows lost evaluations")
	}

	full := decodeWindowResult(t, windowRequest(t, handler, windowBody(t, "")))
	if len(full.Timeline.Rows) != len(history.Timeline.Rows)+len(projected.Timeline.Rows) {
		t.Fatalf("full rows = %d, history %d plus projected %d", len(full.Timeline.Rows), len(history.Timeline.Rows), len(projected.Timeline.Rows))
	}
	if len(full.MovementEvents) != len(projected.MovementEvents) {
		t.Fatalf("full events = %d, projected %d", len(full.MovementEvents), len(projected.MovementEvents))
	}
}

func TestDeterministicHistoryWarmsFullRequest(t *testing.T) {
	database := openAPIStore(t)
	handler := New(database, Config{})
	first := windowRequest(t, handler, windowBody(t, "history"))
	if got := first.Header().Get("X-Cache"); got != "miss" {
		t.Fatalf("history X-Cache = %q, want miss", got)
	}
	second := windowRequest(t, handler, windowBody(t, ""))
	if got := second.Header().Get("X-Cache"); got != "hit" {
		t.Fatalf("full X-Cache after history = %q, want hit", got)
	}
}

func TestDeterministicWindowRejectsUnknown(t *testing.T) {
	database := openAPIStore(t)
	handler := New(database, Config{})
	response := windowRequest(t, handler, windowBody(t, "tomorrow"))
	if response.Code != http.StatusBadRequest {
		t.Fatalf("unknown window status = %d, body %s", response.Code, response.Body.String())
	}
}
