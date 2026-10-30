package integration

import (
	"bytes"
	"encoding/json"
	"net/http"
	"net/http/httptest"
	"os"
	"path/filepath"
	"testing"

	"github.com/simhozebs/net-worth-estimator/backend/internal/authorization"
	"github.com/simhozebs/net-worth-estimator/backend/internal/store"
	"github.com/simhozebs/net-worth-estimator/backend/internal/store/adapters/sqlite"
	"github.com/simhozebs/net-worth-estimator/backend/internal/types"
)

// These tests use the HTTP API over two scopes of one physical database. Router
// authorization tests separately prove that the caller cannot choose a scope.
func TestSharedDatabaseAPICanonicalReadsRemainUserScoped(t *testing.T) {
	database, err := sqlite.SetupDatabase(filepath.Join(t.TempDir(), "shared.db"))
	if err != nil {
		t.Fatal(err)
	}
	defer database.Close()
	const issuer = "https://identity.example"
	stores := make([]store.Store, 2)
	handlers := make([]http.Handler, 2)
	for i, subject := range []string{"alice", "bob"} {
		resource := authorization.ResourceFor(issuer, subject)
		stores[i], err = database.EnsureUser(authorization.ActorKey(issuer, subject), issuer, subject)
		if err != nil {
			t.Fatal(err)
		}
		if _, err := stores[i].CreateAccount(types.Account{ID: "same-id", Name: subject, Kind: "cash", Enabled: true}); err != nil {
			t.Fatal(err)
		}
		handlers[i] = New(stores[i], Config{ResourceID: resource.ID})
	}
	read := func(handler http.Handler) *types.FinancialModel {
		t.Helper()
		response := httptest.NewRecorder()
		handler.ServeHTTP(response, httptest.NewRequest(http.MethodGet, "/v1/financial-model", nil))
		if response.Code != http.StatusOK {
			t.Fatalf("read: %d %s", response.Code, response.Body.String())
		}
		var payload struct {
			Model *types.FinancialModel `json:"model"`
		}
		if err := json.Unmarshal(response.Body.Bytes(), &payload); err != nil {
			t.Fatal(err)
		}
		return payload.Model
	}
	for i, name := range []string{"alice", "bob"} {
		model := read(handlers[i])
		if model == nil || len(model.Accounts) != 1 || model.Accounts[0].Name != name {
			t.Fatalf("account %s read another scope: %+v", name, model)
		}
	}
	request := httptest.NewRequest(http.MethodPatch, "/v1/accounts/same-id", bytes.NewBufferString(`{"name":"Alice edited","kind":"cash","enabled":true}`))
	request.Header.Set("Content-Type", "application/json")
	response := httptest.NewRecorder()
	handlers[0].ServeHTTP(response, request)
	if response.Code != http.StatusOK {
		t.Fatalf("update: %d %s", response.Code, response.Body.String())
	}
	if model := read(handlers[0]); model == nil || len(model.Accounts) != 1 || model.Accounts[0].Name != "Alice edited" {
		t.Fatalf("update did not persist in selected scope: %+v", model)
	}
	if model := read(handlers[1]); model == nil || len(model.Accounts) != 1 || model.Accounts[0].Name != "bob" {
		t.Fatalf("update crossed the API plan boundary: %+v", model)
	}
	if _, err := stores[1].CreateAccount(types.Account{ID: "bob-only", Name: "Private destination", Kind: "cash", Enabled: true}); err != nil {
		t.Fatal(err)
	}
	request = httptest.NewRequest(http.MethodPost, "/v1/postings", bytes.NewBufferString(`{"id":"01900000-0000-7000-8000-000000000099","name":"Cross-plan transfer","sourceAccountId":"same-id","destinations":["bob-only"],"amount":{"resolver":"expression","config":{"expression":"5"},"inputs":{}},"postedTime":1785628800,"transactionTime":1785628800,"enabled":true}`))
	request.Header.Set("Content-Type", "application/json")
	response = httptest.NewRecorder()
	handlers[0].ServeHTTP(response, request)
	var rejected struct {
		Persisted bool                         `json:"persisted"`
		Issues    []types.ModelValidationIssue `json:"issues"`
	}
	if err := json.Unmarshal(response.Body.Bytes(), &rejected); err != nil {
		t.Fatal(err)
	}
	missingDestination := false
	for _, issue := range rejected.Issues {
		missingDestination = missingDestination || issue.Code == "posting.destination.missing"
	}
	if response.Code != http.StatusOK || rejected.Persisted || !missingDestination {
		t.Fatalf("cross-plan JSON reference accepted: %d %s", response.Code, response.Body.String())
	}
	if err := stores[0].Clear(); err != nil {
		t.Fatal(err)
	}
	if model := read(handlers[1]); model == nil || len(model.Accounts) != 2 || model.Accounts[0].Name != "bob" {
		t.Fatalf("clear crossed the API plan boundary: %+v", model)
	}
}

func TestSharedDatabaseAPIProjectionResultsRemainUserScoped(t *testing.T) {
	database, err := sqlite.SetupDatabase(filepath.Join(t.TempDir(), "shared.db"))
	if err != nil {
		t.Fatal(err)
	}
	defer database.Close()
	fixtureBytes, err := os.ReadFile(filepath.Join(apiProjectRoot(t), "backend", "testdata", "golden", "checkpoints.json"))
	if err != nil {
		t.Fatal(err)
	}
	var fixture struct {
		Model    *types.FinancialModel           `json:"model"`
		Settings types.ProjectionRuntimeSettings `json:"settings"`
	}
	if err := json.Unmarshal(fixtureBytes, &fixture); err != nil {
		t.Fatal(err)
	}
	body, err := json.Marshal(projectionRequestBody{Model: fixture.Model, Settings: fixture.Settings, Range: fullSpanRange()})
	if err != nil {
		t.Fatal(err)
	}
	const issuer = "https://identity.example"
	for _, subject := range []string{"alice", "bob"} {
		resource := authorization.ResourceFor(issuer, subject)
		plan, err := database.EnsureUser(authorization.ActorKey(issuer, subject), issuer, subject)
		if err != nil {
			t.Fatal(err)
		}
		handler := New(plan, Config{ResourceID: resource.ID})
		for _, source := range []string{projectionSourceComputed, projectionSourceStored} {
			request := httptest.NewRequest(http.MethodPost, "/v1/projections/deterministic", bytes.NewReader(body))
			request.Header.Set("Content-Type", "application/json")
			response := httptest.NewRecorder()
			handler.ServeHTTP(response, request)
			if response.Code != http.StatusOK || response.Header().Get("Projection-Source") != source {
				t.Fatalf("account %s wanted %s: %d %s", subject, source, response.Code, response.Body.String())
			}
			var payload struct {
				Result *types.ProjectionResult `json:"result"`
			}
			if err := json.Unmarshal(response.Body.Bytes(), &payload); err != nil || payload.Result == nil {
				t.Fatalf("account %s missing successful result: %v %s", subject, err, response.Body.String())
			}
		}
	}
}
