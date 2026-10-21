package domain

import (
	"math"
	"sort"

	"github.com/simhozebs/net-worth-estimator/backend/internal/types"
)

const minReportableUnfulfilledAmount = 0.5

func reportableUnfulfilled(event *types.MovementEvent) float64 {
	amount := math.Max(0, event.RequestedAmount-event.RealizedAmount)
	if amount >= minReportableUnfulfilledAmount {
		return amount
	}
	return 0
}

type evaluatedMovementEvent struct {
	event              *types.MovementEvent
	bindingConstraints []accountMovementConstraint
	destinationLimited float64
	unfulfilled        float64
	fundingShortfall   float64 // Exact residual; public reports retain their display threshold.
}

func (evaluated evaluatedMovementEvent) fulfillment() types.MovementFulfillment {
	return types.MovementFulfillment{
		UnfulfilledAmount:        roundCurrency(evaluated.unfulfilled),
		DestinationLimitedAmount: roundCurrency(evaluated.destinationLimited),
	}
}

// evaluateMovementEvents is the shared assessment behind public evidence,
// fulfillment evaluations, and purchase scheduling. It does not read evaluation
// configuration, so a disabled or narrowly scoped check cannot hide a gap.
func evaluateMovementEvents(path *types.ProjectionPath) []evaluatedMovementEvent {
	balancesBeforeBySequence := ReconstructBalancesBeforeEvents(path)
	accountsByID := map[string]types.Account{}
	for _, account := range path.EffectiveDocument.Accounts {
		accountsByID[account.ID] = account
	}
	postingsByID := map[string]*types.Posting{}
	movements := ResolvedMovementPostings(&path.EffectiveDocument)
	for index := range movements {
		posting := &movements[index]
		postingsByID[posting.ID] = posting
	}
	capsByID := RuleCapsByID(&path.EffectiveDocument)
	realizedByPostingAndYear := map[string]float64{}
	for postingID, byYear := range path.ProjectionStartPostingState.RealizedPostingAmountsByYear {
		for year, amount := range byYear {
			realizedByPostingAndYear[postingID+":"+year] = amount
		}
	}

	sorted := make([]*types.MovementEvent, len(path.MovementEvents))
	for index := range path.MovementEvents {
		sorted[index] = &path.MovementEvents[index]
	}
	sort.SliceStable(sorted, func(i, j int) bool {
		if sorted[i].Date != sorted[j].Date {
			return sorted[i].Date < sorted[j].Date
		}
		return sorted[i].Sequence < sorted[j].Sequence
	})

	out := make([]evaluatedMovementEvent, 0, len(sorted))
	for _, event := range sorted {
		posting := postingsByID[event.Origin.PostingID]
		capKey := event.Origin.PostingID + ":" + event.Date[:4]
		realizedBefore := realizedByPostingAndYear[capKey]
		var bindingConstraints []accountMovementConstraint
		if cap, capped := capsByID[event.Origin.PostingID]; capped {
			limitRemaining := math.Max(0, cap-realizedBefore)
			beforeBalances := balancesBeforeBySequence[event.Sequence]
			if beforeBalances == nil {
				beforeBalances = map[string]float64{}
			}
			bindingConstraints = ClassifyMovementConstraints(movementConstraintInput{
				SourceAccountID: posting.SourceAccountID,
				Destinations:    posting.Destinations,
				RequestedAmount: event.RequestedAmount,
				RealizedAmount:  event.RealizedAmount,
				BalancesBefore:  beforeBalances,
				AccountsByID:    accountsByID,
				LimitRemaining:  &limitRemaining,
			})
		} else if posting != nil {
			beforeBalances := balancesBeforeBySequence[event.Sequence]
			if beforeBalances == nil {
				beforeBalances = map[string]float64{}
			}
			bindingConstraints = ClassifyMovementConstraints(movementConstraintInput{
				SourceAccountID: posting.SourceAccountID,
				Destinations:    posting.Destinations,
				RequestedAmount: event.RequestedAmount,
				RealizedAmount:  event.RealizedAmount,
				BalancesBefore:  beforeBalances,
				AccountsByID:    accountsByID,
				LimitRemaining:  nil,
			})
		} else {
			bindingConstraints = []accountMovementConstraint{}
		}
		residual := reportableUnfulfilled(event)
		destinationLimited := false
		for _, constraint := range bindingConstraints {
			if constraint.Type == "destination-ceiling" {
				destinationLimited = true
				break
			}
		}
		destinationLimitedAmount := 0.0
		unfulfilledAmount := 0.0
		fundingShortfall := 0.0
		if destinationLimited {
			destinationLimitedAmount = residual
		} else {
			unfulfilledAmount = residual
			fundingShortfall = math.Max(0, event.RequestedAmount-event.RealizedAmount)
		}
		// Losses are balance adjustments, not cap consumption.
		realizedByPostingAndYear[capKey] = realizedBefore + maxFloat(0, event.RealizedAmount)
		out = append(out, evaluatedMovementEvent{
			event: event, bindingConstraints: bindingConstraints,
			destinationLimited: destinationLimitedAmount, unfulfilled: unfulfilledAmount,
			fundingShortfall: fundingShortfall,
		})
	}
	return out
}

// HasFundingGapFrom applies the canonical per-event funding assessment to all
// movements on or after date. It is independent of configured evaluations and
// retains their destination-ceiling distinction. Protection uses exact amounts,
// including shortfalls below the public report's display threshold.
func HasFundingGapFrom(path *types.ProjectionPath, date string) bool {
	return hasFundingGapAfter(path, date, -1)
}

func hasFundingGapAfter(path *types.ProjectionPath, date string, sequence int) bool {
	for _, event := range evaluateMovementEvents(path) {
		isLater := event.event.Date > date || (event.event.Date == date && event.event.Sequence > sequence)
		if isLater && event.fundingShortfall > movementEpsilon {
			return true
		}
	}
	return false
}
