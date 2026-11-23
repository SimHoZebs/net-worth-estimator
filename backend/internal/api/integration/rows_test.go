package integration

import (
	"bytes"
	"encoding/json"
	"net/http"
	"net/http/httptest"
	"testing"
)

func doRowRequest(t *testing.T, handler http.Handler, method, path string, body string) *httptest.ResponseRecorder {
	t.Helper()
	var reader *bytes.Reader
	if body == "" {
		reader = bytes.NewReader(nil)
	} else {
		reader = bytes.NewReader([]byte(body))
	}
	request := httptest.NewRequest(method, path, reader)
	if body != "" {
		request.Header.Set("Content-Type", "application/json")
	}
	response := httptest.NewRecorder()
	handler.ServeHTTP(response, request)
	return response
}

func TestRowAccountEndToEnd(t *testing.T) {
	database := openAPIStore(t)
	handler := New(database, Config{})

	created := doRowRequest(t, handler, http.MethodPost, "/v1/accounts", `{"name":"Checking","kind":"cash","enabled":true}`)
	if created.Code != http.StatusOK {
		t.Fatalf("create status = %d, body %s", created.Code, created.Body.String())
	}
	var createdPayload struct {
		Result struct {
			ID string `json:"id"`
		} `json:"value"`
		Saved bool `json:"saved"`
	}
	if err := json.Unmarshal(created.Body.Bytes(), &createdPayload); err != nil {
		t.Fatalf("decode create: %v", err)
	}
	if !createdPayload.Saved || createdPayload.Result.ID == "" {
		t.Fatalf("create = %+v", createdPayload)
	}

	updated := doRowRequest(t, handler, http.MethodPatch, "/v1/accounts/"+createdPayload.Result.ID, `{"name":"Renamed","kind":"cash","enabled":false}`)
	if updated.Code != http.StatusOK {
		t.Fatalf("update status = %d, body %s", updated.Code, updated.Body.String())
	}
}

func TestRowWriteValidationRejectsDanglingReference(t *testing.T) {
	database := openAPIStore(t)
	handler := New(database, Config{})

	response := doRowRequest(t, handler, http.MethodPost, "/v1/transactions",
		`{"name":"Ghost","sourceAccountId":"ghost","amount":{"resolver":"expression","config":{"expression":"10"},"inputs":{}},"date":"2026-08-01","enabled":true}`)
	if response.Code != http.StatusOK {
		t.Fatalf("status = %d, body %s", response.Code, response.Body.String())
	}
	var payload struct {
		Issues []map[string]any `json:"issues"`
		Saved  bool             `json:"saved"`
	}
	if err := json.Unmarshal(response.Body.Bytes(), &payload); err != nil {
		t.Fatalf("decode: %v", err)
	}
	if payload.Saved || len(payload.Issues) == 0 {
		t.Fatalf("dangling reference response = %+v", payload)
	}
}

func TestWriteGuardCoversRowOperations(t *testing.T) {
	database := openAPIStore(t)
	handler := New(database, Config{ReadOnly: true})

	for _, guarded := range []struct {
		method string
		path   string
		body   string
	}{
		{http.MethodPost, "/v1/accounts", `{"name":"x"}`},
		{http.MethodPatch, "/v1/accounts/x", `{"name":"x"}`},
		{http.MethodPost, "/v1/transactions", `{"name":"x"}`},
		{http.MethodPost, "/v1/transactions/x/amend", `{"name":"x"}`},
		{http.MethodDelete, "/v1/transactions/x", ""},
		{http.MethodPost, "/v1/transactions/x/claim", `{"scheduleId":"x","occurrenceDate":"2026-01-01"}`},
		{http.MethodPost, "/v1/schedules", `{"name":"x"}`},
		{http.MethodPost, "/v1/schedules/x/amend", `{"name":"x"}`},
		{http.MethodDelete, "/v1/schedules/x", ""},
		{http.MethodPost, "/v1/schedules/x/move", `{"id":"x"}`},
		{http.MethodPost, "/v1/evaluations", `{"type":"netWorthThreshold","name":"x"}`},
		{http.MethodPatch, "/v1/evaluations/x", `{"type":"netWorthThreshold","name":"x"}`},
		{http.MethodDelete, "/v1/evaluations/x", ""},
		{http.MethodPost, "/v1/amount-presets", `{}`},
		{http.MethodPatch, "/v1/amount-presets/x", `{}`},
		{http.MethodDelete, "/v1/amount-presets/x", ""},
		{http.MethodPost, "/v1/amount-presets/reorder", `{"id":"x"}`},
		{http.MethodPost, "/v1/payment-terms", `{"accountId":"x"}`},
		{http.MethodDelete, "/v1/payment-terms/x", ""},
		{http.MethodPost, "/v1/sync/simplefin", ""},
	} {
		response := doRowRequest(t, handler, guarded.method, guarded.path, guarded.body)
		if response.Code != http.StatusForbidden {
			t.Fatalf("%s %s status = %d, want 403", guarded.method, guarded.path, response.Code)
		}
	}

	reads := []struct {
		method string
		path   string
	}{
		{http.MethodGet, "/v1/financial-model"},
		{http.MethodGet, "/v1/sync/simplefin/accounts"},
		{http.MethodGet, "/v1/amount-resolvers"},
	}
	for _, read := range reads {
		response := doRowRequest(t, handler, read.method, read.path, "")
		if response.Code == http.StatusForbidden {
			t.Fatalf("%s %s must stay readable in read-only mode", read.method, read.path)
		}
	}
}
