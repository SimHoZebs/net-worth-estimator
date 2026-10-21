package domain

import (
	"sort"

	"github.com/simhozebs/net-worth-estimator/backend/internal/types"
)

type scheduledPurchase struct {
	posting *types.Posting
	date    string
}

func appendScheduledPurchases(byDate map[string][]DatedPostingOccurrence, purchases []scheduledPurchase) {
	for index, purchase := range purchases {
		byDate[purchase.date] = append(byDate[purchase.date], DatedPostingOccurrence{
			Posting: purchase.posting, Index: index,
		})
	}
}

// simulatePurchases greedily schedules whole purchases in priority order. Each
// trial uses the same kernel and funding-gap assessment as public projections.
// Rejected trials never change the accepted state or the canonical document.
func simulatePurchases(request types.SimulationRequest) (types.SimulationRun, error) {
	queue := []*types.Posting{}
	for index := range request.Model.Postings {
		posting := &request.Model.Postings[index]
		if posting.Enabled && posting.Purchase != nil {
			queue = append(queue, posting)
		}
	}
	if len(queue) == 0 {
		return simulateScheduled(request, nil, nil)
	}
	firstDate := request.StartDate
	if !request.IncludeStartDateEvents {
		// A start-day checkpoint is an end-of-day observation. Keep purchases
		// in the future, and retain one unambiguous balance per calendar date.
		firstDate = FormatIsoDate(MustParseIsoDate(firstDate).AddDate(0, 0, 1))
	}
	dateSet := map[string]bool{}
	for _, posting := range queue {
		if day := postingDay(posting); day >= firstDate && day <= request.EndDate {
			dateSet[day] = true
		}
	}
	sort.SliceStable(queue, func(i, j int) bool { return queue[i].Purchase.Priority < queue[j].Purchase.Priority })
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
	for _, posting := range queue {
		found := false
		cost, err := purchaseCost(posting)
		if err != nil {
			return types.SimulationRun{}, err
		}
		for _, snapshot := range accepted.Snapshots {
			date := snapshot.Date
			if date < lastDate || date < postingDay(posting) {
				continue
			}
			// Avoid a full trial when the current source cannot buy the whole item.
			if posting.SourceAccountID == nil || GetWithdrawableAmount(snapshot.Balances, accounts, *posting.SourceAccountID)+movementEpsilon < cost {
				continue
			}
			trialSchedule := append(append([]scheduledPurchase{}, scheduled...), scheduledPurchase{posting: posting, date: date})
			trial, err := simulateScheduled(request, trialSchedule, dates)
			if err != nil {
				return types.SimulationRun{}, err
			}
			purchaseEvent := fullyFundedPurchase(&trial, posting.ID)
			if purchaseEvent == nil || hasFundingGapAfter(simulationPath(&trial), date, purchaseEvent.Sequence) {
				continue
			}
			scheduled, accepted, lastDate, found = trialSchedule, trial, date, true
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

func fullyFundedPurchase(run *types.SimulationRun, id string) *types.MovementEvent {
	for index := range run.MovementAttempts {
		event := &run.MovementAttempts[index]
		if event.Origin.PostingID == id && event.RequestedAmount-event.RealizedAmount <= movementEpsilon {
			return event
		}
	}
	return nil
}

func simulationPath(run *types.SimulationRun) *types.ProjectionPath {
	return BuildStochasticSamplePath(&types.PreparedProjection{
		EffectiveDocument: types.FinancialModelDocument{
			Accounts: run.Request.Model.Accounts, Postings: run.Request.Model.Postings,
			RecurrenceRules: run.Request.Model.RecurrenceRules,
		},
	}, run)
}
