package domain

import (
	"fmt"
	"math"
	"sort"

	"github.com/simhozebs/net-worth-estimator/backend/internal/types"
)

// Time-bounded financial flow graph (VIS-01). Pure aggregation over dated
// transaction events plus balance-check corrections: no simulation, no
// transfer matching, no thresholds. Transfer matching stays with VIS-03;
// this builder counts structurally-declared transfers once from their
// transaction routes.

// flowEdgeKey groups one directed movement class.
type flowEdgeKey struct {
	from     string
	to       string
	kind     string
	movement string
}

// settledHistoryEvents replays in-window settled transactions as actual
// movements. The projection emits transaction events only for occurrences
// after its start date, so settled history would otherwise never reach
// the graph: the replay moves balances but records no events. Each
// settled transaction becomes one synthetic event carrying its resolved
// amount with no account deltas, so the classification below routes it
// through the same structural paths as event-driven actuals (external to
// first destination for inflows, source to external for outflows, source
// to first destination for transfers: one listing per transaction however
// many accounts it names).
//
// Membership mirrors execution: enabled rows only. An enabled pending row
// counts like a posted one; the Pending flag itself is never a filter.
// Void rows are excluded, deleted rows are absent from the model, and
// zero or unresolvable amounts are skipped. Transactions that already
// produced an in-window event (dated after the projection start) are
// skipped by (transaction, date) so they count exactly once. Rule templates
// in the resolved listing stay event-driven: only manual transactions
// synthesize.
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

// BuildFlowGraph aggregates in-window transaction events plus settled
// transactions replayed as actual movements (see settledHistoryEvents) into
// directed account/counterparty edges. events and rows must already be
// clipped to [startDate, endDate]; the builder trusts that clip and
// reports the window it was given. model is the effective model the
// events were simulated from: routes, account names, and checkpoints all
// come from it.
//
// Unmatched events (origin unknown to the model) leave the edge set and
// land in Unmatched. Corrections on the given rows land in Unobserved.
// Totals reconcile edge sums against event sums; Reconciled is false when
// any class disagrees, and the disagreement stays visible instead of
// being absorbed.
func BuildFlowGraph(model *types.FinancialModel, events []types.TransactionEvent, rows []types.ProjectionRow, startDate, endDate string) (*types.FlowGraph, error) {
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
			// Signed amounts keep their structural route: a negative flow
			// reduces both ends instead of flipping direction.
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
			// A transaction with neither source nor destinations moves no
			// money. Validation rejects it, so reaching here means the
			// model changed under the events: report, never absorb.
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

	// Coverage: an enabled account is observed when a checkpoint exists at
	// or before the window end. Anything else starts the window with
	// unobserved state, so its flow is partial.
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
