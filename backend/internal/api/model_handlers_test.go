package api

import (
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
	handler := New(database, "unused", "unused")
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

func TestResetReturnsTheAtomicallyImportedAggregate(t *testing.T) {
	database := openAPIStore(t)
	root := apiProjectRoot(t)
	handler := New(
		database,
		filepath.Join(root, "public", "configs"),
		filepath.Join(root, "public", "data", "income"),
	)
	response := httptest.NewRecorder()
	handler.ServeHTTP(response, httptest.NewRequest(http.MethodPost, "/v1/financial-model/reset", nil))

	if response.Code != http.StatusOK {
		t.Fatalf("reset status = %d, body %s", response.Code, response.Body.String())
	}
	var payload struct {
		Reset  bool `json:"reset"`
		Result struct {
			Document *types.FinancialModelDocument `json:"document"`
			Issues   []types.ModelValidationIssue  `json:"issues"`
		} `json:"result"`
	}
	if err := json.Unmarshal(response.Body.Bytes(), &payload); err != nil {
		t.Fatalf("decode reset response: %v", err)
	}
	if !payload.Reset || payload.Result.Document == nil {
		t.Fatalf("unexpected reset response: %+v", payload)
	}
	if payload.Result.Document.SourcePath != "configs" {
		t.Fatalf("reset source path = %q", payload.Result.Document.SourcePath)
	}
	if len(payload.Result.Issues) != 0 {
		t.Fatalf("reset validation issues = %+v", payload.Result.Issues)
	}
}

func openAPIStore(t *testing.T) *store.Store {
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
