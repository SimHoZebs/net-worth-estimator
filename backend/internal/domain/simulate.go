package domain

import (
	"math"
	"sort"

	"github.com/simhozebs/net-worth-estimator/backend/internal/types"
)

// Pure deterministic kernel. Go is the owner.

func maxFloat(a, b float64) float64 {
	if a > b || math.IsNaN(b) {
		return a
	}
	return b
}

func inf() float64 { return math.Inf(1) }

// Simulate runs the pure kernel over a prepared request.
func Simulate(request types.SimulationRequest) (types.SimulationRun, error) {
	return simulateScheduled(request, nil, nil)
}

// simulateScheduled executes established payments and accepted purchases.
// Only the purchase evaluation supplies purchases and candidate dates.
func simulateScheduled(request types.SimulationRequest, purchases []scheduledPurchase, candidateDates []string) (types.SimulationRun, error) {
	if err := requireResimulationAllowed("simulateScheduled"); err != nil {
		return types.SimulationRun{}, err
	}
	transitions, err := CreateTransitionRuntime(
		request.Model,
		request.InitialState,
		request.StartDate,
		request.MonteCarloSample,
	)
	if err != nil {
		return types.SimulationRun{}, err
	}
	transactionAttempts := []types.TransactionEvent{}
	snapshots := []types.SimulationSnapshot{}
	transactionSequence := 0

	resolved := ResolveOccurrences(request.Model.RecurrenceRules, request.Model.Postings, request.StartDate, request.EndDate, request.IncludeStartDateEvents)
	eventDates := resolved.ByDate
	for _, date := range candidateDates {
		if _, exists := eventDates[date]; !exists {
			eventDates[date] = nil
		}
	}
	appendScheduledPurchases(eventDates, purchases)

	dates := make([]string, 0, len(eventDates))
	for date := range eventDates {
		dates = append(dates, date)
	}
	sort.Slice(dates, func(i, j int) bool { return CompareIsoDates(dates[i], dates[j]) < 0 })

	// The history cut splits one timestamp stream: occurrences at or
	// before it already replayed and must not simulate again. Purchases
	// are future-planned inputs the replay never executes, so they are
	// exempt from the filter.
	cut := request.HistoryCutInstant
	for _, date := range dates {
		occurrences := eventDates[date]
		sorted := make([]DatedPostingOccurrence, len(occurrences))
		copy(sorted, occurrences)
		sortOccurrences(sorted)
		for _, occurrence := range sorted {
			if cut > 0 && occurrence.Purchase == nil && EffectiveOccurrenceInstant(occurrence, date) <= cut {
				continue
			}
			transition, err := transitions.ExecutePosting(occurrence, date, false)
			if err != nil {
				return types.SimulationRun{}, err
			}
			event := types.TransactionEvent{
				Date:            date,
				Sequence:        transactionSequence,
				Origin:          types.TransactionOrigin{Type: "posting", PostingID: transition.PostingID},
				RequestedAmount: transition.Result.RequestedAmount,
				RealizedAmount:  transition.Result.RealizedAmount,
			}
			for _, delta := range transition.AccountDeltas {
				event.AccountDeltas = append(event.AccountDeltas, struct {
					AccountID string  `json:"accountId"`
					Delta     float64 `json:"delta"`
				}{AccountID: delta.AccountID, Delta: delta.Delta})
			}
			transactionAttempts = append(transactionAttempts, event)
			transactionSequence++
		}
		balances := SnapshotBalances(transitions.State.Balances)
		snapshots = append(snapshots, types.SimulationSnapshot{Date: date, Balances: balances})
	}

	run := types.SimulationRun{}
	run.Request.Model = request.Model
	run.Request.StartDate = request.StartDate
	run.Request.EndDate = request.EndDate
	run.Request.IncludeStartDateEvents = request.IncludeStartDateEvents
	run.InitialState = CloneSimulationState(request.InitialState)
	run.FinalState = CloneSimulationState(transitions.State)
	run.Snapshots = snapshots
	run.TransactionAttempts = transactionAttempts
	run.MonteCarloSample = request.MonteCarloSample
	return run, nil
}
