package domain

import (
	"math"
	"sort"

	"github.com/simhozebs/net-worth-estimator/backend/internal/types"
)

// Pure FI result builders: withdrawal summaries and JSON shaping over
// branch-simulation outcomes. Go is the owner of these builders.

func constraintAccountIDs(constraint accountMovementConstraint) []string {
	switch constraint.Type {
	case "source-unavailable", "source-floor":
		return []string{constraint.AccountID}
	case "destination-ceiling":
		return constraint.AccountIDs
	default:
		return []string{}
	}
}

func movementUnfulfilled(requested, realized float64) float64 {
	return math.Max(0, requested-realized)
}

func countConstraints(attempts []withdrawalAttempt) []constraintCount {
	counts := map[string]int{}
	var order []string
	for _, attempt := range attempts {
		for _, constraint := range attempt.bindingConstraints {
			if _, ok := counts[constraint.Type]; !ok {
				order = append(order, constraint.Type)
			}
			counts[constraint.Type]++
		}
	}
	sort.SliceStable(order, func(i, j int) bool { return order[i] < order[j] })
	out := make([]constraintCount, 0, len(order))
	for _, constraintType := range order {
		out = append(out, constraintCount{Type: constraintType, Count: counts[constraintType]})
	}
	return out
}

func summarizeWithdrawals(attempts []withdrawalAttempt) *FIWithdrawalSummary {
	requestedAmount := 0.0
	realizedAmount := 0.0
	for _, attempt := range attempts {
		requestedAmount += attempt.requestedAmount
		realizedAmount += attempt.realizedAmount
	}
	requestedRounded := roundCents(requestedAmount)
	realizedRounded := roundCents(realizedAmount)
	shortfallAmount := 0.0
	if requestedRounded-realizedRounded > fiEpsilon {
		shortfallAmount = roundCents(requestedRounded - realizedRounded)
	}
	shortfallPeriods := map[IsoDate][]withdrawalAttempt{}
	for _, attempt := range attempts {
		if movementUnfulfilled(attempt.requestedAmount, attempt.realizedAmount) <= fiEpsilon {
			continue
		}
		shortfallPeriods[attempt.date] = append(shortfallPeriods[attempt.date], attempt)
	}
	dates := make([]IsoDate, 0, len(shortfallPeriods))
	for date := range shortfallPeriods {
		dates = append(dates, date)
	}
	sort.Slice(dates, func(i, j int) bool { return CompareIsoDates(dates[i], dates[j]) < 0 })

	relatedAccountIDsSet := []string{}
	for _, attempt := range attempts {
		if attempt.accountID != nil {
			relatedAccountIDsSet = append(relatedAccountIDsSet, *attempt.accountID)
		}
		for _, constraint := range attempt.bindingConstraints {
			relatedAccountIDsSet = append(relatedAccountIDsSet, constraintAccountIDs(constraint)...)
		}
	}
	relatedAccountIDs := uniqueSortedStrings(relatedAccountIDsSet)

	accountIDsSet := []string{}
	for _, attempt := range attempts {
		if attempt.accountID != nil {
			accountIDsSet = append(accountIDsSet, *attempt.accountID)
		}
	}
	accountIDs := uniqueSortedStrings(accountIDsSet)

	failingAttempts := []withdrawalAttempt{}
	for _, attempt := range attempts {
		if movementUnfulfilled(attempt.requestedAmount, attempt.realizedAmount) > fiEpsilon {
			failingAttempts = append(failingAttempts, attempt)
		}
	}

	var firstShortfallDate, lastShortfallDate *IsoDate
	if len(dates) > 0 {
		first := dates[0]
		last := dates[len(dates)-1]
		firstShortfallDate = &first
		lastShortfallDate = &last
	}

	var firstAttempts []withdrawalAttempt
	if len(dates) > 0 {
		for _, attempt := range attempts {
			if attempt.date == dates[0] {
				firstAttempts = append(firstAttempts, attempt)
			}
		}
	}
	firstRequested := 0.0
	firstRealized := 0.0
	for _, attempt := range firstAttempts {
		firstRequested += attempt.requestedAmount
		firstRealized += attempt.realizedAmount
	}
	firstRequested = roundCents(firstRequested)
	firstRealized = roundCents(firstRealized)

	accounts := []map[string]any{}
	for _, accountID := range accountIDs {
		var accountAttempts []withdrawalAttempt
		for _, attempt := range attempts {
			if attempt.accountID != nil && *attempt.accountID == accountID {
				accountAttempts = append(accountAttempts, attempt)
			}
		}
		accountRequested := 0.0
		accountRealized := 0.0
		for _, attempt := range accountAttempts {
			accountRequested += attempt.requestedAmount
			accountRealized += attempt.realizedAmount
		}
		accountRequested = roundCents(accountRequested)
		accountRealized = roundCents(accountRealized)
		accountShortfall := accountRequested - accountRealized
		accountShortfallAmount := 0.0
		if accountShortfall > fiEpsilon {
			accountShortfallAmount = roundCents(accountShortfall)
		}
		failingAccountAttempts := []withdrawalAttempt{}
		for _, attempt := range accountAttempts {
			if movementUnfulfilled(attempt.requestedAmount, attempt.realizedAmount) > fiEpsilon {
				failingAccountAttempts = append(failingAccountAttempts, attempt)
			}
		}
		accounts = append(accounts, map[string]any{
			"accountId":       accountID,
			"requestedAmount": accountRequested,
			"realizedAmount":  accountRealized,
			"shortfallAmount": accountShortfallAmount,
			"constraints":     constraintsToJSON(countConstraints(failingAccountAttempts)),
		})
	}

	var firstShortfall map[string]any
	if len(firstAttempts) > 0 {
		firstShortfallAmount := 0.0
		if firstRequested-firstRealized > fiEpsilon {
			firstShortfallAmount = roundCents(firstRequested - firstRealized)
		}
		constraintTypes := []string{}
		seenTypes := map[string]bool{}
		relatedFirst := []string{}
		for _, attempt := range firstAttempts {
			for _, constraint := range attempt.bindingConstraints {
				if !seenTypes[constraint.Type] {
					seenTypes[constraint.Type] = true
					constraintTypes = append(constraintTypes, constraint.Type)
				}
				relatedFirst = append(relatedFirst, constraintAccountIDs(constraint)...)
			}
			if attempt.accountID != nil {
				relatedFirst = append(relatedFirst, *attempt.accountID)
			}
		}
		firstShortfall = map[string]any{
			"date":              dates[0],
			"requestedAmount":   firstRequested,
			"realizedAmount":    firstRealized,
			"shortfallAmount":   firstShortfallAmount,
			"constraints":       uniqueSortedStrings(constraintTypes),
			"relatedAccountIds": uniqueSortedStrings(relatedFirst),
		}
	}

	failingForConstraints := failingAttempts
	return &FIWithdrawalSummary{
		RequestedAmount:          requestedRounded,
		RealizedAmount:           realizedRounded,
		ShortfallAmount:          shortfallAmount,
		FirstShortfallDate:       firstShortfallDate,
		LastShortfallDate:        lastShortfallDate,
		ShortfallOccurrenceCount: len(dates),
		Constraints:              constraintsToJSON(countConstraints(failingForConstraints)),
		RelatedAccountIDs:        relatedAccountIDs,
		Accounts:                 accounts,
		FirstShortfall:           firstShortfall,
	}
}

func (s *FIWithdrawalSummary) toJSON() map[string]any {
	return map[string]any{
		"requestedAmount":          s.RequestedAmount,
		"realizedAmount":           s.RealizedAmount,
		"shortfallAmount":          s.ShortfallAmount,
		"firstShortfallDate":       s.FirstShortfallDate,
		"lastShortfallDate":        s.LastShortfallDate,
		"shortfallOccurrenceCount": s.ShortfallOccurrenceCount,
		"constraints":              s.Constraints,
		"relatedAccountIds":        s.RelatedAccountIDs,
		"accounts":                 s.Accounts,
		"firstShortfall":           s.FirstShortfall,
	}
}

func (o *FIRunOutcome) toJSON() types.JsonValue {
	payload := map[string]any{
		"candidateDate":      o.CandidateDate,
		"status":             o.Status,
		"minimumNetWorthMet": o.MinimumNetWorthMet,
		"initialCoverageMet": o.InitialCoverageMet,
		"cycleEstablished":   o.CycleEstablished,
	}
	if o.Status == "summary" {
		payload["simulationAttempted"] = o.SimulationAttempted
		payload["firstShortfallDate"] = o.FirstShortfallDate
		return payload
	}
	payload["expensesFullyCovered"] = o.ExpensesFullyCovered
	payload["hadWithdrawalShortfall"] = o.HadWithdrawalShortfall
	payload["startingSelectedAssetBalance"] = o.StartingSelectedAssetBalance
	payload["endingSelectedAssetBalance"] = o.EndingSelectedAssetBalance
	payload["startingRealSelectedAssetBalance"] = o.StartingRealSelectedAssetBalance
	payload["endingRealSelectedAssetBalance"] = o.EndingRealSelectedAssetBalance
	payload["principalReplenished"] = o.PrincipalReplenished
	if o.Withdrawals != nil {
		payload["withdrawals"] = o.Withdrawals.toJSON()
	} else {
		payload["withdrawals"] = emptyWithdrawalsJSON()
	}
	payload["balanceTrajectory"] = o.BalanceTrajectory
	return payload
}

func emptyWithdrawalsJSON() map[string]any {
	return summarizeWithdrawals(nil).toJSON()
}

func (r *FIAnalysisResult) ToJSON() types.JsonValue {
	rows := make([]types.JsonValue, len(r.Rows))
	for i, row := range r.Rows {
		contributions := make([]types.JsonValue, len(row.AssetContributions))
		for j, contribution := range row.AssetContributions {
			contributions[j] = map[string]any{
				"accountId":                contribution.AccountID,
				"balance":                  contribution.Balance,
				"withdrawalRate":           contribution.WithdrawalRate,
				"annualWithdrawalCapacity": contribution.AnnualWithdrawalCapacity,
			}
		}
		rows[i] = map[string]any{
			"date":                     row.Date,
			"netWorth":                 row.NetWorth,
			"minimumNetWorth":          row.MinimumNetWorth,
			"minimumNetWorthMet":       row.MinimumNetWorthMet,
			"annualDirectIncome":       row.AnnualDirectIncome,
			"assetContributions":       contributions,
			"selectedAssetBalance":     row.SelectedAssetBalance,
			"annualWithdrawalCapacity": row.AnnualWithdrawalCapacity,
			"totalAnnualCapacity":      row.TotalAnnualCapacity,
			"annualExpenseTarget":      row.AnnualExpenseTarget,
			"coverageRatio":            row.CoverageRatio,
			"isCovered":                row.IsCovered,
			"isEligible":               row.IsEligible,
		}
	}
	outcomes := make([]types.JsonValue, len(r.RunOutcomes))
	for i, outcome := range r.RunOutcomes {
		outcomes[i] = outcome.toJSON()
	}
	milestones := map[string]any{}
	if r.Milestones.FirstCoverageDate != nil {
		milestones["firstCoverageDate"] = *r.Milestones.FirstCoverageDate
	} else {
		milestones["firstCoverageDate"] = nil
	}
	if r.Milestones.FirstSelfSustainingDate != nil {
		milestones["firstSelfSustainingDate"] = *r.Milestones.FirstSelfSustainingDate
	} else {
		milestones["firstSelfSustainingDate"] = nil
	}
	return map[string]any{
		"rows":        rows,
		"runOutcomes": outcomes,
		"milestones":  milestones,
	}
}

// SelectFIOutcomeIndex picks the detailed-rerun candidate.
func SelectFIOutcomeIndex(outcomes []*FIRunOutcome) int {
	successfulIndex := -1
	for index, outcome := range outcomes {
		if outcome.CycleEstablished {
			successfulIndex = index
			break
		}
	}
	if successfulIndex >= 0 {
		return successfulIndex
	}
	for index := len(outcomes) - 1; index >= 0; index-- {
		if outcomes[index].Status != "ineligible" {
			return index
		}
	}
	return len(outcomes) - 1
}
