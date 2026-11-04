package integration

import (
	"bytes"
	"encoding/json"
	"math"
	"net/http"
	"net/http/httptest"
	"testing"

	"github.com/simhozebs/net-worth-estimator/backend/internal/types"
)

// QA-03 journey 4: flow drilldowns over the stored model.
//
// Rows enter through the production row APIs, then the journey walks the
// full drilldown the diagram UI drives: window to graph, graph to edge,
// edge to source rows. Totals must agree across the node listing, the
// edges, and the reconciliation against source records, and transfers must
// count once. The table view carries the same graph content through the
// shared frontend derivation, which the browser suite pins; this journey
// pins the backend contract that derivation reads.

func qa03FlowsGraph(t *testing.T, handler http.Handler, start, end string) *types.FlowGraph {
	t.Helper()
	raw, err := json.Marshal(projectionRequestBody{
		Settings: qa03ProjectionSettings(),
		Range:    &projectionRange{StartDate: start, EndDate: end},
	})
	if err != nil {
		t.Fatal(err)
	}
	request := httptest.NewRequest(http.MethodPost, "/v1/flows", bytes.NewReader(raw))
	request.Header.Set("Content-Type", "application/json")
	response := httptest.NewRecorder()
	handler.ServeHTTP(response, request)
	if response.Code != http.StatusOK {
		t.Fatalf("flows status = %d, body %s", response.Code, response.Body.String())
	}
	var payload struct {
		Graph *types.FlowGraph `json:"graph"`
	}
	if err := json.Unmarshal(response.Body.Bytes(), &payload); err != nil {
		t.Fatal(err)
	}
	if payload.Graph == nil {
		t.Fatalf("flows has no graph: %s", response.Body.String())
	}
	return payload.Graph
}

func qa03CreateRow(t *testing.T, handler http.Handler, path, body string) string {
	t.Helper()
	response := doRowRequest(t, handler, http.MethodPost, path, body)
	if response.Code != http.StatusOK {
		t.Fatalf("POST %s = %d %s", path, response.Code, response.Body.String())
	}
	var payload struct {
		Result struct {
			ID string `json:"id"`
		} `json:"value"`
	}
	if err := json.Unmarshal(response.Body.Bytes(), &payload); err != nil {
		t.Fatal(err)
	}
	if payload.Result.ID == "" {
		t.Fatalf("POST %s returned no row ID: %s", path, response.Body.String())
	}
	return payload.Result.ID
}

func TestQA03FlowDrilldownTotalsAgreeAndTransfersCountOnce(t *testing.T) {
	database := openAPIStore(t)
	handler := New(database, Config{})

	checking := qa03CreateRow(t, handler, "/v1/accounts", `{"name":"Checking","kind":"cash","enabled":true}`)
	savings := qa03CreateRow(t, handler, "/v1/accounts", `{"name":"Savings","kind":"cash","enabled":true}`)
	if response := doRowRequest(t, handler, http.MethodPost, "/v1/checkpoints",
		`{"AccountId":"`+checking+`","Balance":5000,"observedAt":1774958400}`); response.Code != http.StatusOK {
		t.Fatalf("checkpoint = %d %s", response.Code, response.Body.String())
	}

	// One inflow, one outflow, one account-to-account transfer in June, and
	// a second outflow in July so window narrowing has something to drop.
	outflowJune := qa03CreateRow(t, handler, "/v1/postings",
		`{"name":"Groceries","sourceAccountId":"`+checking+`","destinations":null,"amount":{"resolver":"expression","config":{"expression":"100"},"inputs":{}},"postedTime":1781524800,"transactionTime":1781524800,"enabled":true}`)
	inflowJune := qa03CreateRow(t, handler, "/v1/postings",
		`{"name":"Salary","sourceAccountId":null,"destinations":["`+checking+`"],"amount":{"resolver":"expression","config":{"expression":"2000"},"inputs":{}},"postedTime":1781524800,"transactionTime":1781524800,"enabled":true}`)
	transferJune := qa03CreateRow(t, handler, "/v1/postings",
		`{"name":"Save","sourceAccountId":"`+checking+`","destinations":["`+savings+`"],"amount":{"resolver":"expression","config":{"expression":"500"},"inputs":{}},"postedTime":1781524800,"transactionTime":1781524800,"enabled":true}`)
	outflowJuly := qa03CreateRow(t, handler, "/v1/postings",
		`{"name":"Fuel","sourceAccountId":"`+checking+`","destinations":null,"amount":{"resolver":"expression","config":{"expression":"40"},"inputs":{}},"postedTime":1784116800,"transactionTime":1784116800,"enabled":true}`)

	model, err := database.LoadModel()
	if err != nil {
		t.Fatal(err)
	}
	known := map[string]bool{}
	for _, posting := range model.Postings {
		known[posting.ID] = true
	}
	for _, id := range []string{outflowJune, inflowJune, transferJune, outflowJuly} {
		if !known[id] {
			t.Fatalf("posting %s missing from the stored model", id)
		}
	}

	graph := qa03FlowsGraph(t, handler, "2026-01-01", "2026-12-31")
	if string(graph.StartDate) != "2026-01-01" || string(graph.EndDate) != "2026-12-31" {
		t.Fatalf("window = %s..%s, want the requested range", graph.StartDate, graph.EndDate)
	}
	if len(graph.Edges) == 0 {
		t.Fatal("graph has no edges")
	}

	// Every edge source drills down to a real stored row inside the window,
	// and single-route events appear exactly once across all edges.
	seen := map[string]int{}
	for _, edge := range graph.Edges {
		if len(edge.Sources) == 0 {
			t.Fatalf("edge %+v has no source records", edge)
		}
		for _, source := range edge.Sources {
			if source.Date < graph.StartDate || source.Date > graph.EndDate {
				t.Fatalf("source %+v outside the window", source)
			}
			if !known[source.PostingID] {
				t.Fatalf("source %+v names no stored posting", source)
			}
			seen[source.PostingID]++
		}
	}
	for _, id := range []string{outflowJune, inflowJune, transferJune, outflowJuly} {
		if seen[id] != 1 {
			t.Fatalf("posting %s appears in %d edge sources, want exactly once", id, seen[id])
		}
	}

	// Diagram totals agree with the reconciliation against source records.
	reconciliation := graph.Reconciliation
	if !reconciliation.Reconciled {
		t.Fatalf("reconciliation = %+v, want reconciled", reconciliation)
	}
	if reconciliation.EdgesInflow != graph.Totals.Actual.Inflow+graph.Totals.Projected.Inflow ||
		reconciliation.EdgesOutflow != graph.Totals.Actual.Outflow+graph.Totals.Projected.Outflow ||
		reconciliation.EdgesTransfer != graph.Totals.Actual.Transfer+graph.Totals.Projected.Transfer {
		t.Fatalf("totals %+v disagree with reconciliation %+v", graph.Totals, reconciliation)
	}

	// Node-level sums describe the same money as the edge totals: every
	// edge credits its from-side and its to-side, so both node sums equal
	// the all-edges total with transfers counted once.
	var nodeIn, nodeOut float64
	for _, node := range graph.Nodes {
		nodeIn += node.Inflow
		nodeOut += node.Outflow
	}
	edgeIn := graph.Totals.Actual.Inflow + graph.Totals.Projected.Inflow
	edgeOut := graph.Totals.Actual.Outflow + graph.Totals.Projected.Outflow
	edgeTransfer := graph.Totals.Actual.Transfer + graph.Totals.Projected.Transfer
	edgeAll := edgeIn + edgeOut + edgeTransfer
	if math.Abs(nodeIn-edgeAll) > 0.001 || math.Abs(nodeOut-edgeAll) > 0.001 {
		t.Fatalf("nodes in=%.2f out=%.2f disagree with all-edges total %.2f",
			nodeIn, nodeOut, edgeAll)
	}

	// The transfer counts once: one transfer edge carrying the full posting
	// amount, excluded from inflow and outflow.
	transfers := 0
	for _, edge := range graph.Edges {
		if edge.Kind != types.FlowKindTransfer {
			continue
		}
		transfers++
		if math.Abs(edge.Amount-500) > 0.001 {
			t.Fatalf("transfer edge = %+v, want the 500 posting counted once", edge)
		}
	}
	if transfers != 1 {
		t.Fatalf("transfer edges = %d, want exactly one", transfers)
	}
	if math.Abs(edgeTransfer-500) > 0.001 {
		t.Fatalf("transfer total = %.2f, want 500", edgeTransfer)
	}
	if math.Abs(edgeIn-2000) > 0.001 || math.Abs(edgeOut-140) > 0.001 {
		t.Fatalf("in=%.2f out=%.2f, want 2000 and 140 with no transfer leakage", edgeIn, edgeOut)
	}

	// Narrowing the window to June drops the July source and its amount.
	june := qa03FlowsGraph(t, handler, "2026-06-01", "2026-06-30")
	juneOut := june.Totals.Actual.Outflow + june.Totals.Projected.Outflow
	if math.Abs(juneOut-100) > 0.001 {
		t.Fatalf("june outflow = %.2f, want 100 without July", juneOut)
	}
	for _, edge := range june.Edges {
		for _, source := range edge.Sources {
			if source.PostingID == outflowJuly {
				t.Fatalf("july source %+v leaks into the june window", source)
			}
		}
	}
}
