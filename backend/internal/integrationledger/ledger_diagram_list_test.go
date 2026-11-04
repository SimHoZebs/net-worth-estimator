package integrationledger

import (
	"bytes"
	"encoding/json"
	"math"
	"net/http"
	"net/http/httptest"
	"testing"

	"github.com/simhozebs/net-worth-estimator/backend/internal/types"
)

// Completeness: the money diagram shows every settled seed row exactly
// once with the ledger's hand-computed sums. Amounts below use the
// engine's whole-dollar rounding (bookshop 42.50 counts 43, refund 45.50
// counts 46); the list spec beside this one asserts the exact
// expressions. Projection starts on the checkpoint day (see the pack),
// because rows dated exactly on the start fall into history, not events.

func ledgerFlows(t *testing.T, world *ledgerWorld, start, end string) *types.FlowGraph {
	t.Helper()
	raw, err := json.Marshal(map[string]any{
		"settings": map[string]any{
			"fallbackProjectionStartDate": world.expected.ProjectionStart, "horizonYears": 1,
			"evaluations": types.EmptyEvaluationTables(),
		},
		"range": map[string]string{"startDate": start, "endDate": end},
	})
	if err != nil {
		t.Fatal(err)
	}
	request := httptest.NewRequest(http.MethodPost, "/v1/flows", bytes.NewReader(raw))
	request.Header.Set("Content-Type", "application/json")
	response := httptest.NewRecorder()
	world.plan.ServeHTTP(response, request)
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

func ledgerDeletePhantom(t *testing.T, world *ledgerWorld) {
	t.Helper()
	ids := ledgerPostingIDs(t, world.ownerSC)["PHANTOM"]
	if len(ids) != 1 {
		t.Fatalf("phantom rows = %d, want the 1 synced row before deletion", len(ids))
	}
	request := httptest.NewRequest(http.MethodDelete, "/v1/postings/"+ids[0], nil)
	response := httptest.NewRecorder()
	world.plan.ServeHTTP(response, request)
	if response.Code != http.StatusOK {
		t.Fatalf("delete phantom = %d %s", response.Code, response.Body.String())
	}
	if gone := ledgerPostingIDs(t, world.ownerSC)["PHANTOM"]; len(gone) != 0 {
		t.Fatalf("phantom survives deletion: %v", gone)
	}
}

func ledgerEdgeSources(graph *types.FlowGraph) map[string]int {
	seen := map[string]int{}
	for _, edge := range graph.Edges {
		for _, source := range edge.Sources {
			seen[source.PostingID]++
		}
	}
	return seen
}

func TestLedgerDiagramShowsEverySettledRowOnce(t *testing.T) {
	world := ledgerSetup(t, nil)
	ledgerDeletePhantom(t, world)
	want := world.expected

	graph := ledgerFlows(t, world, want.WindowStart, want.WindowEnd)
	if !graph.Reconciliation.Reconciled {
		t.Fatalf("reconciliation = %+v, want reconciled", graph.Reconciliation)
	}
	in := graph.Totals.Actual.Inflow + graph.Totals.Projected.Inflow
	out := graph.Totals.Actual.Outflow + graph.Totals.Projected.Outflow
	xfer := graph.Totals.Actual.Transfer + graph.Totals.Projected.Transfer
	if math.Abs(in-want.InflowTotal) > 0.001 || math.Abs(out-want.OutflowTotal) > 0.001 || math.Abs(xfer-want.TransferTotal) > 0.001 {
		t.Fatalf("diagram in=%.2f out=%.2f xfer=%.2f, want %.2f/%.2f/%.2f from the seed",
			in, out, xfer, want.InflowTotal, want.OutflowTotal, want.TransferTotal)
	}

	// Every settled seed row appears in exactly one edge's sources: the
	// monthly payoff transfer counted once, never as income plus expense.
	seen := ledgerEdgeSources(graph)
	if len(seen) != want.EdgeRows {
		t.Fatalf("sourced rows = %d, want %d settled seed rows", len(seen), want.EdgeRows)
	}
	model, err := world.ownerSC.LoadModel()
	if err != nil {
		t.Fatal(err)
	}
	settled := map[string]bool{}
	for _, posting := range model.Postings {
		if posting.Pending || posting.Void || !posting.Enabled {
			continue
		}
		settled[posting.ID] = true
		if seen[posting.ID] != 1 {
			t.Fatalf("row %q appears in %d edge sources, want exactly once", posting.Name, seen[posting.ID])
		}
	}
	for id := range seen {
		if !settled[id] {
			t.Fatalf("edge source %s names no settled seed row", id)
		}
	}
	transfers := map[string]int{}
	for _, edge := range graph.Edges {
		if edge.Kind == types.FlowKindTransfer {
			transfers[edge.From+"->"+edge.To]++
			if math.Abs(edge.Amount-500*float64(len(edge.Sources))) > 0.001 {
				t.Fatalf("transfer edge = %+v, want one edge per route carrying its sources once", edge)
			}
		}
	}
	// The four monthly payoffs share one route: a single transfer edge
	// carrying all four sources, counted once and never as income plus
	// expense.
	if len(transfers) != 1 {
		t.Fatalf("transfer routes = %d, want the single checking-to-card route", len(transfers))
	}
	// Pending, void, and deleted rows move nothing and stay out.
	byName := map[string]string{}
	for _, posting := range model.Postings {
		byName[posting.Name] = posting.ID
	}
	for _, name := range []string{"PENDING EATS", "VOIDED MART"} {
		if id, ok := byName[name]; ok && seen[id] != 0 {
			t.Fatalf("row %q reaches the diagram, want it held out", name)
		}
	}
	if _, ok := byName["PHANTOM"]; ok {
		t.Fatal("deleted phantom row present after deletion")
	}
}

// ledgerAprilStart is 2026-04-01 12:00 UTC: rows at or after it belong
// to the month the narrowed window drops.
const ledgerAprilStart = 1775001600

func TestLedgerNarrowWindowDropsApril(t *testing.T) {
	world := ledgerSetup(t, nil)
	ledgerDeletePhantom(t, world)
	want := world.expected

	graph := ledgerFlows(t, world, want.NarrowStart, want.NarrowEnd)
	in := graph.Totals.Actual.Inflow + graph.Totals.Projected.Inflow
	out := graph.Totals.Actual.Outflow + graph.Totals.Projected.Outflow
	xfer := graph.Totals.Actual.Transfer + graph.Totals.Projected.Transfer
	if math.Abs(in-want.NarrowIn) > 0.001 || math.Abs(out-want.NarrowOut) > 0.001 || math.Abs(xfer-want.NarrowXfer) > 0.001 {
		t.Fatalf("narrowed in=%.2f out=%.2f xfer=%.2f, want %.2f/%.2f/%.2f",
			in, out, xfer, want.NarrowIn, want.NarrowOut, want.NarrowXfer)
	}
	seen := ledgerEdgeSources(graph)
	model, err := world.ownerSC.LoadModel()
	if err != nil {
		t.Fatal(err)
	}
	for _, posting := range model.Postings {
		isApril := posting.TransactionTime >= ledgerAprilStart
		if isApril && !posting.Pending && !posting.Void && posting.Enabled && seen[posting.ID] != 0 {
			t.Fatalf("april row %q leaks into the narrowed window", posting.Name)
		}
	}
}

func TestLedgerEmptyWindowShowsEmpty(t *testing.T) {
	world := ledgerSetup(t, nil)
	ledgerDeletePhantom(t, world)

	graph := ledgerFlows(t, world, "2025-01-01", "2025-12-31")
	if len(graph.Edges) != 0 {
		t.Fatalf("empty window edges = %d, want none", len(graph.Edges))
	}
	in := graph.Totals.Actual.Inflow + graph.Totals.Projected.Inflow
	out := graph.Totals.Actual.Outflow + graph.Totals.Projected.Outflow
	xfer := graph.Totals.Actual.Transfer + graph.Totals.Projected.Transfer
	if in != 0 || out != 0 || xfer != 0 {
		t.Fatalf("empty window totals = %.2f/%.2f/%.2f, want zeros not an error", in, out, xfer)
	}
}

type ledgerListRow struct {
	ID     string `json:"id"`
	Name   string `json:"name"`
	Amount struct {
		Config map[string]any `json:"config"`
	} `json:"amount"`
	StartDate string `json:"startDate"`
	Pending   bool   `json:"pending"`
	Void      bool   `json:"void"`
	Enabled   bool   `json:"enabled"`
}

func ledgerList(t *testing.T, world *ledgerWorld) []ledgerListRow {
	t.Helper()
	request := httptest.NewRequest(http.MethodGet, "/v1/transactions", nil)
	response := httptest.NewRecorder()
	world.plan.ServeHTTP(response, request)
	if response.Code != http.StatusOK {
		t.Fatalf("transactions status = %d, body %s", response.Code, response.Body.String())
	}
	var payload struct {
		Transactions []ledgerListRow `json:"transactions"`
	}
	if err := json.Unmarshal(response.Body.Bytes(), &payload); err != nil {
		t.Fatal(err)
	}
	return payload.Transactions
}

// Completeness: the transaction list shows every seed row with its exact
// amount expression, date, and merchant; the pending row carries its
// marker and the voided row its marker; the deleted phantom is absent.
// The list shows exact values while the diagram rounds: both specs assert
// their own true numbers.
func TestLedgerTransactionListShowsSeedRows(t *testing.T) {
	world := ledgerSetup(t, nil)
	ledgerDeletePhantom(t, world)
	want := world.expected

	rows := ledgerList(t, world)
	if len(rows) != want.ListedPostings {
		t.Fatalf("listed rows = %d, want %d seed rows, no more no less", len(rows), want.ListedPostings)
	}
	byID := map[string]ledgerListRow{}
	for _, row := range rows {
		if _, dup := byID[row.ID]; dup {
			t.Fatalf("row %s listed twice", row.ID)
		}
		byID[row.ID] = row
	}
	// Hand-checked spot rows: exact expression, calendar day, merchant.
	for _, spot := range []struct{ name, expression, day string }{
		{"Paycheck January", "3000", "2026-01-15"},
		{"Paycheck April", "3000", "2026-04-15"},
		{"Rent January", "1200", "2026-01-01"},
		{"Bookshop order", "42.50", "2026-01-20"},
		{"Refund desk", "45.50", "2026-03-20"},
		{"Cafe", "75", "2026-03-05"},
		{"Clothes", "125", "2026-04-08"},
		{"Card payoff February", "500", "2026-02-28"},
		{"FUEL STOP", "150.00", "2026-02-12"},
		{"GROCERY OUTLET", "150.00", "2026-03-12"},
		{"CORNER GROCER", "150.00", "2026-04-12"},
	} {
		found := false
		for _, row := range rows {
			if row.Name != spot.name {
				continue
			}
			found = true
			expression, _ := row.Amount.Config["expression"].(string)
			if expression != spot.expression || string(row.StartDate) != spot.day {
				t.Fatalf("row %q = %q on %q, want %q on %q", row.Name, expression, row.StartDate, spot.expression, spot.day)
			}
		}
		if !found {
			t.Fatalf("seed row %q missing from the list", spot.name)
		}
	}
	// The four monthly grocery charges list on their four dates.
	grocerDays := map[string]bool{}
	for _, row := range rows {
		if row.Name != "GROCER 123" {
			continue
		}
		if expression, _ := row.Amount.Config["expression"].(string); expression != "150.00" {
			t.Fatalf("grocery row amount = %q, want 150.00", expression)
		}
		grocerDays[string(row.StartDate)] = true
	}
	for _, day := range []string{"2026-01-10", "2026-02-10", "2026-03-10", "2026-04-10"} {
		if !grocerDays[day] {
			t.Fatalf("grocery rows land on %v, want all four charge dates", grocerDays)
		}
	}
	// Lifecycle markers: pending stays pending, void stays void, deleted
	// stays gone.
	flagged := map[string]ledgerListRow{}
	for _, row := range rows {
		flagged[row.Name] = row
	}
	if eats, ok := flagged["PENDING EATS"]; !ok || !eats.Pending {
		t.Fatalf("pending row = %+v, want it listed as pending", eats)
	} else if expression, _ := eats.Amount.Config["expression"].(string); expression != "25.00" || string(eats.StartDate) != "2026-04-28" {
		// Bank rows store absolute amounts with the direction in the
		// route, and pending rows time at the purchase stamp: 25.00 out
		// of checking on the seed's purchase day.
		t.Fatalf("pending row = %q on %q, want 25.00 on 2026-04-28", expression, eats.StartDate)
	}
	if mart, ok := flagged["VOIDED MART"]; !ok || !mart.Void {
		t.Fatalf("voided row = %+v, want it listed as void", mart)
	}
	for _, row := range rows {
		if row.Name == "PHANTOM" {
			t.Fatal("deleted phantom row listed")
		}
	}
}
