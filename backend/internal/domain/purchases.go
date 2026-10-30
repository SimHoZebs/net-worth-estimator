package domain

import (
	"sort"
	"strconv"

	"github.com/simhozebs/net-worth-estimator/backend/internal/types"
)

type scheduledPurchase struct {
	purchase *types.PlannedPurchase
	date     string
}

// purchasesCandidateRequest rebuilds the purchases candidate simulation
// request from the prepared base path. History already replayed through the
// cut instant, so candidates always include start-day events and rely on
// the shared HistoryCutInstant to skip already-replayed occurrences.
func purchasesCandidateRequest(path *types.ProjectionPath, sample *types.MonteCarloSample) types.SimulationRequest {
	model := path.EffectiveModel
	var latestHistorical *types.ProjectionRow
	for index := range path.Rows {
		row := &path.Rows[index]
		if !row.IsHistorical {
			break
		}
		latestHistorical = row
	}
	includeStartDateEvents := true
	return types.SimulationRequest{
		Model: types.SimulationInputs{
			Accounts:         model.Accounts,
			Postings:         model.Postings,
			RecurrenceRules:  model.RecurrenceRules,
			PaymentTerms:     model.PaymentTerms,
			PlannedPurchases: model.PlannedPurchases,
		},
		InitialState: CloneSimulationState(SimulationState{
			Balances:                     balancesAt(latestHistorical, model.Accounts),
			LatestRealizedPostingAmounts: path.ProjectionStartPostingState.LatestRealizedPostingAmounts,
			LatestRealizedPostingDates:   path.ProjectionStartPostingState.LatestRealizedPostingDates,
			RealizedPostingAmountsByYear: path.ProjectionStartPostingState.RealizedPostingAmountsByYear,
		}),
		StartDate:              path.ProjectionStartDate,
		EndDate:                path.ProjectionEndDate,
		IncludeStartDateEvents: includeStartDateEvents,
		MonteCarloSample:       sample,
		HistoryCutInstant:      path.HistoryCutInstant,
	}
}

func plannedToPosting(p *types.PlannedPurchase) *types.Posting {
	costExpr := strconv.FormatFloat(p.Cost, 'f', -1, 64)
	return &types.Posting{
		ID: p.ID, Name: p.Name, SourceAccountID: p.FundingAccountID,
		Amount: types.PostingAmountResolution{
			Resolver: "expression",
			Config:   map[string]any{"expression": costExpr},
		},
		PostedTime:      midnightUnix(p.EarliestDate),
		TransactionTime: midnightUnix(p.EarliestDate),
		Enabled:         p.Enabled,
	}
}

func appendScheduledPurchases(byDate map[string][]DatedPostingOccurrence, purchases []scheduledPurchase) {
	for index, purchase := range purchases {
		byDate[purchase.date] = append(byDate[purchase.date], DatedPostingOccurrence{
			Posting: plannedToPosting(purchase.purchase), Purchase: purchase.purchase, Index: index,
		})
	}
}

// simulatePurchases greedily schedules whole purchases in priority order. Each
// candidate simulation uses the same kernel and funding-gap assessment as public projections.
// Rejected candidates never change the accepted state or the canonical model.
//
// Planned purchases remain separate from canonical money movements. Only this
// private branch synthesizes executable movements for accepted candidates.
func simulatePurchases(request types.SimulationRequest) (types.SimulationRun, error) {
	if err := requireResimulationAllowed("simulatePurchases"); err != nil {
		return types.SimulationRun{}, err
	}
	queue := []*types.PlannedPurchase{}
	for index := range request.Model.PlannedPurchases {
		p := &request.Model.PlannedPurchases[index]
		if !p.Enabled {
			continue
		}
		if err := validatePlannedPurchaseCost(p.Cost, p.ID); err != nil {
			return types.SimulationRun{}, err
		}
		queue = append(queue, p)
	}
	if len(queue) == 0 {
		return simulateScheduled(request, nil, nil)
	}
	firstDate := request.StartDate
	dateSet := map[string]bool{}
	for _, purchase := range queue {
		if day := purchase.EarliestDate; day >= firstDate && day <= request.EndDate {
			dateSet[day] = true
		}
	}
	sort.SliceStable(queue, func(i, j int) bool { return queue[i].Priority < queue[j].Priority })
	if firstDate <= request.EndDate {
		dateSet[firstDate] = true
	}
	resolved := ResolveOccurrences(request.Model.RecurrenceRules, request.Model.Postings, request.StartDate, request.EndDate, request.IncludeStartDateEvents)
	for date := range resolved.ByDate {
		dateSet[date] = true
	}
	dates := make([]string, 0, len(dateSet))
	for date := range dateSet {
		dates = append(dates, date)
	}
	sort.Strings(dates)
	accepted, err := simulateScheduled(request, nil, dates)
	if err != nil {
		return types.SimulationRun{}, err
	}
	scheduled := []scheduledPurchase{}
	accounts := accountIndex(request.Model.Accounts)
	lastDate := firstDate
	for _, purchase := range queue {
		found := false
		cost := purchase.Cost
		for _, snapshot := range accepted.Snapshots {
			date := snapshot.Date
			if date < lastDate || date < purchase.EarliestDate {
				continue
			}
			// Avoid a full simulation when the current source cannot buy the whole item.
			if purchase.FundingAccountID == nil || GetWithdrawableAmount(snapshot.Balances, accounts, *purchase.FundingAccountID)+transactionEpsilon < cost {
				continue
			}
			candidateSchedule := append(append([]scheduledPurchase{}, scheduled...), scheduledPurchase{purchase: purchase, date: date})
			candidate, err := simulateScheduled(request, candidateSchedule, dates)
			if err != nil {
				return types.SimulationRun{}, err
			}
			purchaseEvent := fullyFundedPurchase(&candidate, purchase.ID)
			if purchaseEvent == nil || hasFundingGapAfter(simulationPath(&candidate), date, purchaseEvent.Sequence) {
				continue
			}
			scheduled, accepted, lastDate, found = candidateSchedule, candidate, date, true
			break
		}
		if !found {
			break // Strict queue: a cheaper or separately funded item cannot jump ahead.
		}
	}
	return accepted, nil
}

func accountIndex(accounts []types.Account) map[string]types.Account {
	out := make(map[string]types.Account, len(accounts))
	for _, account := range accounts {
		out[account.ID] = account
	}
	return out
}

func fullyFundedPurchase(run *types.SimulationRun, id string) *types.TransactionEvent {
	for index := range run.TransactionAttempts {
		event := &run.TransactionAttempts[index]
		if event.Origin.PostingID == id && event.RequestedAmount-event.RealizedAmount <= transactionEpsilon {
			return event
		}
	}
	return nil
}

func simulationPath(run *types.SimulationRun) *types.ProjectionPath {
	return BuildStochasticSamplePath(&types.PreparedProjection{
		EffectiveModel: types.FinancialModel{
			Accounts: run.Request.Model.Accounts, Postings: run.Request.Model.Postings,
			RecurrenceRules:  run.Request.Model.RecurrenceRules,
			PaymentTerms:     run.Request.Model.PaymentTerms,
			PlannedPurchases: run.Request.Model.PlannedPurchases,
		},
	}, run)
}
