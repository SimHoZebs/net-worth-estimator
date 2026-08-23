package domain

import (
	"math"

	"github.com/simhozebs/net-worth-estimator/backend/internal/types"
)

// Path adaptation ported from simulation/projectPath.ts.

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

type classifiedAttempts struct {
	accountImpacts         map[string][]types.AccountDelta
	externalInflowAmount   float64
	externalOutflowAmount  float64
	internalTransferAmount float64
}

func classifyAttempts(attempts []*types.MovementEvent, postingsByID map[string]*types.Posting) classifiedAttempts {
	result := classifiedAttempts{accountImpacts: map[string][]types.AccountDelta{}}
	for _, attempt := range attempts {
		posting, ok := postingsByID[attempt.Origin.PostingID]
		if !ok {
			continue
		}
		for _, delta := range attempt.AccountDeltas {
			result.accountImpacts[delta.AccountID] = append(result.accountImpacts[delta.AccountID], types.AccountDelta{
				PostingID: posting.ID,
				Delta:     delta.Delta,
			})
		}
		if attempt.Income != nil {
			resolverSum := 0.0
			for _, resolver := range attempt.Income.Resolvers {
				if resolver.DestinationAccountID != nil {
					resolverSum += resolver.RealizedAmount
				}
			}
			result.externalInflowAmount += attempt.Income.NetCashRealized + resolverSum + attempt.Income.EmployerMatchRealized
			continue
		}
		switch {
		case posting.SourceAccountID == nil && posting.Destinations != nil:
			result.externalInflowAmount += attempt.RealizedAmount
		case posting.SourceAccountID != nil && posting.Destinations == nil:
			result.externalOutflowAmount += attempt.RealizedAmount
		case posting.SourceAccountID != nil && posting.Destinations != nil:
			result.internalTransferAmount += attempt.RealizedAmount
		}
	}
	return result
}

// BuildProjectionPath adapts a run into the evaluator-facing path.
func BuildProjectionPath(prepared *types.PreparedProjection, run *types.SimulationRun) *types.ProjectionPath {
	effectiveDocument := prepared.EffectiveDocument
	postingsByID := map[string]*types.Posting{}
	for index := range effectiveDocument.Postings {
		posting := &effectiveDocument.Postings[index]
		postingsByID[posting.ID] = posting
	}
	attemptsByDate := map[string][]*types.MovementEvent{}
	for index := range run.MovementAttempts {
		attempt := &run.MovementAttempts[index]
		attemptsByDate[attempt.Date] = append(attemptsByDate[attempt.Date], attempt)
	}

	historicalRows := make([]types.ProjectionRow, 0, len(prepared.HistoricalSnapshots))
	for _, snapshot := range prepared.HistoricalSnapshots {
		historicalRows = append(historicalRows, createRow(
			snapshot.Date, true, snapshot.Balances, effectiveDocument.Accounts,
			map[string][]types.AccountDelta{}, 0, 0, 0, snapshot.CheckpointCorrections,
		))
	}
	projectedRows := make([]types.ProjectionRow, 0, len(run.Snapshots))
	for _, snapshot := range run.Snapshots {
		attempts := attemptsByDate[snapshot.Date]
		classified := classifyAttempts(attempts, postingsByID)
		projectedRows = append(projectedRows, createRow(
			snapshot.Date, false, snapshot.Balances, effectiveDocument.Accounts,
			classified.accountImpacts, classified.externalInflowAmount,
			classified.externalOutflowAmount, classified.internalTransferAmount, nil,
		))
	}
	rows := append(append([]types.ProjectionRow{}, historicalRows...), projectedRows...)

	path := &types.ProjectionPath{
		Rows:                rows,
		MovementEvents:      run.MovementAttempts,
		EffectiveDocument:   effectiveDocument,
		IncomeData:          run.Request.IncomeData,
		ProjectionStartDate: run.Request.StartDate,
		ProjectionEndDate:   run.Request.EndDate,
	}
	initialStateClone := CloneSimulationState(run.InitialState)
	path.ProjectionStartPostingState.LatestRealizedPostingAmounts = initialStateClone.LatestRealizedPostingAmounts
	path.ProjectionStartPostingState.RealizedPostingAmountsByYear = initialStateClone.RealizedPostingAmountsByYear
	return path
}

// AdaptSimulationRun produces RawProjectionOutput (path + public result).
func AdaptSimulationRun(prepared *types.PreparedProjection, run *types.SimulationRun) (*types.ProjectionPath, *types.ProjectionResult) {
	path := BuildProjectionPath(prepared, run)
	accounts := prepared.EffectiveDocument.Accounts

	var latestHistoricalRow *types.ProjectionRow
	var latestRow *types.ProjectionRow
	for index := range path.Rows {
		row := &path.Rows[index]
		if row.IsHistorical {
			latestHistoricalRow = row
		}
		latestRow = row
	}
	currentNetWorth := ComputeNetWorth(run.InitialState.Balances, accounts)
	if latestHistoricalRow != nil {
		currentNetWorth = latestHistoricalRow.NetWorth
	}
	endingBalances := map[string]float64{}
	if latestRow != nil {
		for _, snapshot := range latestRow.AccountSnapshots {
			endingBalances[snapshot.AccountID] = snapshot.Balance
		}
	} else {
		endingBalances = run.InitialState.Balances
	}
	accountSummaries := make([]types.ProjectionAccountSummary, 0, len(accounts))
	for _, account := range accounts {
		accountSummaries = append(accountSummaries, types.ProjectionAccountSummary{
			AccountID:       account.ID,
			Label:           account.Label,
			Color:           account.Color,
			Enabled:         account.Enabled,
			StartingBalance: roundCurrency(run.InitialState.Balances[account.ID]),
			EndingBalance:   roundCurrency(endingBalances[account.ID]),
		})
	}
	totals := struct {
		inflow   float64
		outflow  float64
		transfer float64
	}{}
	for _, row := range path.Rows {
		totals.inflow += row.ExternalInflowAmount
		totals.outflow += row.ExternalOutflowAmount
		totals.transfer += row.InternalTransferAmount
	}

	result := &types.ProjectionResult{}
	result.Timeline.Rows = make([]types.ProjectionRow, len(path.Rows))
	result.Timeline.SampledRows = make([]types.ProjectionRow, len(path.Rows))
	for index, row := range path.Rows {
		result.Timeline.Rows[index] = roundRow(row)
		result.Timeline.SampledRows[index] = roundRow(row)
	}
	result.AccountSummaries = accountSummaries
	result.Totals.ExternalInflowAmount = roundCurrency(totals.inflow)
	result.Totals.ExternalOutflowAmount = roundCurrency(totals.outflow)
	result.Totals.InternalTransferAmount = roundCurrency(totals.transfer)
	if latestHistoricalRow != nil {
		date := latestHistoricalRow.Date
		result.Milestones.LatestHistoricalDate = &date
	}
	result.Milestones.ProjectionStartDate = run.Request.StartDate
	result.Summary.CurrentNetWorth = roundCurrency(currentNetWorth)
	finalNetWorth := currentNetWorth
	if latestRow != nil {
		finalNetWorth = latestRow.NetWorth
	}
	result.Summary.FinalNetWorth = roundCurrency(finalNetWorth)

	copyResultTables := func(dst *types.EvaluationResultTables) {}
	_ = copyResultTables
	return path, result
}

// ProjectRawFinancialModelDocument prepares and simulates without evaluations.
func ProjectRawFinancialModelDocument(document *types.FinancialModelDocument, settings *types.ProjectionRuntimeSettings, overrides types.ModelOverrides, monteCarloSample *types.MonteCarloSample, incomeData *types.IncomeDataSnapshot) (*types.ProjectionPath, *types.ProjectionResult, error) {
	prepared, err := PrepareSimulationRequest(document, settings, overrides, monteCarloSample, incomeData)
	if err != nil {
		return nil, nil, err
	}
	run, err := Simulate(prepared.Request)
	if err != nil {
		return nil, nil, err
	}
	path, result := AdaptSimulationRun(prepared, &run)
	return path, result, nil
}
