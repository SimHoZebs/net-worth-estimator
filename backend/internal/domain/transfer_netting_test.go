package domain

import (
	"testing"
	"time"

	"github.com/simhozebs/net-worth-estimator/backend/internal/types"
)

func transferNetStamp(month time.Month, day int) int64 {
	return time.Date(2026, month, day, 12, 0, 0, 0, time.UTC).Unix()
}

// transferNetFixture mirrors one loan payment observed as two bank legs: a
// checking outflow plus a loan inflow, both settled and single-sided.
func transferNetFixture(payRealized, receiveRealized float64) (*types.FinancialModel, []types.TransactionEvent) {
	checking := "checking"
	model := &types.FinancialModel{
		Accounts: []types.Account{
			{ID: "checking", Name: "Checking", Kind: types.AccountKindCash, Enabled: true},
			{ID: "loan", Name: "Loan", Kind: types.AccountKindCash, Enabled: true},
		},
		Transactions: []types.Transaction{
			{
				ID: "pay", Name: "Card payment", SourceAccountID: &checking,
				Amount: flowTestAmount("500"), PostedTime: transferNetStamp(time.March, 10),
				TransactionTime: transferNetStamp(time.March, 10), Enabled: true, Source: "banksync",
			},
			{
				ID: "receive", Name: "Payment received", Destinations: []string{"loan"},
				Amount: flowTestAmount("500"), PostedTime: transferNetStamp(time.March, 12),
				TransactionTime: transferNetStamp(time.March, 12), Enabled: true, Source: "banksync",
			},
		},
	}
	events := []types.TransactionEvent{
		{
			Date: "2026-03-10", Sequence: 0,
			Origin:          types.TransactionOrigin{Type: "transaction", TransactionID: "pay"},
			RequestedAmount: 500, RealizedAmount: payRealized,
		},
		{
			Date: "2026-03-12", Sequence: 1,
			Origin:          types.TransactionOrigin{Type: "transaction", TransactionID: "receive"},
			RequestedAmount: 500, RealizedAmount: receiveRealized,
		},
	}
	return model, events
}

// A confirmed pair renders count-once: the outflow plus inflow collapse
// into one checking-to-loan transfer edge carrying both sources, and the
// class totals move with it so reconciliation still agrees.
func TestFlowGraphConfirmedPairNetsCountOnce(t *testing.T) {
	model, events := transferNetFixture(500, 500)
	plain, err := BuildFlowGraph(model, events, nil, "2026-03-01", "2026-03-31")
	if err != nil {
		t.Fatalf("build flow graph: %v", err)
	}
	outflow := findFlowEdge(t, plain, "checking", types.FlowNodeIDExternal, types.FlowKindOutflow, types.FlowMovementActual)
	if outflow.Amount != 500 || len(outflow.Sources) != 1 || outflow.Sources[0].TransactionID != "pay" {
		t.Fatalf("outflow edge = %+v, want the 500 checking leg", outflow)
	}
	inflow := findFlowEdge(t, plain, types.FlowNodeIDExternal, "loan", types.FlowKindInflow, types.FlowMovementActual)
	if inflow.Amount != 500 || len(inflow.Sources) != 1 || inflow.Sources[0].TransactionID != "receive" {
		t.Fatalf("inflow edge = %+v, want the 500 loan leg", inflow)
	}
	if plain.Totals.Actual.Outflow != 500 || plain.Totals.Actual.Inflow != 500 || plain.Totals.Actual.Transfer != 0 {
		t.Fatalf("actual totals = %+v, want outflow 500 inflow 500 transfer 0", plain.Totals.Actual)
	}

	linked, err := BuildFlowGraphWithLinks(model, events, nil, "2026-03-01", "2026-03-31", []TransferLinkPair{{A: "pay", B: "receive"}})
	if err != nil {
		t.Fatalf("build linked flow graph: %v", err)
	}
	if len(linked.Edges) != 1 {
		t.Fatalf("edges = %+v, want exactly one transfer edge", linked.Edges)
	}
	transfer := findFlowEdge(t, linked, "checking", "loan", types.FlowKindTransfer, types.FlowMovementActual)
	if transfer.Amount != 500 {
		t.Fatalf("transfer edge = %+v, want amount 500 counted once", transfer)
	}
	if len(transfer.Sources) != 2 || transfer.Sources[0].TransactionID != "pay" || transfer.Sources[1].TransactionID != "receive" {
		t.Fatalf("transfer sources = %+v, want both legs date-sorted", transfer.Sources)
	}
	for _, edge := range linked.Edges {
		if edge.Kind != types.FlowKindTransfer {
			t.Fatalf("stale edge after netting: %+v", edge)
		}
	}
	if linked.Totals.Actual.Outflow != 0 || linked.Totals.Actual.Inflow != 0 || linked.Totals.Actual.Transfer != 500 {
		t.Fatalf("actual totals = %+v, want transfer 500 only", linked.Totals.Actual)
	}
	for _, node := range linked.Nodes {
		switch node.ID {
		case "checking":
			if node.Outflow != 500 || node.Inflow != 0 {
				t.Fatalf("checking node = %+v, want outflow 500", node)
			}
		case "loan":
			if node.Inflow != 500 || node.Outflow != 0 {
				t.Fatalf("loan node = %+v, want inflow 500", node)
			}
		case types.FlowNodeIDExternal:
			if node.Inflow != 0 || node.Outflow != 0 {
				t.Fatalf("external node = %+v, want no flow after netting", node)
			}
		}
	}
	if !linked.Reconciliation.Reconciled {
		t.Fatalf("reconciliation = %+v, want reconciled", linked.Reconciliation)
	}
}

// Unlinking restores the two single-sided edges with their own totals.
func TestFlowGraphUnlinkRestoresTwoEdges(t *testing.T) {
	model, events := transferNetFixture(500, 500)
	plain, err := BuildFlowGraph(model, events, nil, "2026-03-01", "2026-03-31")
	if err != nil {
		t.Fatal(err)
	}
	unlinked, err := BuildFlowGraphWithLinks(model, events, nil, "2026-03-01", "2026-03-31", nil)
	if err != nil {
		t.Fatal(err)
	}
	if len(plain.Edges) != 2 || len(unlinked.Edges) != 2 {
		t.Fatalf("edges = %d vs %d, want two single-sided edges", len(plain.Edges), len(unlinked.Edges))
	}
	if plain.Totals != unlinked.Totals {
		t.Fatalf("totals = %+v vs %+v, want identical", plain.Totals, unlinked.Totals)
	}
	if !unlinked.Reconciliation.Reconciled {
		t.Fatalf("reconciliation = %+v, want reconciled", unlinked.Reconciliation)
	}
}

// Netting is defensive: any pair that is not an in-window external
// outflow plus external inflow with equal absolute realized amounts stays
// on its own edges, so money is never dropped.
func TestFlowGraphPairNettingIsDefensive(t *testing.T) {
	t.Run("amount mismatch stays split", func(t *testing.T) {
		model, events := transferNetFixture(500, 400)
		linked, err := BuildFlowGraphWithLinks(model, events, nil, "2026-03-01", "2026-03-31", []TransferLinkPair{{A: "pay", B: "receive"}})
		if err != nil {
			t.Fatal(err)
		}
		findFlowEdge(t, linked, "checking", types.FlowNodeIDExternal, types.FlowKindOutflow, types.FlowMovementActual)
		findFlowEdge(t, linked, types.FlowNodeIDExternal, "loan", types.FlowKindInflow, types.FlowMovementActual)
		if linked.Totals.Actual.Transfer != 0 {
			t.Fatalf("totals = %+v, want no transfer", linked.Totals.Actual)
		}
		if !linked.Reconciliation.Reconciled {
			t.Fatalf("reconciliation = %+v, want reconciled", linked.Reconciliation)
		}
	})
	t.Run("unknown leg stays split", func(t *testing.T) {
		model, events := transferNetFixture(500, 500)
		linked, err := BuildFlowGraphWithLinks(model, events, nil, "2026-03-01", "2026-03-31", []TransferLinkPair{{A: "pay", B: "missing"}})
		if err != nil {
			t.Fatal(err)
		}
		if len(linked.Edges) != 2 {
			t.Fatalf("edges = %+v, want both legs untouched", linked.Edges)
		}
	})
	t.Run("same route pair stays split", func(t *testing.T) {
		model, events := transferNetFixture(500, 500)
		outflowAccount := "checking"
		model.Transactions = append(model.Transactions, types.Transaction{
			ID: "second-pay", Name: "Second payment", SourceAccountID: &outflowAccount,
			Amount: flowTestAmount("500"), PostedTime: transferNetStamp(time.March, 11),
			TransactionTime: transferNetStamp(time.March, 11), Enabled: true, Source: "banksync",
		})
		events = append(events, types.TransactionEvent{
			Date: "2026-03-11", Sequence: 2,
			Origin:          types.TransactionOrigin{Type: "transaction", TransactionID: "second-pay"},
			RequestedAmount: 500, RealizedAmount: 500,
		})
		linked, err := BuildFlowGraphWithLinks(model, events, nil, "2026-03-01", "2026-03-31", []TransferLinkPair{{A: "pay", B: "second-pay"}})
		if err != nil {
			t.Fatal(err)
		}
		for _, edge := range linked.Edges {
			if edge.Kind == types.FlowKindTransfer {
				t.Fatalf("same-route pair netted: %+v", edge)
			}
		}
		if !linked.Reconciliation.Reconciled {
			t.Fatalf("reconciliation = %+v, want reconciled", linked.Reconciliation)
		}
	})
}

// The projection path classifies linked actuals the same way flows renders
// them: two legs that settle the same date net from inflow plus outflow
// into one transfer total. Legs on different dates stay split in their own
// rows; only the window-aggregated flow graph nets across days.
func TestProjectionPathConfirmedPairNetsTotals(t *testing.T) {
	model, events := transferNetFixture(500, 500)
	byID := map[string]*types.Transaction{}
	for i := range model.Transactions {
		byID[model.Transactions[i].ID] = &model.Transactions[i]
	}
	sameDay := []*types.TransactionEvent{&events[0], &events[1]}
	sameDay[1].Date = "2026-03-10"
	plain := classifyAttempts(sameDay, byID, nil)
	if plain.externalOutflowAmount != 500 || plain.externalInflowAmount != 500 || plain.internalTransferAmount != 0 {
		t.Fatalf("plain = %+v, want outflow 500 inflow 500", plain)
	}
	linked := classifyAttempts(sameDay, byID, []TransferLinkPair{{A: "pay", B: "receive"}})
	if linked.externalOutflowAmount != 0 || linked.externalInflowAmount != 0 || linked.internalTransferAmount != 500 {
		t.Fatalf("linked = %+v, want transfer 500 only", linked)
	}
	for _, day := range [][]*types.TransactionEvent{{&events[0]}, {&events[1]}} {
		bucket := classifyAttempts(day, byID, []TransferLinkPair{{A: "pay", B: "receive"}})
		if bucket.internalTransferAmount != 0 {
			t.Fatalf("cross-day bucket netted: %+v", bucket)
		}
	}
}
