package domain

import (
	"fmt"
	"testing"
	"time"

	"github.com/simhozebs/net-worth-estimator/backend/internal/types"
)

func flowTestAmount(expression string) types.PostingAmountResolution {
	return types.PostingAmountResolution{
		Resolver: "expression",
		Config:   map[string]any{"expression": expression},
		Inputs:   map[string]types.AmountInputBinding{},
	}
}

func flowTestModel() *types.FinancialModel {
	checking := "checking"
	savings := "savings"
	return &types.FinancialModel{
		Accounts: []types.Account{
			{ID: "checking", Name: "Checking", Kind: types.AccountKindCash, Enabled: true},
			{ID: "savings", Name: "Savings", Kind: types.AccountKindCash, Enabled: true},
			{ID: "vault", Name: "Vault", Kind: types.AccountKindCash, Enabled: true},
		},
		Postings: []types.Posting{
			{
				ID:              "paycheck",
				Name:            "Paycheck",
				Destinations:    []string{"checking"},
				Amount:          flowTestAmount("1000"),
				PostedTime:      time.Date(2026, 2, 15, 12, 0, 0, 0, time.UTC).Unix(),
				TransactionTime: time.Date(2026, 2, 15, 12, 0, 0, 0, time.UTC).Unix(),
				Enabled:         true,
			},
			{
				ID:              "move",
				Name:            "Move to savings",
				SourceAccountID: &checking,
				Destinations:    []string{savings},
				Amount:          flowTestAmount("400"),
				PostedTime:      time.Date(2026, 3, 1, 12, 0, 0, 0, time.UTC).Unix(),
				TransactionTime: time.Date(2026, 3, 1, 12, 0, 0, 0, time.UTC).Unix(),
				Enabled:         true,
			},
		},
		RecurrenceRules: []types.RecurrenceRule{
			{
				ID:              "rent",
				Name:            "Rent",
				SourceAccountID: &checking,
				Amount:          flowTestAmount("800"),
				Frequency:       types.FrequencyMonthly,
				StartDate:       "2025-12-01",
				Priority:        1,
				Enabled:         true,
			},
		},
	}
}

func flowTestSettings() *types.ProjectionRuntimeSettings {
	return &types.ProjectionRuntimeSettings{
		FallbackProjectionStartDate: "2026-01-01",
		HorizonYears:                1,
	}
}

func findFlowEdge(t *testing.T, graph *types.FlowGraph, from, to, kind, movement string) types.FlowEdge {
	t.Helper()
	for _, edge := range graph.Edges {
		if edge.From == from && edge.To == to && edge.Kind == kind && edge.Movement == movement {
			return edge
		}
	}
	t.Fatalf("missing edge %s->%s %s %s in %+v", from, to, kind, movement, graph.Edges)
	return types.FlowEdge{}
}

// The graph separates recorded postings (actual) from rule-generated
// occurrences (projected) and counts a structural transfer once: one
// transfer edge, never an income-plus-expense pair.
func TestFlowGraphSeparatesActualProjectedAndCountsTransferOnce(t *testing.T) {
	model := flowTestModel()
	path, result, err := ProjectRawFinancialModel(model, flowTestSettings(), types.EmptyModelOverrides(), nil)
	if err != nil {
		t.Fatalf("project: %v", err)
	}
	graph, err := BuildFlowGraph(&path.EffectiveModel, result.TransactionEvents, result.Timeline.Rows, "2026-01-01", "2026-12-31")
	if err != nil {
		t.Fatalf("build flow graph: %v", err)
	}

	inflow := findFlowEdge(t, graph, types.FlowNodeIDExternal, "checking", types.FlowKindInflow, types.FlowMovementActual)
	if inflow.Amount != 1000 {
		t.Errorf("actual inflow = %v, want 1000", inflow.Amount)
	}
	if len(inflow.Sources) != 1 || inflow.Sources[0].PostingID != "paycheck" {
		t.Errorf("inflow sources = %+v, want the paycheck record", inflow.Sources)
	}
	transfer := findFlowEdge(t, graph, "checking", "savings", types.FlowKindTransfer, types.FlowMovementActual)
	if transfer.Amount != 400 {
		t.Errorf("actual transfer = %v, want 400 counted once", transfer.Amount)
	}
	rent := findFlowEdge(t, graph, "checking", types.FlowNodeIDExternal, types.FlowKindOutflow, types.FlowMovementProjected)
	// The January occurrence replays as history (start-day cut), so the
	// window holds February through December: 11 projected records.
	if rent.Amount != 11*800 {
		t.Errorf("projected outflow = %v, want %v", rent.Amount, 11*800)
	}
	if len(rent.Sources) != 11 {
		t.Errorf("rent sources = %d, want 11 monthly records", len(rent.Sources))
	}
	for _, edge := range graph.Edges {
		if edge.Kind == types.FlowKindInflow && edge.Movement == types.FlowMovementProjected {
			t.Errorf("unexpected projected inflow edge: %+v", edge)
		}
		if edge.From == "savings" && edge.To == "checking" {
			t.Errorf("transfer direction flipped: %+v", edge)
		}
	}

	if graph.Totals.Actual.Inflow != 1000 || graph.Totals.Actual.Transfer != 400 {
		t.Errorf("actual totals = %+v, want inflow 1000 transfer 400", graph.Totals.Actual)
	}
	if graph.Totals.Projected.Outflow != 11*800 {
		t.Errorf("projected totals = %+v, want outflow %v", graph.Totals.Projected, 11*800)
	}
	if !graph.Reconciliation.Reconciled {
		t.Errorf("reconciliation = %+v, want reconciled", graph.Reconciliation)
	}
	if graph.Reconciliation.WindowEvents != graph.Reconciliation.ClassifiedEvents {
		t.Errorf("reconciliation = %+v, want every event classified", graph.Reconciliation)
	}
}

// Unknown origins and balance-check corrections stay visible outside the
// edge set, and accounts without observations are flagged as incomplete
// coverage.
func TestFlowGraphExposesUnmatchedUnobservedAndCoverage(t *testing.T) {
	model := flowTestModel()
	events := []types.TransactionEvent{
		{
			Date: "2026-02-15", Sequence: 0,
			Origin:          types.TransactionOrigin{Type: "posting", PostingID: "paycheck"},
			RequestedAmount: 1000, RealizedAmount: 1000,
			AccountDeltas: []struct {
				AccountID string  `json:"accountId"`
				Delta     float64 `json:"delta"`
			}{{AccountID: "checking", Delta: 1000}},
		},
		{
			Date: "2026-04-01", Sequence: 1,
			Origin:          types.TransactionOrigin{Type: "posting", PostingID: "ghost"},
			RequestedAmount: 50, RealizedAmount: 50,
		},
	}
	rows := []types.ProjectionRow{
		{
			Date: "2026-02-20", IsHistorical: true,
			CheckpointCorrections: []types.CheckpointCorrection{
				{AccountID: "checking", ObservedBalance: 1100, ModeledBalance: 1000, Adjustment: 100},
			},
		},
	}
	graph, err := BuildFlowGraph(model, events, rows, "2026-01-01", "2026-12-31")
	if err != nil {
		t.Fatalf("build flow graph: %v", err)
	}

	if len(graph.Unmatched) != 1 || graph.Unmatched[0].PostingID != "ghost" {
		t.Errorf("unmatched = %+v, want the ghost event", graph.Unmatched)
	}
	if graph.Totals.Unmatched != 50 {
		t.Errorf("unmatched total = %v, want 50", graph.Totals.Unmatched)
	}
	if len(graph.Unobserved) != 1 || graph.Unobserved[0].Adjustment != 100 {
		t.Errorf("unobserved = %+v, want the 100 correction", graph.Unobserved)
	}
	if graph.Totals.Unobserved != 100 {
		t.Errorf("unobserved total = %v, want 100", graph.Totals.Unobserved)
	}
	// No checkpoints exist, so every enabled account is uncovered.
	if len(graph.Coverage.UnobservedAccounts) != 3 {
		t.Errorf("coverage = %+v, want all accounts unobserved", graph.Coverage)
	}
	for _, edge := range graph.Edges {
		for _, source := range edge.Sources {
			if source.PostingID == "ghost" {
				t.Errorf("unmatched event entered edge %+v", edge)
			}
		}
	}
	if !graph.Reconciliation.Reconciled {
		t.Errorf("reconciliation = %+v, want reconciled", graph.Reconciliation)
	}

	// A checkpoint at the window end observes its account only.
	model.Checkpoints = []types.Checkpoint{
		{AccountID: "checking", Balance: 1100, ObservedAt: time.Date(2026, 12, 31, 23, 59, 59, 0, time.UTC).Unix()},
	}
	observed, err := BuildFlowGraph(model, events, rows, "2026-01-01", "2026-12-31")
	if err != nil {
		t.Fatal(err)
	}
	if len(observed.Coverage.ObservedAccounts) != 1 || observed.Coverage.ObservedAccounts[0] != "checking" {
		t.Errorf("coverage = %+v, want checking observed", observed.Coverage)
	}
}

func TestFlowGraphRejectsBadWindow(t *testing.T) {
	model := flowTestModel()
	if _, err := BuildFlowGraph(model, nil, nil, "2026-13-01", "2026-12-31"); err == nil {
		t.Error("bad start date accepted")
	}
	if _, err := BuildFlowGraph(model, nil, nil, "2026-12-31", "2026-01-01"); err == nil {
		t.Error("inverted window accepted")
	}
}

// settledHistoryTestModel mirrors the bank history that caught the empty
// graph live: hundreds of settled rows across seven months, every one of
// them dated before the projection start, so the projection emits no
// transaction events at all and only the settled replay can draw actual
// edges. Amounts are literal bank magnitudes; directions follow the
// source/destination route.
func settledHistoryTestModel() *types.FinancialModel {
	checking := "checking"
	savings := "savings"
	model := &types.FinancialModel{
		Accounts: []types.Account{
			{ID: "checking", Name: "Checking", Kind: types.AccountKindCash, Enabled: true},
			{ID: "savings", Name: "Savings", Kind: types.AccountKindCash, Enabled: true},
		},
	}
	stamp := func(year int, month time.Month, day int) int64 {
		return time.Date(year, month, day, 12, 0, 0, 0, time.UTC).Unix()
	}
	for month := 0; month < 7; month++ {
		current := time.Month(6 + month)
		at := stamp(2025, current, 15)
		model.Postings = append(model.Postings, types.Posting{
			ID:              fmt.Sprintf("salary-2025-%02d", 6+month),
			Name:            "Salary",
			Destinations:    []string{"checking"},
			Amount:          flowTestAmount("3000"),
			PostedTime:      at,
			TransactionTime: at,
			Enabled:         true,
			Source:          "simplefin",
		})
		for i := 0; i < 80; i++ {
			day := stamp(2025, current, (i%28)+1)
			model.Postings = append(model.Postings, types.Posting{
				ID:              fmt.Sprintf("grocery-2025-%02d-%03d", 6+month, i),
				Name:            "Groceries",
				SourceAccountID: &checking,
				Amount:          flowTestAmount("50"),
				PostedTime:      day,
				TransactionTime: day,
				Enabled:         true,
				Source:          "simplefin",
			})
		}
	}
	moveAt := stamp(2025, time.September, 10)
	model.Postings = append(model.Postings, types.Posting{
		ID:              "save-september",
		Name:            "Move to savings",
		SourceAccountID: &checking,
		Destinations:    []string{savings},
		Amount:          flowTestAmount("500"),
		PostedTime:      moveAt,
		TransactionTime: moveAt,
		Enabled:         true,
		Source:          "simplefin",
	})
	// Rows that must never draw edges: a void authorization, an
	// owner-disabled row, a zero amount, each dated inside the window. An
	// enabled pending row counts like a posted one.
	edgeCases := []types.Posting{
		{
			ID: "void-hold", Name: "Voided hold", SourceAccountID: &checking,
			Amount: flowTestAmount("90"), PostedTime: moveAt, TransactionTime: moveAt,
			Enabled: true, Source: "simplefin", Void: true,
		},
		{
			ID: "disabled-groceries", Name: "Disabled", SourceAccountID: &checking,
			Amount: flowTestAmount("80"), PostedTime: moveAt, TransactionTime: moveAt,
			Enabled: false, Source: "simplefin",
		},
		{
			ID: "zero-fee", Name: "Zero", SourceAccountID: &checking,
			Amount: flowTestAmount("0"), PostedTime: moveAt, TransactionTime: moveAt,
			Enabled: true, Source: "simplefin",
		},
		{
			ID: "pending-fuel", Name: "Pending fuel", SourceAccountID: &checking,
			Amount: flowTestAmount("70"), PostedTime: moveAt, TransactionTime: moveAt,
			Enabled: true, Source: "simplefin", Pending: true,
		},
	}
	model.Postings = append(model.Postings, edgeCases...)
	return model
}

// Hundreds of settled postings across months must yield nonzero actuals
// even though the projection emits no events for them: they all predate
// its start. The transfer appears once with its full amount and stays out
// of inflow and outflow.
func TestFlowGraphSettledHistoryYieldsActuals(t *testing.T) {
	model := settledHistoryTestModel()
	settings := &types.ProjectionRuntimeSettings{
		FallbackProjectionStartDate: "2026-01-01",
		HorizonYears:                1,
	}
	path, result, err := ProjectRawFinancialModel(model, settings, types.EmptyModelOverrides(), nil)
	if err != nil {
		t.Fatalf("project: %v", err)
	}
	if len(result.TransactionEvents) != 0 {
		t.Fatalf("events = %d, want none: every posting predates the projection start", len(result.TransactionEvents))
	}
	graph, err := BuildFlowGraph(&path.EffectiveModel, result.TransactionEvents, result.Timeline.Rows, "2025-06-01", "2025-12-31")
	if err != nil {
		t.Fatalf("build flow graph: %v", err)
	}

	const wantInflow = 7 * 3000
	const wantOutflow = 7*80*50 + 70
	const wantTransfer = 500
	if graph.Totals.Actual.Inflow != wantInflow {
		t.Errorf("actual inflow = %v, want %v", graph.Totals.Actual.Inflow, wantInflow)
	}
	if graph.Totals.Actual.Outflow != wantOutflow {
		t.Errorf("actual outflow = %v, want %v", graph.Totals.Actual.Outflow, wantOutflow)
	}
	if graph.Totals.Actual.Transfer != wantTransfer {
		t.Errorf("actual transfer = %v, want %v", graph.Totals.Actual.Transfer, wantTransfer)
	}
	if graph.Totals.Projected.Inflow != 0 || graph.Totals.Projected.Outflow != 0 || graph.Totals.Projected.Transfer != 0 {
		t.Errorf("projected totals = %+v, want all zero", graph.Totals.Projected)
	}

	inflow := findFlowEdge(t, graph, types.FlowNodeIDExternal, "checking", types.FlowKindInflow, types.FlowMovementActual)
	if inflow.Amount != wantInflow || len(inflow.Sources) != 7 {
		t.Errorf("actual inflow edge = %v over %d sources, want %v over 7", inflow.Amount, len(inflow.Sources), wantInflow)
	}
	outflow := findFlowEdge(t, graph, "checking", types.FlowNodeIDExternal, types.FlowKindOutflow, types.FlowMovementActual)
	if outflow.Amount != wantOutflow || len(outflow.Sources) != 7*80+1 {
		t.Errorf("actual outflow edge = %v over %d sources, want %v over %d", outflow.Amount, len(outflow.Sources), wantOutflow, 7*80+1)
	}
	transfers := 0
	for _, edge := range graph.Edges {
		if edge.Kind != types.FlowKindTransfer {
			continue
		}
		transfers++
		if edge.Amount != wantTransfer || edge.Movement != types.FlowMovementActual {
			t.Errorf("transfer edge = %+v, want the 500 posting counted once as actual", edge)
		}
		if len(edge.Sources) != 1 || edge.Sources[0].PostingID != "save-september" {
			t.Errorf("transfer sources = %+v, want the single savings posting", edge.Sources)
		}
	}
	if transfers != 1 {
		t.Errorf("transfer edges = %d, want exactly one", transfers)
	}
	// The transfer stays out of inflow and outflow: edge sums per kind
	// match the class totals exactly.
	summed := map[string]float64{}
	for _, edge := range graph.Edges {
		summed[edge.Kind] += edge.Amount
	}
	if summed[types.FlowKindInflow] != wantInflow || summed[types.FlowKindOutflow] != wantOutflow || summed[types.FlowKindTransfer] != wantTransfer {
		t.Errorf("edge sums = %+v, want inflow %v outflow %v transfer %v", summed, wantInflow, wantOutflow, wantTransfer)
	}

	// Void, disabled, and zero rows never reach an edge; the pending row
	// counts exactly once alongside the posted rows.
	seen := map[string]int{}
	for _, edge := range graph.Edges {
		for _, source := range edge.Sources {
			if source.Date < graph.StartDate || source.Date > graph.EndDate {
				t.Errorf("edge source %+v outside window", source)
			}
			seen[source.PostingID]++
		}
	}
	for _, id := range []string{"void-hold", "disabled-groceries", "zero-fee"} {
		if seen[id] != 0 {
			t.Errorf("posting %s appears in %d edge sources, want none", id, seen[id])
		}
	}
	if seen["pending-fuel"] != 1 {
		t.Errorf("pending posting appears in %d edge sources, want exactly once", seen["pending-fuel"])
	}

	// Nodes describe the same money as the edges, and the reconciliation
	// against source records agrees.
	var nodeIn, nodeOut float64
	for _, node := range graph.Nodes {
		nodeIn += node.Inflow
		nodeOut += node.Outflow
	}
	edgeAll := float64(wantInflow + wantOutflow + wantTransfer)
	if nodeIn != edgeAll || nodeOut != edgeAll {
		t.Errorf("nodes in=%.0f out=%.0f, want both %.0f", nodeIn, nodeOut, edgeAll)
	}
	if !graph.Reconciliation.Reconciled {
		t.Errorf("reconciliation = %+v, want reconciled", graph.Reconciliation)
	}
	const wantMovements = 7 + 7*80 + 1 + 1
	if graph.Reconciliation.WindowEvents != wantMovements || graph.Reconciliation.ClassifiedEvents != wantMovements {
		t.Errorf("reconciliation = %+v, want %d window and classified movements", graph.Reconciliation, wantMovements)
	}
}

// A window with no settled rows stays empty: no edges, zero totals, and a
// reconciliation that still agrees.
func TestFlowGraphWindowWithoutSettledRowsStaysEmpty(t *testing.T) {
	model := settledHistoryTestModel()
	settings := &types.ProjectionRuntimeSettings{
		FallbackProjectionStartDate: "2026-01-01",
		HorizonYears:                1,
	}
	path, result, err := ProjectRawFinancialModel(model, settings, types.EmptyModelOverrides(), nil)
	if err != nil {
		t.Fatalf("project: %v", err)
	}
	graph, err := BuildFlowGraph(&path.EffectiveModel, result.TransactionEvents, result.Timeline.Rows, "2030-01-01", "2030-12-31")
	if err != nil {
		t.Fatalf("build flow graph: %v", err)
	}
	if len(graph.Edges) != 0 {
		t.Errorf("edges = %+v, want none", graph.Edges)
	}
	if graph.Totals.Actual.Inflow != 0 || graph.Totals.Actual.Outflow != 0 || graph.Totals.Actual.Transfer != 0 {
		t.Errorf("actual totals = %+v, want all zero", graph.Totals.Actual)
	}
	if !graph.Reconciliation.Reconciled {
		t.Errorf("reconciliation = %+v, want reconciled", graph.Reconciliation)
	}
	if graph.Reconciliation.WindowEvents != 0 || graph.Reconciliation.ClassifiedEvents != 0 {
		t.Errorf("reconciliation = %+v, want no movements", graph.Reconciliation)
	}
}
