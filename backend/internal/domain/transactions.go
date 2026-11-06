package domain

import (
	"math"

	"github.com/simhozebs/net-worth-estimator/backend/internal/types"
)

// Transaction occurrence transaction resolution. Scheduling lives in
// recurrence.go; this file resolves and applies single transactions.

// AccountTransactionAction is a generic transaction request against accounts.
type AccountTransactionAction struct {
	SourceAccountID *string
	Destinations    []string
	RequestedAmount float64
	LimitRemaining  *float64
}

// AccountTransactionResult reports requested vs realized amounts.
type AccountTransactionResult struct {
	RequestedAmount float64
	RealizedAmount  float64
}

// ComputeRequestedAmount resolves the raw transaction amount for one occurrence.
// One-time and rule-generated transactions resolve through the same amount
// descriptor path: rate, growth, and volatility live in the amount inputs
// (occurrence-rate and growth-factor providers), never in side columns.
// Rule schedule context (frequency divisor, start date, pre-sampled rate)
// arrives through AmountProviderContext; manual transactions use divisor 1,
// no start date, and no sample.
func ComputeRequestedAmount(occurrence DatedTransactionOccurrence, currentDate string, latestRealized map[string]float64, realizedDates map[string]string, realizedByYear map[string]map[string]float64, balances map[string]float64, paymentTerms map[string]types.PaymentTerms, stochasticRate *float64) (float64, error) {
	transaction := occurrence.Transaction
	divisor := 1
	startDate := ""
	if occurrence.Rule != nil {
		divisor = FrequencyDivisor(occurrence.Rule.Frequency)
		startDate = occurrence.Rule.StartDate
	}
	// Manual transactions carry no schedule: stochastic sampling only produces
	// rates for volatile amounts, so a nil sample always resolves literally.
	rawAmount, err := ResolveTransactionAmountDescriptor(transaction.Amount, &AmountProviderContext{
		Balances:                         balances,
		LatestRealizedTransactionAmounts: latestRealized,
		LatestRealizedTransactionDates:   realizedDates,
		RealizedTransactionAmountsByYear: realizedByYear,
		PaymentTerms:                     paymentTerms,
		Date:                             currentDate,
		FrequencyDivisor:                 divisor,
		RuleStartDate:                    startDate,
		SampledAnnualRate:                stochasticRate,
	})
	if err != nil {
		return 0, err
	}
	return rawAmount, nil
}

// ResolveAccountTransaction clamps a requested transaction to constraints.
func ResolveAccountTransaction(action AccountTransactionAction, balances map[string]float64, accountByID map[string]types.Account) AccountTransactionResult {
	requestedAmount := math.Max(0, action.RequestedAmount)
	if requestedAmount == 0 {
		return AccountTransactionResult{RequestedAmount: requestedAmount, RealizedAmount: 0}
	}
	if action.SourceAccountID != nil && !accountExists(accountByID, *action.SourceAccountID) {
		return AccountTransactionResult{RequestedAmount: requestedAmount, RealizedAmount: 0}
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
	return AccountTransactionResult{RequestedAmount: requestedAmount, RealizedAmount: realizedAmount}
}

// ResolveTransactionTransaction wraps ResolveAccountTransaction for transactions.
func ResolveTransactionTransaction(transaction *types.Transaction, requestedAmount, annualCapRemaining float64, balances map[string]float64, accountByID map[string]types.Account) AccountTransactionResult {
	capRemaining := annualCapRemaining
	return ResolveAccountTransaction(AccountTransactionAction{
		SourceAccountID: transaction.SourceAccountID,
		Destinations:    transaction.Destinations,
		RequestedAmount: requestedAmount,
		LimitRemaining:  &capRemaining,
	}, balances, accountByID)
}

// ResolveNegativeInflowTransaction resolves a negative amount on a sourceless
// inflow transaction (an investment loss) against destination floors, in
// destination order. Requested and realized amounts stay negative; realized
// is bounded by the withdrawable amount above each destination floor.
// Losses never consume annual caps: caps limit money moved in, not losses.
func ResolveNegativeInflowTransaction(transaction *types.Transaction, requestedLoss float64, balances map[string]float64, accountByID map[string]types.Account) AccountTransactionResult {
	remaining := -requestedLoss
	withdrawn := 0.0
	for _, destID := range transaction.Destinations {
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
	return AccountTransactionResult{RequestedAmount: requestedLoss, RealizedAmount: -withdrawn}
}

// ApplyAccountTransaction applies a realized amount to balances.
func ApplyAccountTransaction(action AccountTransactionAction, realizedAmount float64, balances map[string]float64, accountByID map[string]types.Account) {
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

// ApplyTransaction applies a transaction's realized transaction.
func ApplyTransaction(transaction *types.Transaction, realizedAmount float64, balances map[string]float64, accountByID map[string]types.Account) {
	ApplyAccountTransaction(AccountTransactionAction{
		SourceAccountID: transaction.SourceAccountID,
		Destinations:    transaction.Destinations,
		RequestedAmount: realizedAmount,
	}, realizedAmount, balances, accountByID)
}

// ApplyNegativeInflow deducts a realized loss from destinations in order,
// bounded by each destination floor. It mirrors the resolve step above, so
// resolve-then-apply transfers the full realized loss.
func ApplyNegativeInflow(transaction *types.Transaction, realizedLoss float64, balances map[string]float64, accountByID map[string]types.Account) {
	if realizedLoss >= 0 {
		return
	}
	remaining := -realizedLoss
	for _, destID := range transaction.Destinations {
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
