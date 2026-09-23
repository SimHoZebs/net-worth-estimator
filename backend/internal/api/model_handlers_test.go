package api

import (
	"bytes"
	"encoding/json"
	"net/http"
	"net/http/httptest"
	"os"
	"path/filepath"
	"testing"

	"github.com/simhozebs/net-worth-estimator/backend/internal/store"
	"github.com/simhozebs/net-worth-estimator/backend/internal/types"
)

func TestGetModelReturnsNullWhenStoreIsUninitialized(t *testing.T) {
	database := openAPIStore(t)
	handler := New(database, Config{})
	response := httptest.NewRecorder()
	handler.ServeHTTP(response, httptest.NewRequest(http.MethodGet, "/v1/financial-model", nil))

	if response.Code != http.StatusOK {
		t.Fatalf("GET status = %d, body %s", response.Code, response.Body.String())
	}
	var payload struct {
		Document *types.FinancialModelDocument `json:"document"`
		Issues   []types.ModelValidationIssue  `json:"issues"`
	}
	if err := json.Unmarshal(response.Body.Bytes(), &payload); err != nil {
		t.Fatalf("decode GET response: %v", err)
	}
	if payload.Document != nil || payload.Issues == nil {
		t.Fatalf("unexpected uninitialized response: %+v", payload)
	}
}

func TestResetRouteIsGone(t *testing.T) {
	database := openAPIStore(t)
	handler := New(database, Config{})
	response := httptest.NewRecorder()
	handler.ServeHTTP(response, httptest.NewRequest(http.MethodPost, "/v1/financial-model/reset", nil))

	if response.Code != http.StatusNotFound {
		t.Fatalf("reset status = %d, want 404, body %s", response.Code, response.Body.String())
	}
}

func TestStatusReflectsReadOnlyFlag(t *testing.T) {
	for _, readOnly := range []bool{false, true} {
		database := openAPIStore(t)
		handler := New(database, Config{ReadOnly: readOnly})
		response := httptest.NewRecorder()
		handler.ServeHTTP(response, httptest.NewRequest(http.MethodGet, "/v1/status", nil))

		if response.Code != http.StatusOK {
			t.Fatalf("readOnly=%v status = %d, body %s", readOnly, response.Code, response.Body.String())
		}
		var payload struct {
			ReadOnly    bool `json:"readOnly"`
			AuthEnabled bool `json:"authEnabled"`
		}
		if err := json.Unmarshal(response.Body.Bytes(), &payload); err != nil {
			t.Fatalf("decode status response: %v", err)
		}
		if payload.ReadOnly != readOnly || payload.AuthEnabled {
			t.Fatalf("readOnly=%v status = %+v", readOnly, payload)
		}
	}
}

func TestReadOnlyRejectsWritesButServesReads(t *testing.T) {
	database := openAPIStore(t)
	handler := New(database, Config{ReadOnly: true})

	get := httptest.NewRecorder()
	handler.ServeHTTP(get, httptest.NewRequest(http.MethodGet, "/v1/financial-model", nil))
	if get.Code != http.StatusOK {
		t.Fatalf("GET status = %d, want 200, body %s", get.Code, get.Body.String())
	}
	var after struct {
		Document *types.FinancialModelDocument `json:"document"`
		Issues   []types.ModelValidationIssue  `json:"issues"`
	}
	if err := json.Unmarshal(get.Body.Bytes(), &after); err != nil {
		t.Fatalf("decode GET response: %v", err)
	}
	if after.Document != nil {
		t.Fatalf("stored document changed: %+v", after.Document)
	}
}

func TestReadOnlyRejectsPutWithSeededDocument(t *testing.T) {
	database := openAPIStore(t)
	root := apiProjectRoot(t)
	if _, _, err := database.ImportCSV(
		filepath.Join(root, "public", "configs"),
		filepath.Join(root, "public", "data", "income"),
	); err != nil {
		t.Fatalf("seed store: %v", err)
	}
	handler := New(database, Config{ReadOnly: true})

	get := httptest.NewRecorder()
	handler.ServeHTTP(get, httptest.NewRequest(http.MethodGet, "/v1/financial-model", nil))
	if get.Code != http.StatusOK {
		t.Fatalf("GET status = %d, body %s", get.Code, get.Body.String())
	}
	var payload struct {
		Document json.RawMessage `json:"document"`
	}
	if err := json.Unmarshal(get.Body.Bytes(), &payload); err != nil {
		t.Fatalf("decode GET response: %v", err)
	}

	put := httptest.NewRecorder()
	request := httptest.NewRequest(http.MethodPut, "/v1/financial-model", bytes.NewReader(payload.Document))
	request.Header.Set("Content-Type", "application/json")
	handler.ServeHTTP(put, request)
	if put.Code != http.StatusForbidden {
		t.Fatalf("PUT status = %d, want 403, body %s", put.Code, put.Body.String())
	}

	verify := httptest.NewRecorder()
	handler.ServeHTTP(verify, httptest.NewRequest(http.MethodGet, "/v1/financial-model", nil))
	if verify.Code != http.StatusOK {
		t.Fatalf("verify GET status = %d, body %s", verify.Code, verify.Body.String())
	}
	var after struct {
		Document json.RawMessage `json:"document"`
	}
	if err := json.Unmarshal(verify.Body.Bytes(), &after); err != nil {
		t.Fatalf("decode verify response: %v", err)
	}
	if string(after.Document) != string(payload.Document) {
		t.Fatalf("rejected PUT changed stored document")
	}
}

func openAPIStore(t *testing.T) store.Store {
	t.Helper()
	database, err := store.Open(filepath.Join(t.TempDir(), "api.db"))
	if err != nil {
		t.Fatalf("open API store: %v", err)
	}
	t.Cleanup(func() { _ = database.Close() })
	return database
}

func apiProjectRoot(t *testing.T) string {
	t.Helper()
	workingDirectory, err := os.Getwd()
	if err != nil {
		t.Fatalf("get working directory: %v", err)
	}
	return filepath.Clean(filepath.Join(workingDirectory, "..", "..", ".."))
}
