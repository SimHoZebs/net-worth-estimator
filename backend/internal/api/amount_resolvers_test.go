package api

import (
	"encoding/json"
	"net/http"
	"net/http/httptest"
	"testing"
)

func TestGetAmountResolversListsRegistry(t *testing.T) {
	database := openAPIStore(t)
	handler := New(database, Config{})
	response := httptest.NewRecorder()
	handler.ServeHTTP(response, httptest.NewRequest(http.MethodGet, "/v1/amount-resolvers", nil))
	if response.Code != http.StatusOK {
		t.Fatalf("GET status = %d, body %s", response.Code, response.Body.String())
	}
	var payload struct {
		Resolvers []struct {
			Name string `json:"name"`
		} `json:"resolvers"`
		Providers []struct {
			Name string `json:"name"`
		} `json:"providers"`
	}
	if err := json.Unmarshal(response.Body.Bytes(), &payload); err != nil {
		t.Fatalf("decode resolvers response: %v", err)
	}
	names := map[string]bool{}
	for _, r := range payload.Resolvers {
		names[r.Name] = true
	}
	if !names["expression"] || !names["income"] {
		t.Fatalf("resolvers = %+v, want expression and income", payload.Resolvers)
	}
	providers := map[string]bool{}
	for _, p := range payload.Providers {
		providers[p.Name] = true
	}
	for _, want := range []string{"model-value", "account-balance", "occurrence-rate", "growth-factor"} {
		if !providers[want] {
			t.Fatalf("providers = %+v, missing %s", payload.Providers, want)
		}
	}
}
