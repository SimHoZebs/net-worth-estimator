package domain

import (
	"math"

	"github.com/simhozebs/net-worth-estimator/backend/internal/types"
)

// Posting occurrence movement resolution. Scheduling lives in
// recurrence.go; this file resolves and applies single movements.

// AccountMovementAction is a generic movement request against accounts.
type AccountMovementAction struct {
	SourceAccountID *string
	Destinations    []string
	RequestedAmount float64
	LimitRemaining  *float64
}

// AccountMovementResult reports requested vs realized amounts.
type AccountMovementResult struct {
	RequestedAmount float64
	RealizedAmount  float64
}

// ApplyAnnualGrowth compounds an amount over elapsed days at an annual rate.
func ApplyAnnualGrowth(amount, annualGrowthRate float64, daysElapsed int) float64 {
	if amount == 0 || annualGrowthRate == 0 || daysElapsed <= 0 {
		return amount
	}
	return amount * math.Pow(1+annualGrowthRate, float64(daysElapsed)/365)
}

// ComputeRequestedAmount resolves the raw posting amount for one occurrence.
// Rule-generated instances compound the rule's schedule: the per-occurrence
// rate derives from the rule's annual rate and frequency, and expression
// amounts grow from the rule's start date. Manual postings carry no rates,
// so their resolved amount stands as authored.
func ComputeRequestedAmount(occurrence DatedPostingOccurrence, currentDate string, latestRealized map[string]float64, realizedDates map[string]string, realizedByYear map[string]map[string]float64, balances map[string]float64, paymentTerms map[string]types.PaymentTerms, stochasticRate *float64) (float64, error) {
	posting := occurrence.Posting
	daysElapsed := 0
	annualGrowthRate := 0.0
	ratePerOccurrence := 0.0
	if occurrence.Rule != nil {
		daysElapsed = DaysBetween(occurrence.Rule.StartDate, currentDate)
		effectiveAnnualRate := occurrence.Rule.AnnualRate
		if stochasticRate != nil {
			effectiveAnnualRate = *stochasticRate
		}
		if occurrence.Rule.AnnualRate != 0 {
			ratePerOccurrence = effectiveAnnualRate / float64(FrequencyDivisor(occurrence.Rule.Frequency))
		}
		annualGrowthRate = occurrence.Rule.AnnualGrowthRate
	}
	// Manual postings carry no rates: stochastic sampling only produces
	// rates for volatile rules, so a nil rule always resolves literally.
	rawAmount, err := ResolvePostingAmountDescriptor(posting.Amount, &AmountProviderContext{
		Balances:                     balances,
		LatestRealizedPostingAmounts: latestRealized,
		LatestRealizedPostingDates:   realizedDates,
		RealizedPostingAmountsByYear: realizedByYear,
		PaymentTerms:                 paymentTerms,
		Date:                         currentDate,
		OccurrenceRate:               ratePerOccurrence,
	})
	if err != nil {
		return 0, err
	}
	if posting.Amount.Resolver == "expression" {
		rawAmount = ApplyAnnualGrowth(rawAmount, annualGrowthRate, daysElapsed)
	}
	return rawAmount, nil
}

// ResolveAccountMovement clamps a requested movement to constraints.
func ResolveAccountMovement(action AccountMovementAction, balances map[string]float64, accountByID map[string]types.Account) AccountMovementResult {
	requestedAmount := math.Max(0, action.RequestedAmount)
	if requestedAmount == 0 {
		return AccountMovementResult{RequestedAmount: requestedAmount, RealizedAmount: 0}
	}
	if action.SourceAccountID != nil && !accountExists(accountByID, *action.SourceAccountID) {
		return AccountMovementResult{RequestedAmount: requestedAmount, RealizedAmount: 0}
	}
	sourceBalanceLimit := math.Inf(1)
	if action.SourceAccountID != nil {
		sourceBalanceLimit = GetWithdrawableAmount(balances, accountByID, *action.SourceAccountID)
	}
	destBalanceLimit := math.Inf(1)
	if action.Destinations != nil {
		destBalanceLimit = GetTotalDestinationHeadroom(balances, accountByID, action.Destinations)
	}
	actionLimit := math.Inf(1)
	if action.LimitRemaining != nil {
		actionLimit = *action.LimitRemaining
	}
	realizedAmount := math.Max(0, math.Min(requestedAmount, math.Min(actionLimit, math.Min(sourceBalanceLimit, destBalanceLimit))))
	return AccountMovementResult{RequestedAmount: requestedAmount, RealizedAmount: realizedAmount}
}

// ResolvePostingMovement wraps ResolveAccountMovement for postings.
func ResolvePostingMovement(posting *types.Posting, requestedAmount, annualCapRemaining float64, balances map[string]float64, accountByID map[string]types.Account) AccountMovementResult {
	capRemaining := annualCapRemaining
	return ResolveAccountMovement(AccountMovementAction{
		SourceAccountID: posting.SourceAccountID,
		Destinations:    posting.Destinations,
		RequestedAmount: requestedAmount,
		LimitRemaining:  &capRemaining,
	}, balances, accountByID)
}

// ResolveNegativeInflowMovement resolves a negative amount on a sourceless
// inflow posting (an investment loss) against destination floors, in
// destination order. Requested and realized amounts stay negative; realized
// is bounded by the withdrawable amount above each destination floor.
// Losses never consume annual caps: caps limit money moved in, not losses.
func ResolveNegativeInflowMovement(posting *types.Posting, requestedLoss float64, balances map[string]float64, accountByID map[string]types.Account) AccountMovementResult {
	remaining := -requestedLoss
	withdrawn := 0.0
	for _, destID := range posting.Destinations {
		if remaining <= 0 {
			break
		}
		withdrawable := GetWithdrawableAmount(balances, accountByID, destID)
		if withdrawable <= 0 {
			continue
		}
		take := math.Min(remaining, withdrawable)
		withdrawn += take
		remaining -= take
	}
	return AccountMovementResult{RequestedAmount: requestedLoss, RealizedAmount: -withdrawn}
}

// ApplyAccountMovement applies a realized amount to balances.
func ApplyAccountMovement(action AccountMovementAction, realizedAmount float64, balances map[string]float64, accountByID map[string]types.Account) {
	if realizedAmount <= 0 {
		return
	}
	if action.SourceAccountID != nil {
		balances[*action.SourceAccountID] -= realizedAmount
	}
	if action.Destinations == nil {
		return
	}
	remaining := realizedAmount
	for _, destID := range action.Destinations {
		if remaining <= 0 {
			break
		}
		headroom := GetHeadroom(balances, accountByID, destID)
		if headroom <= 0 {
			continue
		}
		allocated := math.Min(remaining, headroom)
		balances[destID] += allocated
		remaining -= allocated
	}
}

// ApplyPosting applies a posting's realized movement.
func ApplyPosting(posting *types.Posting, realizedAmount float64, balances map[string]float64, accountByID map[string]types.Account) {
	ApplyAccountMovement(AccountMovementAction{
		SourceAccountID: posting.SourceAccountID,
		Destinations:    posting.Destinations,
		RequestedAmount: realizedAmount,
	}, realizedAmount, balances, accountByID)
}

// ApplyNegativeInflow deducts a realized loss from destinations in order,
// bounded by each destination floor. It mirrors the resolve step above, so
// resolve-then-apply transfers the full realized loss.
func ApplyNegativeInflow(posting *types.Posting, realizedLoss float64, balances map[string]float64, accountByID map[string]types.Account) {
	if realizedLoss >= 0 {
		return
	}
	remaining := -realizedLoss
	for _, destID := range posting.Destinations {
		if remaining <= 0 {
			break
		}
		withdrawable := GetWithdrawableAmount(balances, accountByID, destID)
		if withdrawable <= 0 {
			continue
		}
		take := math.Min(remaining, withdrawable)
		balances[destID] -= take
		remaining -= take
	}
}

func accountExists(accountByID map[string]types.Account, id string) bool {
	_, ok := accountByID[id]
	return ok
}
