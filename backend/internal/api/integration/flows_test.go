package integration

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
