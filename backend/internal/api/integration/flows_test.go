package integration

import (
	"bytes"
	"encoding/json"
	"net/http"
	"net/http/httptest"
	"os"
	"path/filepath"
	"testing"
	"time"

	"github.com/simhozebs/net-worth-estimator/backend/internal/types"
)

func flowsRequest(t *testing.T, handler http.Handler, body []byte) *httptest.ResponseRecorder {
	t.Helper()
	request := httptest.NewRequest(http.MethodPost, "/v1/flows", bytes.NewReader(body))
	request.Header.Set("Content-Type", "application/json")
	response := httptest.NewRecorder()
	handler.ServeHTTP(response, request)
	return response
}

func flowsFixture(t *testing.T) (*types.FinancialModel, types.ProjectionRuntimeSettings) {
	t.Helper()
	fixturePath := filepath.Join(apiProjectRoot(t), "backend", "testdata", "golden", "checkpoints.json")
	fixtureBytes, err := os.ReadFile(fixturePath)
	if err != nil {
		t.Fatalf("read projection fixture: %v", err)
	}
	var fixture struct {
		Model    *types.FinancialModel           `json:"model"`
		Settings types.ProjectionRuntimeSettings `json:"settings"`
	}
	if err := json.Unmarshal(fixtureBytes, &fixture); err != nil {
		t.Fatalf("decode projection fixture: %v", err)
	}
	return fixture.Model, fixture.Settings
}

func flowsBody(t *testing.T, r *projectionRange) []byte {
	t.Helper()
	model, settings := flowsFixture(t)
	raw, err := json.Marshal(projectionRequestBody{Model: model, Settings: settings, Range: r})
	if err != nil {
		t.Fatalf("encode flows request: %v", err)
	}
	return raw
}

func decodeFlowGraph(t *testing.T, response *httptest.ResponseRecorder) *types.FlowGraph {
	t.Helper()
	if response.Code != http.StatusOK {
		t.Fatalf("flows status = %d, body %s", response.Code, response.Body.String())
	}
	var payload struct {
		Graph *types.FlowGraph `json:"graph"`
	}
	if err := json.Unmarshal(response.Body.Bytes(), &payload); err != nil {
		t.Fatalf("decode flows response: %v", err)
	}
	if payload.Graph == nil {
		t.Fatalf("flows has no graph: %s", response.Body.String())
	}
	return payload.Graph
}

// The flows endpoint exposes the VIS-01 graph contract over the same
// simulation as the deterministic projection: directed edges with source
// records, unmatched and unobserved buckets, coverage, and reconciled
// totals.
func TestFlowsGraphReconcilesWithSourceRecords(t *testing.T) {
	database := openAPIStore(t)
	handler := New(database, Config{})

	graph := decodeFlowGraph(t, flowsRequest(t, handler, flowsBody(t, fullSpanRange())))
	if len(graph.Edges) == 0 {
		t.Fatal("flows graph has no edges")
	}
	if string(graph.StartDate) != "2000-01-01" || string(graph.EndDate) != "2100-01-01" {
		t.Errorf("graph window = %s..%s, want the requested range", graph.StartDate, graph.EndDate)
	}
	external := false
	for _, node := range graph.Nodes {
		if node.ID == types.FlowNodeIDExternal {
			external = true
		}
	}
	if !external {
		t.Errorf("nodes = %+v, want the external counterparty", graph.Nodes)
	}
	for _, edge := range graph.Edges {
		if len(edge.Sources) == 0 {
			t.Errorf("edge %+v has no source records", edge)
		}
		for _, source := range edge.Sources {
			if source.Date < graph.StartDate || source.Date > graph.EndDate {
				t.Errorf("edge source %+v outside window", source)
			}
		}
	}
	reconciliation := graph.Reconciliation
	if !reconciliation.Reconciled {
		t.Errorf("reconciliation = %+v, want reconciled", reconciliation)
	}
	if reconciliation.EdgesInflow != graph.Totals.Actual.Inflow+graph.Totals.Projected.Inflow ||
		reconciliation.EdgesOutflow != graph.Totals.Actual.Outflow+graph.Totals.Projected.Outflow ||
		reconciliation.EdgesTransfer != graph.Totals.Actual.Transfer+graph.Totals.Projected.Transfer {
		t.Errorf("totals %+v disagree with reconciliation %+v", graph.Totals, reconciliation)
	}
	if graph.Unmatched == nil || graph.Unobserved == nil {
		t.Error("graph must always carry unmatched and unobserved arrays")
	}
}

func TestFlowsRequiresRange(t *testing.T) {
	database := openAPIStore(t)
	handler := New(database, Config{})
	model, settings := flowsFixture(t)
	raw, err := json.Marshal(projectionRequestBody{Model: model, Settings: settings})
	if err != nil {
		t.Fatal(err)
	}
	response := flowsRequest(t, handler, raw)
	if response.Code != http.StatusUnprocessableEntity {
		t.Errorf("flows without range status = %d, want 422", response.Code)
	}
}

// Settled history must surface as recorded money through the endpoint:
// rows dated before the projection start emit no transaction events, so
// only the settled replay can draw their edges. Each transaction appears
// exactly once and the transfer counts once with its full amount.
func TestFlowsIncludesSettledHistoryAsActual(t *testing.T) {
	database := openAPIStore(t)
	handler := New(database, Config{})
	checking := "checking"
	stamp := func(month time.Month, day int) int64 {
		return time.Date(2025, month, day, 12, 0, 0, 0, time.UTC).Unix()
	}
	expression := func(value string) types.TransactionAmountResolution {
		return types.TransactionAmountResolution{
			Resolver: "expression",
			Config:   map[string]any{"expression": value},
			Inputs:   map[string]types.AmountInputBinding{},
		}
	}
	salaryAt, groceriesAt, saveAt := stamp(time.September, 15), stamp(time.September, 16), stamp(time.September, 17)
	model := &types.FinancialModel{
		Accounts: []types.Account{
			{ID: "checking", Name: "Checking", Kind: types.AccountKindCash, Enabled: true},
			{ID: "savings", Name: "Savings", Kind: types.AccountKindCash, Enabled: true},
		},
		Transactions: []types.Transaction{
			{
				ID: "salary", Name: "Salary", Destinations: []string{"checking"},
				Amount: expression("3000"), PostedTime: salaryAt, TransactionTime: salaryAt,
				Enabled: true, Source: "banksync",
			},
			{
				ID: "groceries", Name: "Groceries", SourceAccountID: &checking,
				Amount: expression("120"), PostedTime: groceriesAt, TransactionTime: groceriesAt,
				Enabled: true, Source: "banksync",
			},
			{
				ID: "save", Name: "Save", SourceAccountID: &checking, Destinations: []string{"savings"},
				Amount: expression("500"), PostedTime: saveAt, TransactionTime: saveAt,
				Enabled: true, Source: "banksync",
			},
		},
	}
	settings := types.ProjectionRuntimeSettings{
		FallbackProjectionStartDate: "2026-01-01",
		HorizonYears:                1,
	}
	raw, err := json.Marshal(projectionRequestBody{
		Model:    model,
		Settings: settings,
		Range:    &projectionRange{StartDate: "2025-09-01", EndDate: "2025-09-30"},
	})
	if err != nil {
		t.Fatal(err)
	}
	graph := decodeFlowGraph(t, flowsRequest(t, handler, raw))
	if graph.Totals.Actual.Inflow != 3000 || graph.Totals.Actual.Outflow != 120 || graph.Totals.Actual.Transfer != 500 {
		t.Errorf("actual totals = %+v, want inflow 3000 outflow 120 transfer 500", graph.Totals.Actual)
	}
	seen := map[string]int{}
	for _, edge := range graph.Edges {
		for _, source := range edge.Sources {
			seen[source.TransactionID]++
		}
	}
	for _, id := range []string{"salary", "groceries", "save"} {
		if seen[id] != 1 {
			t.Errorf("transaction %s appears in %d edge sources, want exactly once", id, seen[id])
		}
	}
	if !graph.Reconciliation.Reconciled {
		t.Errorf("reconciliation = %+v, want reconciled", graph.Reconciliation)
	}
	if graph.Reconciliation.WindowEvents != 3 || graph.Reconciliation.ClassifiedEvents != 3 {
		t.Errorf("reconciliation = %+v, want 3 window and classified movements", graph.Reconciliation)
	}
}
