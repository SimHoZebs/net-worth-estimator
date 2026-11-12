package domain

import (
	"fmt"
	"math"
	"sort"

	"github.com/simhozebs/net-worth-estimator/backend/internal/types"
)

// Time-bounded financial flow graph (VIS-01): pure aggregation over dated events.

// flowEdgeKey groups one directed movement class.
type flowEdgeKey struct {
	from     string
	to       string
	kind     string
	movement string
}

// settledHistoryEvents replays in-window settled transactions as actual movements.
// The projection emits no events for settled history, so each becomes one synthetic event.
// Only manual transactions synthesize; rule templates stay event-driven.
func settledHistoryEvents(model *types.FinancialModel, transactions []types.Transaction, ruleIDs map[string]bool, events []types.TransactionEvent, rows []types.ProjectionRow, startDate, endDate string) []types.TransactionEvent {
	covered := make(map[string]bool, len(events))
	nextSequence := 0
	for _, event := range events {
		covered[event.Origin.TransactionID+"\x00"+string(event.Date)] = true
		if event.Sequence >= nextSequence {
			nextSequence = event.Sequence + 1
		}
	}
	balancesByDate := map[string]map[string]float64{}
	for _, row := range rows {
		day := string(row.Date)
		if CompareIsoDates(day, startDate) < 0 || CompareIsoDates(day, endDate) > 0 {
			continue
		}
		if _, ok := balancesByDate[day]; ok {
			continue
		}
		balances := make(map[string]float64, len(row.AccountSnapshots))
		for _, snapshot := range row.AccountSnapshots {
			balances[snapshot.AccountID] = snapshot.Balance
		}
		balancesByDate[day] = balances
	}
	terms := PaymentTermsByAccount(model)
	synthesized := []types.TransactionEvent{}
	for index := range transactions {
		transaction := &transactions[index]
		if ruleIDs[transaction.ID] {
			continue
		}
		if !transaction.Enabled || transaction.Void {
			continue
		}
		day := transactionDay(transaction)
		if day == "" || CompareIsoDates(day, startDate) < 0 || CompareIsoDates(day, endDate) > 0 {
			continue
		}
		if covered[transaction.ID+"\x00"+day] {
			continue
		}
		amount, err := ComputeRequestedAmount(
			DatedTransactionOccurrence{Transaction: transaction, Index: index},
			day, map[string]float64{}, map[string]string{}, map[string]map[string]float64{},
			balancesByDate[day], terms, nil,
		)
		if err != nil || math.IsNaN(amount) || math.IsInf(amount, 0) {
			continue
		}
		realized := roundCurrency(amount)
		if realized == 0 {
			continue
		}
		synthesized = append(synthesized, types.TransactionEvent{
			Date:            types.IsoDate(day),
			Sequence:        nextSequence,
			Origin:          types.TransactionOrigin{Type: "transaction", TransactionID: transaction.ID},
			RequestedAmount: realized,
			RealizedAmount:  realized,
		})
		nextSequence++
	}
	return synthesized
}

// BuildFlowGraph aggregates windowed events into directed edges.
func BuildFlowGraph(model *types.FinancialModel, events []types.TransactionEvent, rows []types.ProjectionRow, startDate, endDate string) (*types.FlowGraph, error) {
	return BuildFlowGraphWithLinks(model, events, rows, startDate, endDate, nil)
}

// TransferLinkPair names two transaction IDs the user confirmed as one
// internal movement. Netting renders a confirmed pair count-once: the two
// single-sided legs collapse into one transfer edge.
type TransferLinkPair struct {
	A string
	B string
}

// TransferLinkPairs converts stored links into netting pairs.
func TransferLinkPairs(links []types.TransferLink) []TransferLinkPair {
	pairs := make([]TransferLinkPair, 0, len(links))
	for _, link := range links {
		pairs = append(pairs, TransferLinkPair{A: link.LegA, B: link.LegB})
	}
	return pairs
}

// BuildFlowGraphWithLinks aggregates windowed events into directed edges,
// collapsing confirmed transfer pairs that both classify as external and
// opposite into single transfer edges. A nil link set renders every leg on
// its own route. A pair nets only when both legs fall in-window as an
// external outflow plus an external inflow with equal absolute realized
// amounts; anything else stays on its own edges so money is never dropped.
func BuildFlowGraphWithLinks(model *types.FinancialModel, events []types.TransactionEvent, rows []types.ProjectionRow, startDate, endDate string, links []TransferLinkPair) (*types.FlowGraph, error) {
	if !IsValidIsoDate(startDate) || !IsValidIsoDate(endDate) {
		return nil, fmt.Errorf("flow window dates must be YYYY-MM-DD")
	}
	if CompareIsoDates(startDate, endDate) > 0 {
		return nil, fmt.Errorf("flow window startDate must not be after endDate")
	}

	transactions := ResolvedTransactionTransactions(model)
	transactionByID := make(map[string]*types.Transaction, len(transactions))
	for index := range transactions {
		transactionByID[transactions[index].ID] = &transactions[index]
	}
	ruleIDs := make(map[string]bool, len(model.Schedules))
	for index := range model.Schedules {
		ruleIDs[model.Schedules[index].ID] = true
	}

	graph := &types.FlowGraph{StartDate: startDate, EndDate: endDate}
	nodes := map[string]*types.FlowNode{}
	node := func(id, name string, external, enabled bool) *types.FlowNode {
		existing, ok := nodes[id]
		if !ok {
			existing = &types.FlowNode{ID: id, Name: name, External: external, Enabled: enabled}
			nodes[id] = existing
		}
		return existing
	}
	for _, account := range model.Accounts {
		node(account.ID, account.Name, false, account.Enabled)
	}
	node(types.FlowNodeIDExternal, "External", true, true)

	edges := map[flowEdgeKey]*types.FlowEdge{}
	edge := func(from, to, kind, movement string) *types.FlowEdge {
		key := flowEdgeKey{from: from, to: to, kind: kind, movement: movement}
		existing, ok := edges[key]
		if !ok {
			existing = &types.FlowEdge{From: from, To: to, Kind: kind, Movement: movement, Sources: []types.FlowSourceRecord{}}
			edges[key] = existing
		}
		return existing
	}
	addFlow := func(fromID, toID string, amount float64, kind, movement string, record types.FlowSourceRecord) {
		if amount == 0 {
			return
		}
		target := edge(fromID, toID, kind, movement)
		target.Amount = roundCurrency(target.Amount + amount)
		target.Sources = append(target.Sources, record)
		fromNode, ok := nodes[fromID]
		if !ok {
			fromNode = node(fromID, fromID, fromID == types.FlowNodeIDExternal, true)
		}
		toNode, ok := nodes[toID]
		if !ok {
			toNode = node(toID, toID, toID == types.FlowNodeIDExternal, true)
		}
		if amount > 0 {
			fromNode.Outflow = roundCurrency(fromNode.Outflow + amount)
			toNode.Inflow = roundCurrency(toNode.Inflow + amount)
		} else {
			// Negative flows keep their route instead of flipping direction.
			fromNode.Inflow = roundCurrency(fromNode.Inflow - amount)
			toNode.Outflow = roundCurrency(toNode.Outflow - amount)
		}
	}

	reconciliation := types.FlowReconciliation{}
	totals := types.FlowTotals{}
	// Settled history replays through the same classification below, so
	// window totals, edges, and reconciliation agree by construction. The
	// copy keeps the caller's slices untouched.
	movements := make([]types.TransactionEvent, 0, len(events))
	movements = append(movements, events...)
	movements = append(movements, settledHistoryEvents(model, transactions, ruleIDs, events, rows, startDate, endDate)...)
	for _, event := range movements {
		if CompareIsoDates(string(event.Date), startDate) < 0 || CompareIsoDates(string(event.Date), endDate) > 0 {
			continue
		}
		reconciliation.WindowEvents++
		transaction, ok := transactionByID[event.Origin.TransactionID]
		if !ok {
			reconciliation.UnmatchedEvents++
			realized := roundCurrency(event.RealizedAmount)
			totals.Unmatched = roundCurrency(totals.Unmatched + realized)
			graph.Unmatched = append(graph.Unmatched, types.FlowUnmatchedEvent{
				TransactionID:  event.Origin.TransactionID,
				Date:           event.Date,
				Sequence:       event.Sequence,
				RealizedAmount: realized,
			})
			continue
		}
		reconciliation.ClassifiedEvents++
		movement := types.FlowMovementActual
		if ruleIDs[event.Origin.TransactionID] {
			movement = types.FlowMovementProjected
		}
		realized := roundCurrency(event.RealizedAmount)
		requested := roundCurrency(event.RequestedAmount)
		record := types.FlowSourceRecord{
			TransactionID:   event.Origin.TransactionID,
			Date:            event.Date,
			Sequence:        event.Sequence,
			RequestedAmount: requested,
			RealizedAmount:  realized,
		}
		classTotals := &totals.Actual
		if movement == types.FlowMovementProjected {
			classTotals = &totals.Projected
		}
		switch {
		case IsExternalInflow(transaction):
			reconciliation.EventsInflow = roundCurrency(reconciliation.EventsInflow + realized)
			classTotals.Inflow = roundCurrency(classTotals.Inflow + realized)
			for _, delta := range event.AccountDeltas {
				share := roundCurrency(delta.Delta)
				addFlow(types.FlowNodeIDExternal, delta.AccountID, share, types.FlowKindInflow, movement, record)
			}
			if len(event.AccountDeltas) == 0 && realized != 0 && len(transaction.Destinations) > 0 {
				addFlow(types.FlowNodeIDExternal, transaction.Destinations[0], realized, types.FlowKindInflow, movement, record)
			}
		case IsExternalOutflow(transaction):
			reconciliation.EventsOutflow = roundCurrency(reconciliation.EventsOutflow + realized)
			classTotals.Outflow = roundCurrency(classTotals.Outflow + realized)
			source, _ := TransactionSourceAccount(transaction)
			addFlow(source, types.FlowNodeIDExternal, realized, types.FlowKindOutflow, movement, record)
		case IsInternalTransfer(transaction):
			reconciliation.EventsTransfer = roundCurrency(reconciliation.EventsTransfer + realized)
			classTotals.Transfer = roundCurrency(classTotals.Transfer + realized)
			source, _ := TransactionSourceAccount(transaction)
			for _, delta := range event.AccountDeltas {
				if delta.Delta <= 0 {
					continue
				}
				share := roundCurrency(delta.Delta)
				addFlow(source, delta.AccountID, share, types.FlowKindTransfer, movement, record)
			}
			if len(event.AccountDeltas) == 0 && realized != 0 {
				for _, destID := range transaction.Destinations {
					addFlow(source, destID, realized, types.FlowKindTransfer, movement, record)
					break
				}
			}
		default:
			// A transaction with neither source nor destinations moves no money.
			reconciliation.UnmatchedEvents++
			totals.Unmatched = roundCurrency(totals.Unmatched + realized)
			graph.Unmatched = append(graph.Unmatched, types.FlowUnmatchedEvent{
				TransactionID:  event.Origin.TransactionID,
				Date:           event.Date,
				Sequence:       event.Sequence,
				RealizedAmount: realized,
			})
		}
	}

	netConfirmedTransferPairs(transactionByID, edges, nodes, &totals, &reconciliation, links)

	for _, row := range rows {
		if CompareIsoDates(string(row.Date), startDate) < 0 || CompareIsoDates(string(row.Date), endDate) > 0 {
			continue
		}
		for _, correction := range row.CheckpointCorrections {
			reconciliation.CorrectionsCount++
			adjustment := roundCurrency(correction.Adjustment)
			totals.Unobserved = roundCurrency(totals.Unobserved + adjustment)
			graph.Unobserved = append(graph.Unobserved, types.FlowUnobservedCorrection{
				AccountID:       correction.AccountID,
				Date:            row.Date,
				ObservedBalance: roundCurrency(correction.ObservedBalance),
				ModeledBalance:  roundCurrency(correction.ModeledBalance),
				Adjustment:      adjustment,
			})
		}
	}
	reconciliation.UnobservedSum = totals.Unobserved

	graph.Totals = totals

	edgeList := make([]types.FlowEdge, 0, len(edges))
	summed := map[string]float64{}
	for _, target := range edges {
		sort.Slice(target.Sources, func(i, j int) bool {
			if target.Sources[i].Date != target.Sources[j].Date {
				return target.Sources[i].Date < target.Sources[j].Date
			}
			return target.Sources[i].Sequence < target.Sources[j].Sequence
		})
		edgeList = append(edgeList, *target)
		summed[target.Kind] = roundCurrency(summed[target.Kind] + target.Amount)
	}
	sort.Slice(edgeList, func(i, j int) bool {
		if edgeList[i].From != edgeList[j].From {
			return edgeList[i].From < edgeList[j].From
		}
		if edgeList[i].To != edgeList[j].To {
			return edgeList[i].To < edgeList[j].To
		}
		if edgeList[i].Kind != edgeList[j].Kind {
			return edgeList[i].Kind < edgeList[j].Kind
		}
		return edgeList[i].Movement < edgeList[j].Movement
	})
	graph.Edges = edgeList

	nodeList := make([]types.FlowNode, 0, len(nodes))
	for _, item := range nodes {
		nodeList = append(nodeList, *item)
	}
	sort.Slice(nodeList, func(i, j int) bool { return nodeList[i].ID < nodeList[j].ID })
	graph.Nodes = nodeList

	sort.Slice(graph.Unmatched, func(i, j int) bool {
		if graph.Unmatched[i].Date != graph.Unmatched[j].Date {
			return graph.Unmatched[i].Date < graph.Unmatched[j].Date
		}
		return graph.Unmatched[i].Sequence < graph.Unmatched[j].Sequence
	})
	if graph.Unmatched == nil {
		graph.Unmatched = []types.FlowUnmatchedEvent{}
	}
	sort.Slice(graph.Unobserved, func(i, j int) bool {
		if graph.Unobserved[i].Date != graph.Unobserved[j].Date {
			return graph.Unobserved[i].Date < graph.Unobserved[j].Date
		}
		return graph.Unobserved[i].AccountID < graph.Unobserved[j].AccountID
	})
	if graph.Unobserved == nil {
		graph.Unobserved = []types.FlowUnobservedCorrection{}
	}

	// Coverage: an enabled account is observed when a checkpoint exists at or before window end.
	windowEndInstant := dayCloseUnix(endDate)
	observedByAccount := map[string]bool{}
	for _, checkpoint := range model.Checkpoints {
		if checkpoint.ObservedAt <= windowEndInstant {
			observedByAccount[checkpoint.AccountID] = true
		}
	}
	coverage := types.FlowCoverage{ObservedAccounts: []string{}, UnobservedAccounts: []string{}}
	for _, account := range model.Accounts {
		if !account.Enabled {
			continue
		}
		if observedByAccount[account.ID] {
			coverage.ObservedAccounts = append(coverage.ObservedAccounts, account.ID)
		} else {
			coverage.UnobservedAccounts = append(coverage.UnobservedAccounts, account.ID)
		}
	}
	sort.Strings(coverage.ObservedAccounts)
	sort.Strings(coverage.UnobservedAccounts)
	graph.Coverage = coverage

	reconciliation.EdgesInflow = roundCurrency(totals.Actual.Inflow + totals.Projected.Inflow)
	reconciliation.EdgesOutflow = roundCurrency(totals.Actual.Outflow + totals.Projected.Outflow)
	reconciliation.EdgesTransfer = roundCurrency(totals.Actual.Transfer + totals.Projected.Transfer)
	reconciliation.Reconciled = reconciliation.EventsInflow == summed[types.FlowKindInflow] &&
		reconciliation.EventsOutflow == summed[types.FlowKindOutflow] &&
		reconciliation.EventsTransfer == summed[types.FlowKindTransfer]
	graph.Reconciliation = reconciliation

	return graph, nil
}

// netConfirmedTransferPairs collapses confirmed pairs that both classify as
// external and opposite into single transfer edges. A pair nets only when
// both legs fall in-window as an external outflow plus an external inflow
// with equal absolute realized amounts; anything else stays on its own
// edges so money is never dropped. Event-side and edge-side sums move
// together, so reconciliation still agrees.
func netConfirmedTransferPairs(transactionByID map[string]*types.Transaction, edges map[flowEdgeKey]*types.FlowEdge, nodes map[string]*types.FlowNode, totals *types.FlowTotals, reconciliation *types.FlowReconciliation, links []TransferLinkPair) {
	for _, link := range links {
		first, ok := transactionByID[link.A]
		if !ok {
			continue
		}
		second, ok := transactionByID[link.B]
		if !ok {
			continue
		}
		outLeg, inLeg := first, second
		outID, inID := link.A, link.B
		if IsExternalInflow(first) && IsExternalOutflow(second) {
			outLeg, inLeg = second, first
			outID, inID = link.B, link.A
		} else if !IsExternalOutflow(first) || !IsExternalInflow(second) {
			continue
		}
		source, ok := TransactionSourceAccount(outLeg)
		if !ok || len(inLeg.Destinations) == 0 {
			continue
		}
		destination := inLeg.Destinations[0]
		for _, movement := range []string{types.FlowMovementActual, types.FlowMovementProjected} {
			outEdge, ok := edges[flowEdgeKey{from: source, to: types.FlowNodeIDExternal, kind: types.FlowKindOutflow, movement: movement}]
			if !ok {
				continue
			}
			inEdge, ok := edges[flowEdgeKey{from: types.FlowNodeIDExternal, to: destination, kind: types.FlowKindInflow, movement: movement}]
			if !ok {
				continue
			}
			outRecords, outSum := legRecords(outEdge, outID)
			inRecords, inSum := legRecords(inEdge, inID)
			if len(outRecords) == 0 || len(inRecords) == 0 {
				continue
			}
			if outSum <= 0 || outSum != inSum {
				continue
			}
			// The legs must live only on their expected edges: a legsplit
			// across routes stays untouched instead of partially netted.
			contained := true
			for key, other := range edges {
				if key.movement != movement || other == outEdge || other == inEdge {
					continue
				}
				if hasLegRecord(other, outID) || hasLegRecord(other, inID) {
					contained = false
					break
				}
			}
			if !contained {
				continue
			}
			amount := outSum
			removeLegRecords(outEdge, outID, nodes)
			removeLegRecords(inEdge, inID, nodes)
			if len(outEdge.Sources) == 0 {
				delete(edges, flowEdgeKey{from: source, to: types.FlowNodeIDExternal, kind: types.FlowKindOutflow, movement: movement})
			}
			if len(inEdge.Sources) == 0 {
				delete(edges, flowEdgeKey{from: types.FlowNodeIDExternal, to: destination, kind: types.FlowKindInflow, movement: movement})
			}
			transfer, ok := edges[flowEdgeKey{from: source, to: destination, kind: types.FlowKindTransfer, movement: movement}]
			if !ok {
				transfer = &types.FlowEdge{From: source, To: destination, Kind: types.FlowKindTransfer, Movement: movement, Sources: []types.FlowSourceRecord{}}
				edges[flowEdgeKey{from: source, to: destination, kind: types.FlowKindTransfer, movement: movement}] = transfer
			}
			transfer.Amount = roundCurrency(transfer.Amount + amount)
			transfer.Sources = append(transfer.Sources, outRecords...)
			transfer.Sources = append(transfer.Sources, inRecords...)
			if fromNode, ok := nodes[source]; ok {
				fromNode.Outflow = roundCurrency(fromNode.Outflow + amount)
			}
			if toNode, ok := nodes[destination]; ok {
				toNode.Inflow = roundCurrency(toNode.Inflow + amount)
			}
			classTotals := &totals.Actual
			if movement == types.FlowMovementProjected {
				classTotals = &totals.Projected
			}
			classTotals.Outflow = roundCurrency(classTotals.Outflow - amount)
			classTotals.Inflow = roundCurrency(classTotals.Inflow - amount)
			classTotals.Transfer = roundCurrency(classTotals.Transfer + amount)
			reconciliation.EventsOutflow = roundCurrency(reconciliation.EventsOutflow - amount)
			reconciliation.EventsInflow = roundCurrency(reconciliation.EventsInflow - amount)
			reconciliation.EventsTransfer = roundCurrency(reconciliation.EventsTransfer + amount)
		}
	}
}

// legRecords collects one leg's in-window records plus their realized sum.
func legRecords(edge *types.FlowEdge, transactionID string) ([]types.FlowSourceRecord, float64) {
	records := []types.FlowSourceRecord{}
	sum := 0.0
	for _, record := range edge.Sources {
		if record.TransactionID != transactionID {
			continue
		}
		records = append(records, record)
		sum = roundCurrency(sum + record.RealizedAmount)
	}
	return records, sum
}

func hasLegRecord(edge *types.FlowEdge, transactionID string) bool {
	for _, record := range edge.Sources {
		if record.TransactionID == transactionID {
			return true
		}
	}
	return false
}

// removeLegRecords drops one leg's records from an external edge and backs
// the realized amounts out of the edge and its nodes.
func removeLegRecords(edge *types.FlowEdge, transactionID string, nodes map[string]*types.FlowNode) {
	kept := edge.Sources[:0]
	for _, record := range edge.Sources {
		if record.TransactionID != transactionID {
			kept = append(kept, record)
			continue
		}
		amount := roundCurrency(record.RealizedAmount)
		edge.Amount = roundCurrency(edge.Amount - amount)
		if fromNode, ok := nodes[edge.From]; ok {
			fromNode.Outflow = roundCurrency(fromNode.Outflow - amount)
		}
		if toNode, ok := nodes[edge.To]; ok {
			toNode.Inflow = roundCurrency(toNode.Inflow - amount)
		}
	}
	edge.Sources = kept
}
