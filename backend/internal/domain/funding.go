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
func availableAmountFromLimits(posting *types.Posting, balancesBefore map[string]float64, hasBalances bool, accountsByID map[string]types.Account, capRemaining *float64) *float64 {
	if posting == nil || !hasBalances {
		return nil
	}
	available := math.Inf(1)
	if posting.SourceAccountID != nil {
		if _, exists := accountsByID[*posting.SourceAccountID]; exists {
			available = math.Min(available, GetWithdrawableAmount(balancesBefore, accountsByID, *posting.SourceAccountID))
		} else {
			available = 0
		}
	}
	if posting.Destinations != nil {
		available = math.Min(available, GetTotalDestinationHeadroom(balancesBefore, accountsByID, posting.Destinations))
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
	balancesBeforeBySequence := ReconstructBalancesBeforeEvents(path)
	accountsByID := map[string]types.Account{}
	for _, account := range path.EffectiveModel.Accounts {
		accountsByID[account.ID] = account
	}
	postingsByID := map[string]*types.Posting{}
	transactions := ResolvedTransactionPostings(&path.EffectiveModel)
	for index := range transactions {
		posting := &transactions[index]
		postingsByID[posting.ID] = posting
	}
	capsByID := RuleCapsByID(&path.EffectiveModel)
	realizedByPostingAndYear := map[string]float64{}
	for postingID, byYear := range path.ProjectionStartPostingState.RealizedPostingAmountsByYear {
		for year, amount := range byYear {
			realizedByPostingAndYear[postingID+":"+year] = amount
		}
	}

	sorted := make([]*types.TransactionEvent, len(path.TransactionEvents))
	for index := range path.TransactionEvents {
		sorted[index] = &path.TransactionEvents[index]
	}
	sort.SliceStable(sorted, func(i, j int) bool {
		if sorted[i].Date != sorted[j].Date {
			return sorted[i].Date < sorted[j].Date
		}
		return sorted[i].Sequence < sorted[j].Sequence
	})

	out := make([]evaluatedTransactionEvent, 0, len(sorted))
	for _, event := range sorted {
		posting := postingsByID[event.Origin.PostingID]
		capKey := event.Origin.PostingID + ":" + event.Date[:4]
		realizedBefore := realizedByPostingAndYear[capKey]
		var bindingConstraints []accountTransactionConstraint
		var capRemaining *float64
		if cap, capped := capsByID[event.Origin.PostingID]; capped && posting != nil {
			limitRemaining := math.Max(0, cap-realizedBefore)
			remaining := limitRemaining
			capRemaining = &remaining
			beforeBalances := balancesBeforeBySequence[event.Sequence]
			if beforeBalances == nil {
				beforeBalances = map[string]float64{}
			}
			bindingConstraints = ClassifyTransactionConstraints(transactionConstraintInput{
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
			bindingConstraints = ClassifyTransactionConstraints(transactionConstraintInput{
				SourceAccountID: posting.SourceAccountID,
				Destinations:    posting.Destinations,
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
		if len(bindingConstraints) > 0 && posting != nil {
			if balancesRaw, ok := balancesBeforeBySequence[event.Sequence]; ok {
				availableAmount = availableAmountFromLimits(posting, balancesRaw, true, accountsByID, capRemaining)
			}
		}
		// Losses are balance adjustments, not cap consumption.
		realizedByPostingAndYear[capKey] = realizedBefore + maxFloat(0, event.RealizedAmount)
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
