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
		Row struct {
			ID string `json:"id"`
		} `json:"row"`
		Persisted bool `json:"persisted"`
	}
	if err := json.Unmarshal(created.Body.Bytes(), &createdPayload); err != nil {
		t.Fatalf("decode create: %v", err)
	}
	if !createdPayload.Persisted || createdPayload.Row.ID == "" {
		t.Fatalf("create = %+v", createdPayload)
	}

	updated := doRowRequest(t, handler, http.MethodPatch, "/v1/accounts/"+createdPayload.Row.ID, `{"name":"Renamed","kind":"cash","enabled":false}`)
	if updated.Code != http.StatusOK {
		t.Fatalf("update status = %d, body %s", updated.Code, updated.Body.String())
	}
	moved := doRowRequest(t, handler, http.MethodPost, "/v1/accounts/reorder", `{"id":"`+createdPayload.Row.ID+`"}`)
	if moved.Code != http.StatusOK {
		t.Fatalf("move status = %d, body %s", moved.Code, moved.Body.String())
	}
	deleted := doRowRequest(t, handler, http.MethodDelete, "/v1/accounts/"+createdPayload.Row.ID, "")
	if deleted.Code != http.StatusOK {
		t.Fatalf("delete status = %d, body %s", deleted.Code, deleted.Body.String())
	}
	again := doRowRequest(t, handler, http.MethodDelete, "/v1/accounts/"+createdPayload.Row.ID, "")
	if again.Code != http.StatusNotFound {
		t.Fatalf("second delete status = %d, want 404", again.Code)
	}
}

func TestRowWriteValidationRejectsDanglingReference(t *testing.T) {
	database := openAPIStore(t)
	handler := New(database, Config{})

	response := doRowRequest(t, handler, http.MethodPost, "/v1/postings",
		`{"name":"Ghost","sourceAccountId":"ghost","amount":{"resolver":"expression","config":{"expression":"10"},"inputs":{}},"postedTime":1785542400,"transactionTime":1785542400,"enabled":true}`)
	if response.Code != http.StatusOK {
		t.Fatalf("status = %d, body %s", response.Code, response.Body.String())
	}
	var payload struct {
		Issues    []map[string]any `json:"issues"`
		Persisted bool             `json:"persisted"`
	}
	if err := json.Unmarshal(response.Body.Bytes(), &payload); err != nil {
		t.Fatalf("decode: %v", err)
	}
	if payload.Persisted || len(payload.Issues) == 0 {
		t.Fatalf("dangling reference response = %+v", payload)
	}
}

func TestLinkEndpointsEndToEnd(t *testing.T) {
	database := openAPIStore(t)
	handler := New(database, Config{})

	list := doRowRequest(t, handler, http.MethodGet, "/v1/sync/simplefin/accounts", "")
	if list.Code != http.StatusOK {
		t.Fatalf("list status = %d", list.Code)
	}
	saved := doRowRequest(t, handler, http.MethodPut, "/v1/sync/simplefin/accounts/bridge-1", `{"modelAccountId":"ghost"}`)
	if saved.Code != http.StatusUnprocessableEntity {
		t.Fatalf("link missing account status = %d, want 422, body %s", saved.Code, saved.Body.String())
	}
	created := doRowRequest(t, handler, http.MethodPost, "/v1/accounts", `{"id":"checking","name":"Checking","kind":"cash","enabled":true}`)
	if created.Code != http.StatusOK {
		t.Fatalf("create account status = %d", created.Code)
	}
	linked := doRowRequest(t, handler, http.MethodPut, "/v1/sync/simplefin/accounts/bridge-1", `{"modelAccountId":"checking"}`)
	if linked.Code != http.StatusOK {
		t.Fatalf("link status = %d, body %s", linked.Code, linked.Body.String())
	}
	after := doRowRequest(t, handler, http.MethodGet, "/v1/sync/simplefin/accounts", "")
	var listed struct {
		Links []struct {
			BridgeAccountID string `json:"bridgeAccountId"`
			ModelAccountID  string `json:"modelAccountId"`
		} `json:"links"`
	}
	if err := json.Unmarshal(after.Body.Bytes(), &listed); err != nil {
		t.Fatalf("decode list: %v", err)
	}
	if len(listed.Links) != 1 || listed.Links[0].ModelAccountID != "checking" {
		t.Fatalf("links = %+v", listed)
	}
	unlinked := doRowRequest(t, handler, http.MethodDelete, "/v1/sync/simplefin/accounts/bridge-1", "")
	if unlinked.Code != http.StatusOK {
		t.Fatalf("unlink status = %d", unlinked.Code)
	}
	missing := doRowRequest(t, handler, http.MethodDelete, "/v1/sync/simplefin/accounts/bridge-1", "")
	if missing.Code != http.StatusNotFound {
		t.Fatalf("second unlink status = %d, want 404", missing.Code)
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
		{http.MethodDelete, "/v1/accounts/x", ""},
		{http.MethodPost, "/v1/accounts/reorder", `{"id":"x"}`},
		{http.MethodPost, "/v1/postings", `{"name":"x"}`},
		{http.MethodPatch, "/v1/postings/x", `{"name":"x"}`},
		{http.MethodDelete, "/v1/postings/x", ""},
		{http.MethodPost, "/v1/postings/reorder", `{"id":"x"}`},
		{http.MethodPost, "/v1/transactions/x/convert", `{"kind":"posting"}`},
		{http.MethodPost, "/v1/recurrence-rules", `{"name":"x"}`},
		{http.MethodPatch, "/v1/recurrence-rules/x", `{"name":"x"}`},
		{http.MethodDelete, "/v1/recurrence-rules/x", ""},
		{http.MethodPost, "/v1/recurrence-rules/reorder", `{"id":"x"}`},
		{http.MethodPost, "/v1/checkpoints", `{"accountId":"x","balance":1,"observedAt":1767311999}`},
		{http.MethodDelete, "/v1/checkpoints?accountId=x&observedAt=1767311999", ""},
		{http.MethodPost, "/v1/evaluations", `{"type":"netWorthThreshold","name":"x"}`},
		{http.MethodPatch, "/v1/evaluations/x", `{"type":"netWorthThreshold","name":"x"}`},
		{http.MethodDelete, "/v1/evaluations/x", ""},
		{http.MethodPost, "/v1/evaluations/reorder", `{"type":"netWorthThreshold","instanceId":"x"}`},
		{http.MethodPost, "/v1/amount-presets", `{}`},
		{http.MethodPatch, "/v1/amount-presets/x", `{}`},
		{http.MethodDelete, "/v1/amount-presets/x", ""},
		{http.MethodPost, "/v1/amount-presets/reorder", `{"id":"x"}`},
		{http.MethodPost, "/v1/payment-terms", `{"accountId":"x"}`},
		{http.MethodDelete, "/v1/payment-terms/x", ""},
		{http.MethodPost, "/v1/sync/simplefin", ""},
		{http.MethodPut, "/v1/sync/simplefin/accounts/x", `{"modelAccountId":"y"}`},
		{http.MethodDelete, "/v1/sync/simplefin/accounts/x", ""},
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
