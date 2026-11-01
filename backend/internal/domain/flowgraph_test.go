package domain

import (
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
