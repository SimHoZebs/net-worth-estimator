package domain

import (
	"math"

	"github.com/simhozebs/net-worth-estimator/backend/internal/types"
)

// Posting occurrence scheduling and movement resolution, ported from
// simulation/postings.ts.

// DatedPostingOccurrence binds a posting to its declaration index.
type DatedPostingOccurrence struct {
	Posting *types.Posting
	Index   int
}

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

// FrequencyDivisor converts annual rates to per-occurrence rates.
func FrequencyDivisor(frequency types.PostingFrequency) int {
	switch frequency {
	case types.FrequencyOnce:
		return 1
	case types.FrequencyDaily:
		return 365
	case types.FrequencyWeekly:
		return 52
	case types.FrequencyMonthly:
		return 12
	case types.FrequencyQuarterly:
		return 4
	case types.FrequencyAnnual:
		return 1
	default:
		return 1
	}
}

func advanceDate(date string, frequency types.PostingFrequency, periodCount int) string {
	switch frequency {
	case types.FrequencyOnce:
		return date
	case types.FrequencyDaily, types.FrequencyWeekly:
		days := 7
		if frequency == types.FrequencyDaily {
			days = 1
		}
		t := MustParseIsoDate(date).AddDate(0, 0, days*periodCount)
		return FormatIsoDate(t)
	case types.FrequencyMonthly:
		return AddMonthsClamped(date, periodCount)
	case types.FrequencyQuarterly:
		return AddMonthsClamped(date, periodCount*3)
	case types.FrequencyAnnual:
		return AddMonthsClamped(date, periodCount*12)
	default:
		return date
	}
}

// AddOccurrences fills eventDates with occurrences in the projection window.
// Mirrors addOccurrences: once postings execute exactly on their start date;
// window inclusivity depends on includeStartDate.
func AddOccurrences(postings []types.Posting, eventDates map[string][]DatedPostingOccurrence, projectionStartDate, projectionEndDate string, includeStartDate bool) {
	for index := range postings {
		posting := &postings[index]
		if !posting.Enabled {
			continue
		}
		effectiveEndDate := projectionEndDate
		if posting.EndDate != nil && CompareIsoDates(*posting.EndDate, projectionEndDate) < 0 {
			effectiveEndDate = *posting.EndDate
		}
		for periodCount := 0; ; periodCount++ {
			if posting.Frequency == types.FrequencyOnce && periodCount > 0 {
				break
			}
			occurrenceDate := advanceDate(posting.StartDate, posting.Frequency, periodCount)
			if CompareIsoDates(occurrenceDate, effectiveEndDate) > 0 {
				break
			}
			var startsInWindow bool
			if includeStartDate {
				startsInWindow = CompareIsoDates(occurrenceDate, projectionStartDate) >= 0
			} else {
				startsInWindow = CompareIsoDates(occurrenceDate, projectionStartDate) > 0
			}
			if !startsInWindow {
				continue
			}
			eventDates[occurrenceDate] = append(eventDates[occurrenceDate], DatedPostingOccurrence{Posting: posting, Index: index})
		}
	}
}

// ApplyAnnualGrowth compounds an amount over elapsed days at an annual rate.
func ApplyAnnualGrowth(amount, annualGrowthRate float64, daysElapsed int) float64 {
	if amount == 0 || annualGrowthRate == 0 || daysElapsed <= 0 {
		return amount
	}
	return amount * math.Pow(1+annualGrowthRate, float64(daysElapsed)/365)
}

// ComputeRequestedAmount resolves the raw posting amount for one occurrence.
func ComputeRequestedAmount(occurrence DatedPostingOccurrence, currentDate string, latestRealized map[string]float64, realizedByYear map[string]map[string]float64, balances map[string]float64, stochasticRate *float64) (float64, error) {
	posting := occurrence.Posting
	daysElapsed := DaysBetween(posting.StartDate, currentDate)
	effectiveAnnualRate := posting.AnnualRate
	if stochasticRate != nil {
		effectiveAnnualRate = *stochasticRate
	}
	ratePerOccurrence := 0.0
	if posting.AnnualRate != 0 {
		ratePerOccurrence = effectiveAnnualRate / float64(FrequencyDivisor(posting.Frequency))
	}
	rawAmount, err := ResolvePostingAmountDescriptor(posting.Amount, &AmountProviderContext{
		Balances:                     balances,
		LatestRealizedPostingAmounts: latestRealized,
		RealizedPostingAmountsByYear: realizedByYear,
		Date:                         currentDate,
		OccurrenceRate:               ratePerOccurrence,
	})
	if err != nil {
		return 0, err
	}
	if posting.Amount.Resolver == "expression" {
		rawAmount = ApplyAnnualGrowth(rawAmount, posting.AnnualGrowthRate, daysElapsed)
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

func accountExists(accountByID map[string]types.Account, id string) bool {
	_, ok := accountByID[id]
	return ok
}
