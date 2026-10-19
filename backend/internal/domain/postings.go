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

// ComputeRequestedAmount resolves the raw posting amount for one occurrence.
// One-time and rule-generated movements resolve through the same amount
// descriptor path: rate, growth, and volatility live in the amount inputs
// (occurrence-rate and growth-factor providers), never in side columns.
// Rule schedule context (frequency divisor, start date, pre-sampled rate)
// arrives through AmountProviderContext; manual postings use divisor 1,
// no start date, and no sample.
func ComputeRequestedAmount(occurrence DatedPostingOccurrence, currentDate string, latestRealized map[string]float64, realizedDates map[string]string, realizedByYear map[string]map[string]float64, balances map[string]float64, paymentTerms map[string]types.PaymentTerms, stochasticRate *float64) (float64, error) {
	posting := occurrence.Posting
	divisor := 1
	startDate := ""
	if occurrence.Rule != nil {
		divisor = FrequencyDivisor(occurrence.Rule.Frequency)
		startDate = occurrence.Rule.StartDate
	}
	// Manual postings carry no schedule: stochastic sampling only produces
	// rates for volatile amounts, so a nil sample always resolves literally.
	rawAmount, err := ResolvePostingAmountDescriptor(posting.Amount, &AmountProviderContext{
		Balances:                     balances,
		LatestRealizedPostingAmounts: latestRealized,
		LatestRealizedPostingDates:   realizedDates,
		RealizedPostingAmountsByYear: realizedByYear,
		PaymentTerms:                 paymentTerms,
		Date:                         currentDate,
		FrequencyDivisor:             divisor,
		RuleStartDate:                startDate,
		SampledAnnualRate:            stochasticRate,
	})
	if err != nil {
		return 0, err
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
