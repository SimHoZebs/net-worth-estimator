package domain

import (
	"math"
	"sort"

	"github.com/simhozebs/net-worth-estimator/backend/internal/types"
)

// Pure deterministic kernel ported from simulation/simulate.ts.

func maxFloat(a, b float64) float64 {
	if a > b || math.IsNaN(b) {
		return a
	}
	return b
}

func inf() float64 { return math.Inf(1) }

// Simulate runs the pure kernel over a prepared request.
func Simulate(request types.SimulationRequest) (types.SimulationRun, error) {
	transitions, err := CreateTransitionRuntime(
		request.Model,
		request.InitialState,
		request.StartDate,
		request.MonteCarloSample,
		request.IncomeData,
	)
	if err != nil {
		return types.SimulationRun{}, err
	}
	movementAttempts := []types.MovementEvent{}
	snapshots := []types.SimulationSnapshot{}
	eventDates := map[string][]DatedPostingOccurrence{}
	movementSequence := 0

	AddOccurrences(request.Model.Postings, eventDates, request.StartDate, request.EndDate, request.IncludeStartDateEvents)

	dates := make([]string, 0, len(eventDates))
	for date := range eventDates {
		dates = append(dates, date)
	}
	sort.Slice(dates, func(i, j int) bool { return CompareIsoDates(dates[i], dates[j]) < 0 })

	for _, date := range dates {
		occurrences := eventDates[date]
		sorted := make([]DatedPostingOccurrence, len(occurrences))
		copy(sorted, occurrences)
		sort.SliceStable(sorted, func(i, j int) bool {
			if sorted[i].Posting.Priority != sorted[j].Posting.Priority {
				return sorted[i].Posting.Priority < sorted[j].Posting.Priority
			}
			return sorted[i].Index < sorted[j].Index
		})
		for _, occurrence := range sorted {
			transition, err := transitions.ExecutePosting(occurrence, date)
			if err != nil {
				return types.SimulationRun{}, err
			}
			event := types.MovementEvent{
				Date:            date,
				Sequence:        movementSequence,
				Origin:          types.MovementOrigin{Type: "posting", PostingID: transition.PostingID},
				RequestedAmount: transition.Result.RequestedAmount,
				RealizedAmount:  transition.Result.RealizedAmount,
				Income:          transition.Income,
			}
			for _, delta := range transition.AccountDeltas {
				event.AccountDeltas = append(event.AccountDeltas, struct {
					AccountID string  `json:"accountId"`
					Delta     float64 `json:"delta"`
				}{AccountID: delta.AccountID, Delta: delta.Delta})
			}
			movementAttempts = append(movementAttempts, event)
			movementSequence++
		}
		balances := SnapshotBalances(transitions.State.Balances)
		snapshots = append(snapshots, types.SimulationSnapshot{Date: date, Balances: balances})
	}

	run := types.SimulationRun{}
	run.Request.Model = request.Model
	run.Request.StartDate = request.StartDate
	run.Request.EndDate = request.EndDate
	run.Request.IncludeStartDateEvents = request.IncludeStartDateEvents
	run.Request.IncomeData = request.IncomeData
	run.InitialState = CloneSimulationState(request.InitialState)
	run.FinalState = CloneSimulationState(transitions.State)
	run.Snapshots = snapshots
	run.MovementAttempts = movementAttempts
	run.MonteCarloSample = request.MonteCarloSample
	return run, nil
}
