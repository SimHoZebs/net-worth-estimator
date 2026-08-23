package domain

import (
	"math"
	"sort"

	"github.com/simhozebs/net-worth-estimator/backend/internal/types"
)

// Movement constraint reconstruction ported from evaluation/movementConstraints.ts.

const movementEpsilon = 1e-9

type accountMovementConstraint struct {
	Type       string
	AccountID  string   // source-unavailable | source-floor
	AccountIDs []string // destination-ceiling
}

func (c accountMovementConstraint) toTypes() types.JsonValue {
	switch c.Type {
	case "source-unavailable", "source-floor":
		return map[string]any{"type": c.Type, "accountId": c.AccountID}
	case "destination-ceiling":
		return map[string]any{"type": c.Type, "accountIds": c.AccountIDs}
	default:
		return map[string]any{"type": "action-limit"}
	}
}

type movementConstraintInput struct {
	SourceAccountID *string
	Destinations    []string
	RequestedAmount float64
	RealizedAmount  float64
	BalancesBefore  map[string]float64
	AccountsByID    map[string]types.Account
	LimitRemaining  *float64
}

func isBinding(limit, realized float64) bool {
	return !math.IsInf(limit, 0) && math.Abs(limit-realized) < movementEpsilon
}

// ClassifyMovementConstraints derives binding constraints for an underfulfilled movement.
func ClassifyMovementConstraints(input movementConstraintInput) []accountMovementConstraint {
	if input.RequestedAmount-input.RealizedAmount <= movementEpsilon {
		return nil
	}
	if input.SourceAccountID != nil && !accountExists(input.AccountsByID, *input.SourceAccountID) {
		return []accountMovementConstraint{{Type: "source-unavailable", AccountID: *input.SourceAccountID}}
	}
	constraints := []accountMovementConstraint{}
	if input.SourceAccountID != nil {
		withdrawable := GetWithdrawableAmount(input.BalancesBefore, input.AccountsByID, *input.SourceAccountID)
		if isBinding(withdrawable, input.RealizedAmount) {
			constraints = append(constraints, accountMovementConstraint{Type: "source-floor", AccountID: *input.SourceAccountID})
		}
	}
	if input.Destinations != nil {
		headroom := GetTotalDestinationHeadroom(input.BalancesBefore, input.AccountsByID, input.Destinations)
		if isBinding(headroom, input.RealizedAmount) {
			constraints = append(constraints, accountMovementConstraint{Type: "destination-ceiling", AccountIDs: input.Destinations})
		}
	}
	if input.LimitRemaining != nil && isBinding(*input.LimitRemaining, input.RealizedAmount) {
		constraints = append(constraints, accountMovementConstraint{Type: "action-limit"})
	}
	return constraints
}

// ReconstructBalancesBeforeEvents rebuilds pre-event balances by sequence.
func ReconstructBalancesBeforeEvents(path *types.ProjectionPath) map[int]map[string]float64 {
	projectedRowsByDate := map[string]*types.ProjectionRow{}
	for index := range path.Rows {
		row := &path.Rows[index]
		if !row.IsHistorical {
			projectedRowsByDate[row.Date] = row
		}
	}
	eventsByDate := map[string][]*types.MovementEvent{}
	for index := range path.MovementEvents {
		event := &path.MovementEvents[index]
		eventsByDate[event.Date] = append(eventsByDate[event.Date], event)
	}
	balancesBeforeBySequence := map[int]map[string]float64{}
	dates := make([]string, 0, len(eventsByDate))
	for date := range eventsByDate {
		dates = append(dates, date)
	}
	sort.Strings(dates)
	for _, date := range dates {
		row, ok := projectedRowsByDate[date]
		if !ok {
			continue
		}
		balances := map[string]float64{}
		for _, snapshot := range row.AccountSnapshots {
			balances[snapshot.AccountID] = snapshot.Balance
		}
		events := make([]*types.MovementEvent, len(eventsByDate[date]))
		copy(events, eventsByDate[date])
		sort.SliceStable(events, func(i, j int) bool { return events[i].Sequence > events[j].Sequence })
		for _, event := range events {
			before := make(map[string]float64, len(balances))
			for id, balance := range balances {
				before[id] = balance
			}
			for _, delta := range event.AccountDeltas {
				before[delta.AccountID] -= delta.Delta
			}
			balancesBeforeBySequence[event.Sequence] = before
			balances = before
		}
	}
	return balancesBeforeBySequence
}
