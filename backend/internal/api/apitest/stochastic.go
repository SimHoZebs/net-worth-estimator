package apitest

import (
	"bytes"
	"encoding/json"
	"net/http"
	"net/http/httptest"
	"strings"
	"testing"

	"github.com/simhozebs/net-worth-estimator/backend/internal/types"
)

func StochasticDocument() *types.FinancialModelDocument {
	end := "2027-01-01"
	return &types.FinancialModelDocument{
		Accounts: []types.Account{{ID: "checking", Name: "Checking", Kind: types.AccountKindCash, Enabled: true}},
		Postings: []types.Posting{},
		RecurrenceRules: []types.RecurrenceRule{{
			ID: "salary", Name: "Salary", Destinations: []string{"checking"},
			Amount:    types.PostingAmountResolution{Resolver: "expression", Config: map[string]any{"expression": "100"}},
			Frequency: types.FrequencyMonthly, StartDate: "2026-01-01", EndDate: &end, Priority: 1, Enabled: true,
		}},
		Evaluations: types.EmptyEvaluationTables(),
	}
}

func StochasticBody(t *testing.T, runCount int, seed *int64) []byte {
	t.Helper()
	raw, err := json.Marshal(map[string]any{
		"document": StochasticDocument(),
		"settings": types.ProjectionRuntimeSettings{
			FallbackProjectionStartDate: "2026-06-01", HorizonYears: 1, Evaluations: types.EmptyEvaluationTables(),
		},
		"config": map[string]any{"runCount": runCount, "seed": seed},
	})
	if err != nil {
		t.Fatalf("marshal stochastic body: %v", err)
	}
	return raw
}

func PostStochastic(t *testing.T, handler http.Handler, body []byte) *httptest.ResponseRecorder {
	t.Helper()
	request := httptest.NewRequest(http.MethodPost, "/v1/projections/stochastic", bytes.NewReader(body))
	request.Header.Set("Content-Type", "application/json")
	response := httptest.NewRecorder()
	handler.ServeHTTP(response, request)
	return response
}

func SSEEvents(t *testing.T, body string) map[string][]string {
	t.Helper()
	out := map[string][]string{}
	for _, raw := range strings.Split(body, "\n\n") {
		name := "message"
		var data []string
		for _, line := range strings.Split(raw, "\n") {
			if strings.HasPrefix(line, "event:") {
				name = strings.TrimSpace(strings.TrimPrefix(line, "event:"))
			} else if strings.HasPrefix(line, "data:") {
				data = append(data, strings.TrimSpace(strings.TrimPrefix(line, "data:")))
			}
		}
		if len(data) > 0 {
			out[name] = append(out[name], strings.Join(data, "\n"))
		}
	}
	return out
}
