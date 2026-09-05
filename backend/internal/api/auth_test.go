package api

import (
	"bytes"
	"encoding/json"
	"net/http"
	"net/http/httptest"
	"path/filepath"
	"testing"
)

func putDocument(handler http.Handler, document json.RawMessage, authorization string) *httptest.ResponseRecorder {
	request := httptest.NewRequest(http.MethodPut, "/v1/financial-model", bytes.NewReader(document))
	request.Header.Set("Content-Type", "application/json")
	if authorization != "" {
		request.Header.Set("Authorization", authorization)
	}
	response := httptest.NewRecorder()
	handler.ServeHTTP(response, request)
	return response
}

func TestPutAuthMatrix(t *testing.T) {
	const token = "test-token-123"
	for _, test := range []struct {
		name       string
		config     Config
		authHeader string
		want       int
	}{
		{name: "writable without token configured", config: Config{}, authHeader: "", want: http.StatusOK},
		{name: "writable with token missing", config: Config{AuthToken: token}, authHeader: "", want: http.StatusUnauthorized},
		{name: "writable with wrong token", config: Config{AuthToken: token}, authHeader: "Bearer wrong", want: http.StatusUnauthorized},
		{name: "writable with malformed scheme", config: Config{AuthToken: token}, authHeader: "Token " + token, want: http.StatusUnauthorized},
		{name: "writable with correct token", config: Config{AuthToken: token}, authHeader: "Bearer " + token, want: http.StatusOK},
		{name: "read-only without token", config: Config{ReadOnly: true}, authHeader: "", want: http.StatusForbidden},
		{name: "read-only wins over valid token", config: Config{ReadOnly: true, AuthToken: token}, authHeader: "Bearer " + token, want: http.StatusForbidden},
	} {
		t.Run(test.name, func(t *testing.T) {
			database := openAPIStore(t)
			root := apiProjectRoot(t)
			if _, _, err := database.ImportCSV(
				filepath.Join(root, "public", "configs"),
				filepath.Join(root, "public", "data", "income"),
			); err != nil {
				t.Fatalf("seed store: %v", err)
			}
			handler := New(database, test.config)

			before := httptest.NewRecorder()
			handler.ServeHTTP(before, httptest.NewRequest(http.MethodGet, "/v1/financial-model", nil))
			var beforePayload struct {
				Document json.RawMessage `json:"document"`
			}
			if err := json.Unmarshal(before.Body.Bytes(), &beforePayload); err != nil {
				t.Fatalf("decode GET response: %v", err)
			}

			response := putDocument(handler, beforePayload.Document, test.authHeader)
			if response.Code != test.want {
				t.Fatalf("PUT status = %d, want %d, body %s", response.Code, test.want, response.Body.String())
			}

			after := httptest.NewRecorder()
			handler.ServeHTTP(after, httptest.NewRequest(http.MethodGet, "/v1/financial-model", nil))
			var afterPayload struct {
				Document json.RawMessage `json:"document"`
			}
			if err := json.Unmarshal(after.Body.Bytes(), &afterPayload); err != nil {
				t.Fatalf("decode verify response: %v", err)
			}
			if test.want != http.StatusOK && string(afterPayload.Document) != string(beforePayload.Document) {
				t.Fatalf("rejected PUT changed stored document")
			}
		})
	}
}

func TestStatusReportsAuthEnabled(t *testing.T) {
	database := openAPIStore(t)
	handler := New(database, Config{AuthToken: "test-token-123"})
	response := httptest.NewRecorder()
	handler.ServeHTTP(response, httptest.NewRequest(http.MethodGet, "/v1/status", nil))

	if response.Code != http.StatusOK {
		t.Fatalf("status = %d", response.Code)
	}
	var payload struct {
		ReadOnly    bool `json:"readOnly"`
		AuthEnabled bool `json:"authEnabled"`
	}
	if err := json.Unmarshal(response.Body.Bytes(), &payload); err != nil {
		t.Fatalf("decode status response: %v", err)
	}
	if payload.ReadOnly || !payload.AuthEnabled {
		t.Fatalf("status = %+v", payload)
	}
}
