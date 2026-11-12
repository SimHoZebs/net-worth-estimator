package domain

import (
	"math"

	"github.com/simhozebs/net-worth-estimator/backend/internal/types"
)

// Path adaptation. Go is the owner.

func roundCurrency(value float64) float64 { return math.Round(value) }

func createRow(date string, isHistorical bool, balances map[string]float64, accounts []types.Account, accountImpacts map[string][]types.AccountDelta, externalInflowAmount, externalOutflowAmount, internalTransferAmount float64, checkpointCorrections []types.CheckpointCorrection) types.ProjectionRow {
	accountSnapshots := make([]types.AccountSnapshot, 0, len(accounts))
	for _, account := range accounts {
		snapshot := types.AccountSnapshot{
			AccountID: account.ID,
			Date:      date,
			Balance:   balances[account.ID],
			Impacts:   []types.AccountDelta{},
		}
		if impacts, ok := accountImpacts[account.ID]; ok && impacts != nil {
			snapshot.Impacts = impacts
		}
		accountSnapshots = append(accountSnapshots, snapshot)
	}
	row := types.ProjectionRow{
		Date:                   date,
		IsHistorical:           isHistorical,
		NetWorth:               ComputeNetWorth(balances, accounts),
		AccountSnapshots:       accountSnapshots,
		ExternalInflowAmount:   externalInflowAmount,
		ExternalOutflowAmount:  externalOutflowAmount,
		InternalTransferAmount: internalTransferAmount,
		CheckpointCorrections:  checkpointCorrections,
	}
	if row.CheckpointCorrections == nil {
		row.CheckpointCorrections = []types.CheckpointCorrection{}
	}
	return row
}

func roundRow(row types.ProjectionRow) types.ProjectionRow {
	row.NetWorth = roundCurrency(row.NetWorth)
	row.ExternalInflowAmount = roundCurrency(row.ExternalInflowAmount)
	row.ExternalOutflowAmount = roundCurrency(row.ExternalOutflowAmount)
	row.InternalTransferAmount = roundCurrency(row.InternalTransferAmount)
	for index := range row.AccountSnapshots {
		snapshot := &row.AccountSnapshots[index]
		snapshot.Balance = roundCurrency(snapshot.Balance)
		for impactIndex := range snapshot.Impacts {
			snapshot.Impacts[impactIndex].Delta = roundCurrency(snapshot.Impacts[impactIndex].Delta)
		}
	}
	if row.CheckpointCorrections != nil {
		for index := range row.CheckpointCorrections {
			correction := &row.CheckpointCorrections[index]
			correction.ObservedBalance = roundCurrency(correction.ObservedBalance)
			correction.ModeledBalance = roundCurrency(correction.ModeledBalance)
			correction.Adjustment = roundCurrency(correction.Adjustment)
		}
	}
	return row
}

type transactionAccountDelta = struct {
	AccountID string  `json:"accountId"`
	Delta     float64 `json:"delta"`
}

func cloneTransactionEvent(event types.TransactionEvent) types.TransactionEvent {
	cloned := event
	cloned.RequestedAmount = roundCurrency(event.RequestedAmount)
	cloned.RealizedAmount = roundCurrency(event.RealizedAmount)
	if event.AccountDeltas != nil {
		cloned.AccountDeltas = make([]transactionAccountDelta, len(event.AccountDeltas))
		for index, delta := range event.AccountDeltas {
			cloned.AccountDeltas[index] = delta
			cloned.AccountDeltas[index].Delta = roundCurrency(delta.Delta)
		}
	}
	if event.BindingConstraints != nil {
		cloned.BindingConstraints = make([]types.JsonValue, len(event.BindingConstraints))
		copy(cloned.BindingConstraints, event.BindingConstraints)
	}
	if event.AvailableAmount != nil {
		available := roundCurrency(*event.AvailableAmount)
		cloned.AvailableAmount = &available
	}
	return cloned
}

func publicTransactionEvents(path *types.ProjectionPath) []types.TransactionEvent {
	if path.TransactionEvents == nil {
		return nil
	}
	// Single-pass display: the shared assessment already reconstructed
	// pre-event balances, replayed the cap ledger in sorted order, and derived
	// fulfillment, binding constraints, remaining cap, and available amount.
	// Formatting reads those results without re-deriving them.
	evaluatedBySequence := make(map[int]evaluatedTransactionEvent, len(path.TransactionEvents))
	for _, evaluated := range evaluateTransactionEvents(path) {
		evaluatedBySequence[evaluated.event.Sequence] = evaluated
	}
	events := make([]types.TransactionEvent, len(path.TransactionEvents))
	for index, source := range path.TransactionEvents {
		event := cloneTransactionEvent(source)
		event.BindingConstraints = nil
		event.AvailableAmount = nil
		evaluated := evaluatedBySequence[source.Sequence]
		fulfillment := evaluated.fulfillment()
		event.Fulfillment = &fulfillment
		constraints := evaluated.bindingConstraints
		if len(constraints) > 0 {
			event.BindingConstraints = make([]types.JsonValue, len(constraints))
			for constraintIndex, constraint := range constraints {
				event.BindingConstraints[constraintIndex] = constraint.toTypes()
			}
			if evaluated.availableAmount != nil {
				available := *evaluated.availableAmount
				event.AvailableAmount = &available
			}
		}
		events[index] = event
	}
	return events
}

type classifiedAttempts struct {
	accountImpacts         map[string][]types.AccountDelta
	externalInflowAmount   float64
	externalOutflowAmount  float64
	internalTransferAmount float64
}

func classifyAttempts(attempts []*types.TransactionEvent, transactionsByID map[string]*types.Transaction, links []TransferLinkPair) classifiedAttempts {
	result := classifiedAttempts{accountImpacts: map[string][]types.AccountDelta{}}
	for _, attempt := range attempts {
		transaction, ok := transactionsByID[attempt.Origin.TransactionID]
		if !ok {
			continue
		}
		for _, delta := range attempt.AccountDeltas {
			result.accountImpacts[delta.AccountID] = append(result.accountImpacts[delta.AccountID], types.AccountDelta{
				TransactionID: transaction.ID,
				Delta:         delta.Delta,
			})
		}
		switch {
		case IsExternalInflow(transaction):
			// Inflow totals are net of investment losses: a negative
			// realized amount on a sourceless inflow transaction is money
			// actually lost, and balances already reflect it.
			result.externalInflowAmount += attempt.RealizedAmount
		case IsExternalOutflow(transaction):
			result.externalOutflowAmount += attempt.RealizedAmount
		case IsInternalTransfer(transaction):
			result.internalTransferAmount += attempt.RealizedAmount
		}
	}
	netLinkedAttempts(&result, attempts, transactionsByID, links)
	return result
}

// netLinkedAttempts keeps confirmed pairs count-once in row totals: linked
// actuals that classify as an external outflow plus an external inflow with
// equal absolute realized amounts move from inflow/outflow into transfer.
// Per-account impacts stay untouched (they remain the balance truth); only
// the classification totals shift. Pairs that do not both appear that date
// as external and opposite stay split, so money is never dropped.
func netLinkedAttempts(result *classifiedAttempts, attempts []*types.TransactionEvent, transactionsByID map[string]*types.Transaction, links []TransferLinkPair) {
	if len(links) == 0 {
		return
	}
	byID := map[string][]*types.TransactionEvent{}
	for _, attempt := range attempts {
		id := attempt.Origin.TransactionID
		byID[id] = append(byID[id], attempt)
	}
	netted := map[string]bool{}
	for _, link := range links {
		if netted[link.A] || netted[link.B] {
			continue
		}
		first, ok := transactionsByID[link.A]
		if !ok {
			continue
		}
		second, ok := transactionsByID[link.B]
		if !ok {
			continue
		}
		outID, inID := link.A, link.B
		if IsExternalInflow(first) && IsExternalOutflow(second) {
			outID, inID = link.B, link.A
		} else if !IsExternalOutflow(first) || !IsExternalInflow(second) {
			continue
		}
		var outSum, inSum float64
		for _, attempt := range byID[outID] {
			outSum += attempt.RealizedAmount
		}
		for _, attempt := range byID[inID] {
			inSum += attempt.RealizedAmount
		}
		outX, inX := roundCurrency(outSum), roundCurrency(inSum)
		if outX <= 0 || outX != inX {
			continue
		}
		result.externalOutflowAmount -= outX
		result.externalInflowAmount -= inX
		result.internalTransferAmount += outX
		netted[link.A], netted[link.B] = true, true
	}
}

// BuildProjectionPath adapts a run into the evaluator-facing path.
func BuildProjectionPath(prepared *types.PreparedProjection, run *types.SimulationRun) *types.ProjectionPath {
	return buildProjectionPath(prepared, run, true, nil)
}

// BuildProjectionPathWithLinks adapts a run like BuildProjectionPath and
// additionally nets confirmed transfer pairs into transfer row totals, so
// the timeline classifies linked actuals the same way flows renders them.
func BuildProjectionPathWithLinks(prepared *types.PreparedProjection, run *types.SimulationRun, links []TransferLinkPair) *types.ProjectionPath {
	return buildProjectionPath(prepared, run, true, links)
}

// BuildStochasticSamplePath adapts one Monte Carlo sample run. Sample
// consumers (percentile bands plus the threshold, fulfillment, and FI
// accumulators) read row dates, net worth, per-account balances, transaction
// events, and transaction state — never per-account impacts or classified
// cashflow totals — so impact classification is skipped. Every retained
// field is bit-identical to BuildProjectionPath.
func BuildStochasticSamplePath(prepared *types.PreparedProjection, run *types.SimulationRun) *types.ProjectionPath {
	return buildProjectionPath(prepared, run, false, nil)
}

func buildProjectionPath(prepared *types.PreparedProjection, run *types.SimulationRun, detailed bool, links []TransferLinkPair) *types.ProjectionPath {
	effectiveModel := prepared.EffectiveModel
	var transactionsByID map[string]*types.Transaction
	var attemptsByDate map[string][]*types.TransactionEvent
	if detailed {
		transactions := ResolvedTransactionTransactions(&effectiveModel)
		transactionsByID = map[string]*types.Transaction{}
		for index := range transactions {
			transaction := &transactions[index]
			transactionsByID[transaction.ID] = transaction
		}
		attemptsByDate = map[string][]*types.TransactionEvent{}
		for index := range run.TransactionAttempts {
			attempt := &run.TransactionAttempts[index]
			attemptsByDate[attempt.Date] = append(attemptsByDate[attempt.Date], attempt)
		}
	}

	historicalRows := make([]types.ProjectionRow, 0, len(prepared.HistoricalSnapshots))
	for _, snapshot := range prepared.HistoricalSnapshots {
		historicalRows = append(historicalRows, createRow(
			snapshot.Date, true, snapshot.Balances, effectiveModel.Accounts,
			map[string][]types.AccountDelta{}, 0, 0, 0, snapshot.CheckpointCorrections,
		))
	}
	projectedRows := make([]types.ProjectionRow, 0, len(run.Snapshots))
	for _, snapshot := range run.Snapshots {
		classified := classifiedAttempts{}
		if detailed {
			classified = classifyAttempts(attemptsByDate[snapshot.Date], transactionsByID, links)
		}
		projectedRows = append(projectedRows, createRow(
			snapshot.Date, false, snapshot.Balances, effectiveModel.Accounts,
			classified.accountImpacts, classified.externalInflowAmount,
			classified.externalOutflowAmount, classified.internalTransferAmount, nil,
		))
	}
	rows := append(append([]types.ProjectionRow{}, historicalRows...), projectedRows...)

	path := &types.ProjectionPath{
		Rows:                rows,
		TransactionEvents:   run.TransactionAttempts,
		EffectiveModel:      effectiveModel,
		ProjectionStartDate: run.Request.StartDate,
		ProjectionEndDate:   run.Request.EndDate,
		HistoryCutInstant:   prepared.Request.HistoryCutInstant,
	}
	initialStateClone := CloneSimulationState(run.InitialState)
	path.ProjectionStartTransactionState.LatestRealizedTransactionAmounts = initialStateClone.LatestRealizedTransactionAmounts
	path.ProjectionStartTransactionState.LatestRealizedTransactionDates = initialStateClone.LatestRealizedTransactionDates
	path.ProjectionStartTransactionState.RealizedTransactionAmountsByYear = initialStateClone.RealizedTransactionAmountsByYear
	return path
}

// AdaptSimulationRun produces RawProjectionOutput (path + public result).
func AdaptSimulationRun(prepared *types.PreparedProjection, run *types.SimulationRun) (*types.ProjectionPath, *types.ProjectionResult) {
	return AdaptSimulationRunWithLinks(prepared, run, nil)
}

// AdaptSimulationRunWithLinks adapts a run like AdaptSimulationRun and nets
// confirmed transfer pairs into transfer row totals.
func AdaptSimulationRunWithLinks(prepared *types.PreparedProjection, run *types.SimulationRun, links []TransferLinkPair) (*types.ProjectionPath, *types.ProjectionResult) {
	path := BuildProjectionPathWithLinks(prepared, run, links)
	events := publicTransactionEvents(path)
	result := RenderProjectionResult(path.Rows, events, path.EffectiveModel, run.InitialState.Balances, run.Request.StartDate)
	return path, result
}

// ProjectRawFinancialModel prepares and simulates without evaluations.
func ProjectRawFinancialModel(model *types.FinancialModel, settings *types.ProjectionRuntimeSettings, overrides types.ModelOverrides, monteCarloSample *types.MonteCarloSample) (*types.ProjectionPath, *types.ProjectionResult, error) {
	return ProjectRawFinancialModelWithLinks(model, settings, overrides, monteCarloSample, nil)
}

// ProjectRawFinancialModelWithLinks prepares and simulates like
// ProjectRawFinancialModel and nets confirmed transfer pairs into
// transfer row totals.
func ProjectRawFinancialModelWithLinks(model *types.FinancialModel, settings *types.ProjectionRuntimeSettings, overrides types.ModelOverrides, monteCarloSample *types.MonteCarloSample, links []TransferLinkPair) (*types.ProjectionPath, *types.ProjectionResult, error) {
	prepared, err := orchestratedPrepare(model, settings, overrides, monteCarloSample)
	if err != nil {
		return nil, nil, err
	}
	run, err := orchestratedSimulate(prepared.Request)
	if err != nil {
		return nil, nil, err
	}
	path, result := AdaptSimulationRunWithLinks(prepared, &run, links)
	return path, result, nil
}

// HistoricalProjectionRows replays history through the as-of cut and returns
// unrounded historical rows plus the replayed initial balances. The unified
// reader serves history live and projected dates from slices.
func HistoricalProjectionRows(model *types.FinancialModel, settings *types.ProjectionRuntimeSettings, overrides types.ModelOverrides) ([]types.ProjectionRow, map[string]float64, error) {
	prepared, err := orchestratedPrepare(model, settings, overrides, nil)
	if err != nil {
		return nil, nil, err
	}
	rows := make([]types.ProjectionRow, 0, len(prepared.HistoricalSnapshots))
	for _, snapshot := range prepared.HistoricalSnapshots {
		rows = append(rows, createRow(
			snapshot.Date, true, snapshot.Balances, prepared.EffectiveModel.Accounts,
			map[string][]types.AccountDelta{}, 0, 0, 0, snapshot.CheckpointCorrections,
		))
	}
	return rows, prepared.Request.InitialState.Balances, nil
}

// RenderProjectionResult assembles the public result from unrounded rows and
// final-form events. AdaptSimulationRun and the unified reader share it so
// stored and computed responses agree bit-for-bit.
func RenderProjectionResult(rows []types.ProjectionRow, events []types.TransactionEvent, model types.FinancialModel, initialBalances map[string]float64, startDate types.IsoDate) *types.ProjectionResult {
	accounts := model.Accounts
	var latestHistoricalRow *types.ProjectionRow
	var latestRow *types.ProjectionRow
	for index := range rows {
		row := &rows[index]
		if row.IsHistorical {
			latestHistoricalRow = row
		}
		latestRow = row
	}
	currentNetWorth := ComputeNetWorth(initialBalances, accounts)
	if latestHistoricalRow != nil {
		currentNetWorth = latestHistoricalRow.NetWorth
	}
	endingBalances := map[string]float64{}
	if latestRow != nil {
		for _, snapshot := range latestRow.AccountSnapshots {
			endingBalances[snapshot.AccountID] = snapshot.Balance
		}
	} else {
		endingBalances = initialBalances
	}
	accountSummaries := make([]types.ProjectionAccountSummary, 0, len(accounts))
	for _, account := range accounts {
		accountSummaries = append(accountSummaries, types.ProjectionAccountSummary{
			AccountID:       account.ID,
			Name:            account.Name,
			Color:           account.Color,
			Enabled:         account.Enabled,
			StartingBalance: roundCurrency(initialBalances[account.ID]),
			EndingBalance:   roundCurrency(endingBalances[account.ID]),
		})
	}
	totals := struct {
		inflow   float64
		outflow  float64
		transfer float64
	}{}
	for _, row := range rows {
		totals.inflow += row.ExternalInflowAmount
		totals.outflow += row.ExternalOutflowAmount
		totals.transfer += row.InternalTransferAmount
	}

	result := &types.ProjectionResult{}
	result.Timeline.Rows = make([]types.ProjectionRow, len(rows))
	for index, row := range rows {
		result.Timeline.Rows[index] = roundRow(row)
	}
	result.AccountSummaries = accountSummaries
	result.Totals.ExternalInflowAmount = roundCurrency(totals.inflow)
	result.Totals.ExternalOutflowAmount = roundCurrency(totals.outflow)
	result.Totals.InternalTransferAmount = roundCurrency(totals.transfer)
	if latestHistoricalRow != nil {
		date := latestHistoricalRow.Date
		result.Milestones.LatestHistoricalDate = &date
	}
	result.Milestones.ProjectionStartDate = startDate
	result.Summary.CurrentNetWorth = roundCurrency(currentNetWorth)
	finalNetWorth := currentNetWorth
	if latestRow != nil {
		finalNetWorth = latestRow.NetWorth
	}
	result.Summary.FinalNetWorth = roundCurrency(finalNetWorth)
	result.TransactionEvents = events
	return result
}
