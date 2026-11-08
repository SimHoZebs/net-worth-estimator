package domain

import (
	"math"
	"sort"

	"github.com/simhozebs/net-worth-estimator/backend/internal/types"
)

const minReportableUnfulfilledAmount = 0.5

func reportableUnfulfilled(event *types.TransactionEvent) float64 {
	amount := math.Max(0, event.RequestedAmount-event.RealizedAmount)
	if amount >= minReportableUnfulfilledAmount {
		return amount
	}
	return 0
}

type evaluatedTransactionEvent struct {
	event              *types.TransactionEvent
	bindingConstraints []accountTransactionConstraint
	destinationLimited float64
	unfulfilled        float64
	fundingShortfall   float64 // Exact residual; public reports retain their display threshold.
	capRemaining       *float64
	availableAmount    *float64
}

func (evaluated evaluatedTransactionEvent) fulfillment() types.TransactionFulfillment {
	return types.TransactionFulfillment{
		UnfulfilledAmount:        roundCurrency(evaluated.unfulfilled),
		DestinationLimitedAmount: roundCurrency(evaluated.destinationLimited),
	}
}

// availableAmountFromLimits derives the displayable available amount in the same
// single pass as constraint classification. It mirrors the former display-path
// rules: min of withdrawable source, destination headroom, and remaining cap.
// Returns nil when unconstrained inputs leave an infinite bound or when
// pre-event balances are unavailable.
func availableAmountFromLimits(transaction *types.Transaction, balancesBefore map[string]float64, hasBalances bool, accountsByID map[string]types.Account, capRemaining *float64) *float64 {
	if transaction == nil || !hasBalances {
		return nil
	}
	available := math.Inf(1)
	if transaction.SourceAccountID != nil {
		if _, exists := accountsByID[*transaction.SourceAccountID]; exists {
			available = math.Min(available, GetWithdrawableAmount(balancesBefore, accountsByID, *transaction.SourceAccountID))
		} else {
			available = 0
		}
	}
	if transaction.Destinations != nil {
		available = math.Min(available, GetTotalDestinationHeadroom(balancesBefore, accountsByID, transaction.Destinations))
	}
	if capRemaining != nil {
		available = math.Min(available, *capRemaining)
	}
	if math.IsInf(available, 0) {
		return nil
	}
	rounded := roundCurrency(available)
	return &rounded
}

// evaluateTransactionEvents is the shared assessment behind public evidence,
// fulfillment evaluations, and purchase scheduling. It does not read evaluation
// configuration, so a disabled or narrowly scoped check cannot hide a gap.
//
// Single-pass owner: it reconstructs pre-event balances and replays the
// cap ledger once, returning fulfillment inputs, binding constraints,
// remaining cap, and display-ready available amount together. Display callers
// format from this result without re-deriving balances, sort order, or caps.
func evaluateTransactionEvents(path *types.ProjectionPath) []evaluatedTransactionEvent {
	return evaluateTransactionEventsTimeline(types.TimelineFromPath(path))
}

func evaluateTransactionEventsTimeline(timeline *types.EvaluationTimeline) []evaluatedTransactionEvent {
	if timeline == nil {
		return nil
	}
	balancesBeforeBySequence := ReconstructBalancesBeforeEventsTimeline(timeline)
	accountsByID := map[string]types.Account{}
	for _, account := range timeline.EffectiveModel.Accounts {
		accountsByID[account.ID] = account
	}
	transactionsByID := map[string]*types.Transaction{}
	transactions := ResolvedTransactionTransactions(&timeline.EffectiveModel)
	for index := range transactions {
		transaction := &transactions[index]
		transactionsByID[transaction.ID] = transaction
	}
	capsByID := RuleCapsByID(&timeline.EffectiveModel)
	realizedByTransactionAndYear := map[string]float64{}
	for transactionID, byYear := range timeline.ProjectionStartTransactionState.RealizedTransactionAmountsByYear {
		for year, amount := range byYear {
			realizedByTransactionAndYear[transactionID+":"+year] = amount
		}
	}

	sorted := make([]*types.TransactionEvent, len(timeline.TransactionEvents))
	for index := range timeline.TransactionEvents {
		sorted[index] = &timeline.TransactionEvents[index]
	}
	sort.SliceStable(sorted, func(i, j int) bool {
		if sorted[i].Date != sorted[j].Date {
			return sorted[i].Date < sorted[j].Date
		}
		return sorted[i].Sequence < sorted[j].Sequence
	})

	out := make([]evaluatedTransactionEvent, 0, len(sorted))
	for _, event := range sorted {
		transaction := transactionsByID[event.Origin.TransactionID]
		capKey := event.Origin.TransactionID + ":" + event.Date[:4]
		realizedBefore := realizedByTransactionAndYear[capKey]
		var bindingConstraints []accountTransactionConstraint
		var capRemaining *float64
		if cap, capped := capsByID[event.Origin.TransactionID]; capped && transaction != nil {
			limitRemaining := math.Max(0, cap-realizedBefore)
			remaining := limitRemaining
			capRemaining = &remaining
			beforeBalances := balancesBeforeBySequence[event.Sequence]
			if beforeBalances == nil {
				beforeBalances = map[string]float64{}
			}
			bindingConstraints = ClassifyTransactionConstraints(transactionConstraintInput{
				SourceAccountID: transaction.SourceAccountID,
				Destinations:    transaction.Destinations,
				RequestedAmount: event.RequestedAmount,
				RealizedAmount:  event.RealizedAmount,
				BalancesBefore:  beforeBalances,
				AccountsByID:    accountsByID,
				LimitRemaining:  &limitRemaining,
			})
		} else if transaction != nil {
			beforeBalances := balancesBeforeBySequence[event.Sequence]
			if beforeBalances == nil {
				beforeBalances = map[string]float64{}
			}
			bindingConstraints = ClassifyTransactionConstraints(transactionConstraintInput{
				SourceAccountID: transaction.SourceAccountID,
				Destinations:    transaction.Destinations,
				RequestedAmount: event.RequestedAmount,
				RealizedAmount:  event.RealizedAmount,
				BalancesBefore:  beforeBalances,
				AccountsByID:    accountsByID,
				LimitRemaining:  nil,
			})
		} else {
			bindingConstraints = []accountTransactionConstraint{}
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
		var availableAmount *float64
		if len(bindingConstraints) > 0 && transaction != nil {
			if balancesRaw, ok := balancesBeforeBySequence[event.Sequence]; ok {
				availableAmount = availableAmountFromLimits(transaction, balancesRaw, true, accountsByID, capRemaining)
			}
		}
		// Losses are balance adjustments, not cap consumption.
		realizedByTransactionAndYear[capKey] = realizedBefore + maxFloat(0, event.RealizedAmount)
		out = append(out, evaluatedTransactionEvent{
			event: event, bindingConstraints: bindingConstraints,
			destinationLimited: destinationLimitedAmount, unfulfilled: unfulfilledAmount,
			fundingShortfall: fundingShortfall,
			capRemaining:     capRemaining, availableAmount: availableAmount,
		})
	}
	return out
}

// HasFundingGapFrom applies the canonical per-event funding assessment to all
// transactions on or after date. It is independent of configured evaluations and
// retains their destination-ceiling distinction. Protection uses exact amounts,
// including shortfalls below the public report's display threshold.
func HasFundingGapFrom(path *types.ProjectionPath, date string) bool {
	return hasFundingGapAfter(path, date, -1)
}

func hasFundingGapAfter(path *types.ProjectionPath, date string, sequence int) bool {
	for _, event := range evaluateTransactionEvents(path) {
		isLater := event.event.Date > date || (event.event.Date == date && event.event.Sequence > sequence)
		if isLater && event.fundingShortfall > transactionEpsilon {
			return true
		}
	}
	return false
}
