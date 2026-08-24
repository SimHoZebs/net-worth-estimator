package domain

import (
	"fmt"
	"math"
	"sort"

	"github.com/simhozebs/net-worth-estimator/backend/internal/types"
)

// Financial independence evaluation ported from evaluation/financialIndependence.ts.

const fiEpsilon = FIShortfallTolerance

// FIRow is one candidate-date analysis row.
type FIRow struct {
	Date                     IsoDate               `json:"date"`
	NetWorth                 float64               `json:"netWorth"`
	MinimumNetWorth          float64               `json:"minimumNetWorth"`
	MinimumNetWorthMet       bool                  `json:"minimumNetWorthMet"`
	AnnualDirectIncome       float64               `json:"annualDirectIncome"`
	AssetContributions       []FIAssetContribution `json:"assetContributions"`
	SelectedAssetBalance     float64               `json:"selectedAssetBalance"`
	AnnualWithdrawalCapacity float64               `json:"annualWithdrawalCapacity"`
	TotalAnnualCapacity      float64               `json:"totalAnnualCapacity"`
	AnnualExpenseTarget      float64               `json:"annualExpenseTarget"`
	CoverageRatio            float64               `json:"coverageRatio"`
	IsCovered                bool                  `json:"isCovered"`
	IsEligible               bool                  `json:"isEligible"`
}

// FIAssetContribution is per-asset withdrawal capacity.
type FIAssetContribution struct {
	AccountID                string  `json:"accountId"`
	Balance                  float64 `json:"balance"`
	WithdrawalRate           float64 `json:"withdrawalRate"`
	AnnualWithdrawalCapacity float64 `json:"annualWithdrawalCapacity"`
}

type constraintCount struct {
	Type  string
	Count int
}

func constraintsToJSON(counts []constraintCount) []types.JsonValue {
	out := make([]types.JsonValue, len(counts))
	for i, c := range counts {
		out[i] = map[string]any{"type": c.Type, "count": c.Count}
	}
	return out
}

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

type withdrawalAttempt struct {
	date               IsoDate
	accountID          *string
	requestedAmount    float64
	realizedAmount     float64
	bindingConstraints []accountMovementConstraint
}

func movementUnfulfilled(requested, realized float64) float64 {
	return math.Max(0, requested-realized)
}

func roundCents(amount float64) float64 {
	return math.Round(amount*100) / 100
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

func uniqueSortedStrings(values []string) []string {
	seen := map[string]bool{}
	out := []string{}
	for _, value := range values {
		if !seen[value] {
			seen[value] = true
			out = append(out, value)
		}
	}
	return out
}

// FIWithdrawalSummary mirrors the TS shape.
type FIWithdrawalSummary struct {
	RequestedAmount          float64           `json:"requestedAmount"`
	RealizedAmount           float64           `json:"realizedAmount"`
	ShortfallAmount          float64           `json:"shortfallAmount"`
	FirstShortfallDate       *IsoDate          `json:"firstShortfallDate"`
	LastShortfallDate        *IsoDate          `json:"lastShortfallDate"`
	ShortfallOccurrenceCount int               `json:"shortfallOccurrenceCount"`
	Constraints              []types.JsonValue `json:"constraints"`
	RelatedAccountIDs        []string          `json:"relatedAccountIds"`
	Accounts                 []map[string]any  `json:"accounts"`
	FirstShortfall           map[string]any    `json:"firstShortfall"`
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

// FIRunOutcome is the tagged union of summary/detailed/ineligible outcomes.
type FIRunOutcome struct {
	CandidateDate                    IsoDate              `json:"candidateDate"`
	Status                           string               `json:"status"` // "summary" | "ineligible" | "evaluated"
	SimulationAttempted              bool                 `json:"simulationAttempted,omitempty"`
	MinimumNetWorthMet               bool                 `json:"minimumNetWorthMet"`
	InitialCoverageMet               bool                 `json:"initialCoverageMet"`
	ExpensesFullyCovered             bool                 `json:"expensesFullyCovered"`
	HadWithdrawalShortfall           bool                 `json:"hadWithdrawalShortfall"`
	StartingSelectedAssetBalance     float64              `json:"startingSelectedAssetBalance"`
	EndingSelectedAssetBalance       float64              `json:"endingSelectedAssetBalance"`
	StartingRealSelectedAssetBalance float64              `json:"startingRealSelectedAssetBalance"`
	EndingRealSelectedAssetBalance   float64              `json:"endingRealSelectedAssetBalance"`
	PrincipalReplenished             bool                 `json:"principalReplenished"`
	CycleEstablished                 bool                 `json:"cycleEstablished"`
	FirstShortfallDate               *IsoDate             `json:"firstShortfallDate,omitempty"`
	Withdrawals                      *FIWithdrawalSummary `json:"withdrawals,omitempty"`
	BalanceTrajectory                []map[string]any     `json:"balanceTrajectory,omitempty"`

	// internal for selection logic
	isEligible bool
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

// FIBalanceTrajectoryRow is one trajectory snapshot.
type FIBalanceTrajectoryRow struct {
	Date     IsoDate `json:"date"`
	Accounts []struct {
		AccountID string  `json:"accountId"`
		Balance   float64 `json:"balance"`
	} `json:"accounts"`
}

// FIAnalysisResult is the full deterministic FI result.
type FIAnalysisResult struct {
	Rows        []FIRow         `json:"rows"`
	RunOutcomes []*FIRunOutcome `json:"runOutcomes"`
	Milestones  struct {
		FirstCoverageDate       *IsoDate `json:"firstCoverageDate"`
		FirstSelfSustainingDate *IsoDate `json:"firstSelfSustainingDate"`
	} `json:"milestones"`
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

// BuildFICandidateDates returns canonical monthly candidate start dates.
func BuildFICandidateDates(projectionStartDate, projectionEndDate IsoDate, evaluationYears int) []IsoDate {
	dates := []IsoDate{}
	for month := 0; ; month++ {
		date := AddMonthsClamped(projectionStartDate, month)
		if AddYearsClamped(date, evaluationYears) > projectionEndDate {
			break
		}
		dates = append(dates, date)
	}
	return dates
}

func selectedAssetRates(plan *types.FIPlan) map[string]float64 {
	rates := map[string]float64{}
	for _, source := range plan.Sources {
		if source.Type != "asset" || !source.Included {
			continue
		}
		rate := plan.WithdrawalRate
		if source.WithdrawalRateOverride != nil {
			rate = *source.WithdrawalRateOverride
		}
		rates[source.AccountID] = rate
	}
	return rates
}

// selectedAssetRateOrder lists selected asset IDs in first-seen plan-source
// order, matching TS Map insertion semantics. FI withdrawal allocation and
// trajectory payloads iterate in this order; the remainder is absorbed by the
// last account, so ordering changes allocation pennies.
func selectedAssetRateOrder(plan *types.FIPlan, rates map[string]float64) []string {
	order := make([]string, 0, len(rates))
	seen := map[string]bool{}
	for _, source := range plan.Sources {
		if seen[source.AccountID] {
			continue
		}
		if _, ok := rates[source.AccountID]; !ok {
			continue
		}
		seen[source.AccountID] = true
		order = append(order, source.AccountID)
	}
	return order
}

func selectedCashflowIDs(plan *types.FIPlan) map[string]bool {
	ids := map[string]bool{}
	for _, source := range plan.Sources {
		if source.Type == "cashflow" && source.Included {
			ids[source.PostingID] = true
		}
	}
	return ids
}

func latestRowAtOrBefore(rows []types.ProjectionRow, date IsoDate) *types.ProjectionRow {
	low, high := 0, len(rows)-1
	var match *types.ProjectionRow
	for low <= high {
		middle := (low + high) / 2
		row := &rows[middle]
		if row.Date <= date {
			match = row
			low = middle + 1
		} else {
			high = middle - 1
		}
	}
	return match
}

func balancesAt(row *types.ProjectionRow, accounts []types.Account) map[string]float64 {
	balances := map[string]float64{}
	for _, account := range accounts {
		balances[account.ID] = 0
	}
	if row != nil {
		for _, snapshot := range row.AccountSnapshots {
			balances[snapshot.AccountID] = snapshot.Balance
		}
	}
	return balances
}

func balanceAt(row *types.ProjectionRow, accountID string) float64 {
	if row == nil {
		return 0
	}
	for _, snapshot := range row.AccountSnapshots {
		if snapshot.AccountID == accountID {
			return snapshot.Balance
		}
	}
	return 0
}

func expenseAt(plan *types.FIPlan, baselineDate, date IsoDate) float64 {
	years := math.Max(0, float64(DaysBetween(baselineDate, date))/365.2425)
	return plan.AnnualExpenseTarget * math.Pow(1+plan.AnnualExpenseGrowthRate, years)
}

func expenseBaselineDate(plan *types.FIPlan, projectionStartDate, candidateDate IsoDate) IsoDate {
	if plan.AnnualExpenseTargetBasis == types.ExpenseBasisProjectionStart {
		return projectionStartDate
	}
	return candidateDate
}

func realizedCashflowBetween(events []types.MovementEvent, cashflowIDs map[string]bool, startDate, endDate IsoDate) float64 {
	if len(cashflowIDs) == 0 {
		return 0
	}
	total := 0.0
	for index := range events {
		event := &events[index]
		if event.Date <= startDate {
			continue
		}
		if event.Date > endDate {
			break
		}
		if cashflowIDs[event.Origin.PostingID] {
			total += event.RealizedAmount
		}
	}
	return total
}

func realizedCashflowByMonth(events []types.MovementEvent, cashflowIDs map[string]bool, candidateDate IsoDate, monthCount int) []float64 {
	amounts := make([]float64, monthCount)
	if len(cashflowIDs) == 0 {
		return amounts
	}
	month := 0
	for index := range events {
		event := &events[index]
		if event.Date <= candidateDate {
			continue
		}
		for month < monthCount && event.Date > AddMonthsClamped(candidateDate, month+1) {
			month++
		}
		if month >= monthCount {
			break
		}
		if cashflowIDs[event.Origin.PostingID] {
			amounts[month] += event.RealizedAmount
		}
	}
	return amounts
}

func optimisticLaterYearWithdrawalCapacity(balances map[string]float64, assetRateOrder []string, assetRates map[string]float64, accountsByID map[string]types.Account) float64 {
	capacity := 0.0
	for _, accountID := range assetRateOrder {
		rate := assetRates[accountID]
		if rate == 0 {
			continue
		}
		account, ok := accountsByID[accountID]
		if !ok {
			continue
		}
		upperBalance := math.Max(balances[accountID], account.MaxBalanceValue())
		floorCapacity := math.Max(0, upperBalance-account.MinBalanceValue())
		rateCapacity := math.Max(0, upperBalance) * rate
		capacity += math.Min(floorCapacity, rateCapacity)
	}
	return capacity
}

type postingDisposition int

const (
	dispositionDisabled postingDisposition = iota
	dispositionObserveBasePath
	dispositionReplayInBranch
)

func classifyPostingDispositions(path *types.ProjectionPath, cashflowIDs, continuingIDs map[string]bool) map[string]postingDisposition {
	dispositions := map[string]postingDisposition{}
	for index := range path.EffectiveDocument.Postings {
		posting := &path.EffectiveDocument.Postings[index]
		switch {
		case cashflowIDs[posting.ID]:
			dispositions[posting.ID] = dispositionObserveBasePath
		case continuingIDs[posting.ID]:
			dispositions[posting.ID] = dispositionReplayInBranch
		default:
			dispositions[posting.ID] = dispositionDisabled
		}
	}
	return dispositions
}

func initializeBranchSimulationState(balances map[string]float64, events []types.MovementEvent, candidateDate IsoDate, startState *types.ProjectionPath) SimulationState {
	latest := make(map[string]float64, len(startState.ProjectionStartPostingState.LatestRealizedPostingAmounts))
	for id, amount := range startState.ProjectionStartPostingState.LatestRealizedPostingAmounts {
		latest[id] = amount
	}
	byYear := make(map[string]map[string]float64, len(startState.ProjectionStartPostingState.RealizedPostingAmountsByYear))
	for postingID, years := range startState.ProjectionStartPostingState.RealizedPostingAmountsByYear {
		yearMap := make(map[string]float64, len(years))
		for year, amount := range years {
			yearMap[year] = amount
		}
		byYear[postingID] = yearMap
	}
	for index := range events {
		event := &events[index]
		if event.Date > candidateDate {
			break
		}
		postingID := event.Origin.PostingID
		latest[postingID] = event.RealizedAmount
		yearMap, ok := byYear[postingID]
		if !ok {
			yearMap = map[string]float64{}
			byYear[postingID] = yearMap
		}
		yearMap[event.Date[:4]] += event.RealizedAmount
	}
	return SimulationState{
		Balances:                     balances,
		LatestRealizedPostingAmounts: latest,
		RealizedPostingAmountsByYear: byYear,
	}
}

type branchEventGroup struct {
	date        IsoDate
	occurrences []DatedPostingOccurrence
}

func applyBranchPostingEvents(events []branchEventGroup, baseRealizedByDateAndPosting map[string]float64, baseEventsByDateAndPosting map[string]*types.MovementEvent, dispositions map[string]postingDisposition, transitions *TransitionRuntime) (float64, error) {
	observedDirectIncome := 0.0
	for _, group := range events {
		sorted := make([]DatedPostingOccurrence, len(group.occurrences))
		copy(sorted, group.occurrences)
		sort.SliceStable(sorted, func(i, j int) bool {
			if sorted[i].Posting.Priority != sorted[j].Posting.Priority {
				return sorted[i].Posting.Priority < sorted[j].Posting.Priority
			}
			return sorted[i].Index < sorted[j].Index
		})
		for _, occurrence := range sorted {
			posting := occurrence.Posting
			disposition, ok := dispositions[posting.ID]
			if !ok || disposition == dispositionDisabled {
				continue
			}
			if disposition == dispositionObserveBasePath {
				key := fmt.Sprintf("%s:%s", group.date, posting.ID)
				realizedAmount := baseRealizedByDateAndPosting[key]
				baseEvent := baseEventsByDateAndPosting[key]
				if baseEvent != nil && baseEvent.Income != nil {
					for _, resolver := range baseEvent.Income.Resolvers {
						if resolver.DestinationAccountID == nil {
							continue
						}
						destinations := []string{*resolver.DestinationAccountID}
						if _, err := transitions.ExecuteGeneratedMovement(AccountMovementAction{
							SourceAccountID: nil,
							Destinations:    destinations,
							RequestedAmount: resolver.RealizedAmount,
						}); err != nil {
							return 0, fmt.Errorf("replay posting %q on %s: %w", posting.ID, group.date, err)
						}
						if resolver.EmployerMatchRealizedAmount > 0 {
							if _, err := transitions.ExecuteGeneratedMovement(AccountMovementAction{
								SourceAccountID: nil,
								Destinations:    destinations,
								RequestedAmount: resolver.EmployerMatchRealizedAmount,
							}); err != nil {
								return 0, fmt.Errorf("replay posting %q on %s: %w", posting.ID, group.date, err)
							}
						}
					}
				}
				transitions.ObservePosting(posting.ID, realizedAmount, group.date)
				observedDirectIncome += realizedAmount
				continue
			}
			if _, err := transitions.ExecutePosting(occurrence, group.date); err != nil {
				return 0, fmt.Errorf("replay posting %q on %s: %w", posting.ID, group.date, err)
			}
		}
	}
	return observedDirectIncome, nil
}

type cycleOutcome struct {
	runOutcome *FIRunOutcome
}

func evaluateCycle(path *types.ProjectionPath, plan *types.FIPlan, candidate *FIRow, monteCarloSample *types.MonteCarloSample, captureBalanceTrajectory, summaryOnly bool) (*FIRunOutcome, error) {
	if !candidate.IsEligible && !captureBalanceTrajectory {
		return &FIRunOutcome{
			CandidateDate:                    candidate.Date,
			Status:                           "ineligible",
			MinimumNetWorthMet:               candidate.MinimumNetWorthMet,
			InitialCoverageMet:               candidate.IsCovered,
			ExpensesFullyCovered:             false,
			HadWithdrawalShortfall:           false,
			StartingSelectedAssetBalance:     candidate.SelectedAssetBalance,
			EndingSelectedAssetBalance:       candidate.SelectedAssetBalance,
			StartingRealSelectedAssetBalance: candidate.SelectedAssetBalance,
			EndingRealSelectedAssetBalance:   candidate.SelectedAssetBalance,
			PrincipalReplenished:             false,
			CycleEstablished:                 false,
			Withdrawals:                      summarizeWithdrawals(nil),
			BalanceTrajectory:                []map[string]any{},
		}, nil
	}
	candidateRow := latestRowAtOrBefore(path.Rows, candidate.Date)
	assetRates := selectedAssetRates(plan)
	assetRateOrder := selectedAssetRateOrder(plan, assetRates)
	expenseBaseline := expenseBaselineDate(plan, path.ProjectionStartDate, candidate.Date)
	cashflowIDs := selectedCashflowIDs(plan)
	accountsByID := map[string]types.Account{}
	for _, account := range path.EffectiveDocument.Accounts {
		accountsByID[account.ID] = account
	}
	candidateBalances := balancesAt(candidateRow, path.EffectiveDocument.Accounts)

	if summaryOnly {
		monthCount := plan.EvaluationYears * 12
		minimumWithdrawals := MinimumAnnualWithdrawals(
			candidate.Date,
			plan.EvaluationYears,
			func(date IsoDate) float64 { return expenseAt(plan, expenseBaseline, date) },
			realizedCashflowByMonth(path.MovementEvents, cashflowIDs, candidate.Date, monthCount),
		)
		if HasInsufficientOptimisticWithdrawalCapacity(minimumWithdrawals, candidate.AnnualWithdrawalCapacity, optimisticLaterYearWithdrawalCapacity(candidateBalances, assetRateOrder, assetRates, accountsByID)) {
			return &FIRunOutcome{
				CandidateDate:       candidate.Date,
				Status:              "summary",
				SimulationAttempted: false,
				MinimumNetWorthMet:  candidate.MinimumNetWorthMet,
				InitialCoverageMet:  candidate.IsCovered,
				CycleEstablished:    false,
				FirstShortfallDate:  nil,
			}, nil
		}
	}

	startingSelectedAssetBalance := 0.0
	for _, accountID := range assetRateOrder {
		startingSelectedAssetBalance += math.Max(0, candidateBalances[accountID])
	}
	continuingIDs := map[string]bool{}
	for _, id := range plan.ContinuingPostingIDs {
		if !cashflowIDs[id] {
			continuingIDs[id] = true
		}
	}
	dispositions := classifyPostingDispositions(path, cashflowIDs, continuingIDs)
	branchPostings := []types.Posting{}
	for index := range path.EffectiveDocument.Postings {
		posting := &path.EffectiveDocument.Postings[index]
		if posting.Enabled && dispositions[posting.ID] != dispositionDisabled {
			branchPostings = append(branchPostings, *posting)
		}
	}
	baseRealizedByDateAndPosting := map[string]float64{}
	baseEventsByDateAndPosting := map[string]*types.MovementEvent{}
	for index := range path.MovementEvents {
		event := &path.MovementEvents[index]
		key := fmt.Sprintf("%s:%s", event.Date, event.Origin.PostingID)
		baseRealizedByDateAndPosting[key] = event.RealizedAmount
		baseEventsByDateAndPosting[key] = event
	}
	transitions, err := CreateTransitionRuntime(types.FinancialModel{
		Accounts: path.EffectiveDocument.Accounts,
		Postings: branchPostings,
	}, initializeBranchSimulationState(candidateBalances, path.MovementEvents, candidate.Date, path), path.ProjectionStartDate, monteCarloSample, path.IncomeData)
	if err != nil {
		return nil, err
	}
	balances := transitions.State.Balances
	selectedAccountIDs := assetRateOrder
	balanceTrajectoryRow := func(date IsoDate) map[string]any {
		accountsPayload := make([]types.JsonValue, 0, len(selectedAccountIDs))
		for _, accountID := range selectedAccountIDs {
			accountsPayload = append(accountsPayload, map[string]any{
				"accountId": accountID,
				"balance":   balances[accountID],
			})
		}
		return map[string]any{"date": date, "accounts": accountsPayload}
	}

	eventDates := map[string][]DatedPostingOccurrence{}
	cycleEnd := AddYearsClamped(candidate.Date, plan.EvaluationYears)
	AddOccurrences(branchPostings, eventDates, candidate.Date, cycleEnd, false)
	periods := make([]BehaviorPeriod, plan.EvaluationYears*12)
	for index := range periods {
		periods[index] = BehaviorPeriod{
			Index:     index,
			StartDate: AddMonthsClamped(candidate.Date, index),
			EndDate:   AddMonthsClamped(candidate.Date, index+1),
		}
	}
	eventsByPeriod := make([][]branchEventGroup, len(periods))
	groupDates := make([]string, 0, len(eventDates))
	for date := range eventDates {
		groupDates = append(groupDates, date)
	}
	sort.Slice(groupDates, func(i, j int) bool { return CompareIsoDates(groupDates[i], groupDates[j]) < 0 })
	periodIndex := 0
	for _, date := range groupDates {
		for periodIndex < len(periods) && date > periods[periodIndex].EndDate {
			periodIndex++
		}
		if periodIndex < len(periods) && date > periods[periodIndex].StartDate {
			eventsByPeriod[periodIndex] = append(eventsByPeriod[periodIndex], branchEventGroup{date: date, occurrences: eventDates[date]})
		}
	}

	type branchState struct {
		hadWithdrawalShortfall       bool
		firstShortfallDate           *IsoDate
		withdrawalAttempts           []withdrawalAttempt
		remainingWithdrawalByAccount map[string]float64
		balanceTrajectory            []map[string]any
	}

	// First replay/transition error; surfaced after the behavior loop so a
	// failing posting becomes an evaluation diagnostic like in TypeScript.
	var branchErr error

	behavior := ReactiveBehavior[branchState, *FIRunOutcome]{
		Initialize: func() branchState {
			state := branchState{
				remainingWithdrawalByAccount: map[string]float64{},
				balanceTrajectory:            []map[string]any{},
			}
			if captureBalanceTrajectory {
				state.balanceTrajectory = append(state.balanceTrajectory, balanceTrajectoryRow(candidate.Date))
			}
			return state
		},
		React: func(state *branchState, period BehaviorPeriod) {
			if period.Index%12 == 0 {
				state.remainingWithdrawalByAccount = map[string]float64{}
				for _, accountID := range assetRateOrder {
					rate := assetRates[accountID]
					state.remainingWithdrawalByAccount[accountID] = math.Max(0, balances[accountID]) * rate
				}
			}
			directIncome, err := applyBranchPostingEvents(eventsByPeriod[period.Index], baseRealizedByDateAndPosting, baseEventsByDateAndPosting, dispositions, transitions)
			if err != nil && branchErr == nil {
				branchErr = err
				return
			}
			if branchErr != nil {
				return
			}
			remainingExpense := maxFloat(0, expenseAt(plan, expenseBaseline, period.StartDate)/12-directIncome)
			type capacityEntry struct {
				accountID   string
				actionLimit float64
				capacity    float64
			}
			capacities := make([]capacityEntry, 0, len(assetRates))
			for _, accountID := range assetRateOrder {
				accountLimit := GetWithdrawableAmount(balances, accountsByID, accountID)
				actionLimit := math.Min(math.Max(0, balances[accountID]), state.remainingWithdrawalByAccount[accountID])
				capacities = append(capacities, capacityEntry{accountID: accountID, actionLimit: actionLimit, capacity: math.Min(accountLimit, actionLimit)})
			}
			totalCapacity := 0.0
			for _, entry := range capacities {
				totalCapacity += entry.capacity
			}
			requestedExpense := remainingExpense
			allocatedRequest := 0.0
			for index, entry := range capacities {
				var requestedAmount float64
				if index == len(capacities)-1 {
					requestedAmount = requestedExpense - allocatedRequest
				} else if totalCapacity > 0 {
					requestedAmount = requestedExpense * (entry.capacity / totalCapacity)
				} else {
					requestedAmount = requestedExpense / float64(len(capacities))
				}
				allocatedRequest += requestedAmount
				actionLimitCopy := entry.actionLimit
				var balancesBefore map[string]float64
				if !summaryOnly {
					balancesBefore = SnapshotBalances(balances)
				}
				movement, _ := transitions.ExecuteGeneratedMovement(AccountMovementAction{
					SourceAccountID: &entry.accountID,
					Destinations:    nil,
					RequestedAmount: requestedAmount,
					LimitRemaining:  &actionLimitCopy,
				})
				if balancesBefore != nil {
					constraints := ClassifyMovementConstraints(movementConstraintInput{
						SourceAccountID: &entry.accountID,
						Destinations:    nil,
						RequestedAmount: requestedAmount,
						RealizedAmount:  movement.Result.RealizedAmount,
						BalancesBefore:  balancesBefore,
						AccountsByID:    accountsByID,
						LimitRemaining:  &actionLimitCopy,
					})
					attemptDate := period.StartDate
					state.withdrawalAttempts = append(state.withdrawalAttempts, withdrawalAttempt{
						date:               attemptDate,
						accountID:          &entry.accountID,
						requestedAmount:    requestedAmount,
						realizedAmount:     movement.Result.RealizedAmount,
						bindingConstraints: constraints,
					})
				}
				state.remainingWithdrawalByAccount[entry.accountID] = math.Max(0, state.remainingWithdrawalByAccount[entry.accountID]-movement.Result.RealizedAmount)
				remainingExpense -= movement.Result.RealizedAmount
			}
			if len(capacities) == 0 && requestedExpense > fiEpsilon {
				zeroLimit := 0.0
				var balancesBefore map[string]float64
				if !summaryOnly {
					balancesBefore = SnapshotBalances(balances)
				}
				movement, _ := transitions.ExecuteGeneratedMovement(AccountMovementAction{
					SourceAccountID: nil,
					Destinations:    nil,
					RequestedAmount: requestedExpense,
					LimitRemaining:  &zeroLimit,
				})
				if balancesBefore != nil {
					constraints := ClassifyMovementConstraints(movementConstraintInput{
						SourceAccountID: nil,
						Destinations:    nil,
						RequestedAmount: requestedExpense,
						RealizedAmount:  movement.Result.RealizedAmount,
						BalancesBefore:  balancesBefore,
						AccountsByID:    accountsByID,
						LimitRemaining:  &zeroLimit,
					})
					attemptDate := period.StartDate
					state.withdrawalAttempts = append(state.withdrawalAttempts, withdrawalAttempt{
						date:               attemptDate,
						accountID:          nil,
						requestedAmount:    requestedExpense,
						realizedAmount:     movement.Result.RealizedAmount,
						bindingConstraints: constraints,
					})
				}
			}
			if remainingExpense > fiEpsilon {
				state.hadWithdrawalShortfall = true
				if state.firstShortfallDate == nil {
					date := period.StartDate
					state.firstShortfallDate = &date
				}
			}
			if captureBalanceTrajectory {
				state.balanceTrajectory = append(state.balanceTrajectory, balanceTrajectoryRow(period.EndDate))
			}
		},
		ShouldStop: func(state *branchState, period BehaviorPeriod) bool {
			return branchErr != nil || (summaryOnly && state.hadWithdrawalShortfall)
		},
		Finish: func(state *branchState) *FIRunOutcome {
			if summaryOnly && state.hadWithdrawalShortfall {
				return &FIRunOutcome{
					CandidateDate:       candidate.Date,
					Status:              "summary",
					SimulationAttempted: true,
					MinimumNetWorthMet:  true,
					InitialCoverageMet:  true,
					CycleEstablished:    false,
					FirstShortfallDate:  state.firstShortfallDate,
				}
			}
			endingSelectedAssetBalance := 0.0
			for _, accountID := range selectedAccountIDs {
				endingSelectedAssetBalance += math.Max(0, balances[accountID])
			}
			inflationFactor := math.Pow(1+plan.AnnualExpenseGrowthRate, float64(plan.EvaluationYears))
			endingRealSelectedAssetBalance := endingSelectedAssetBalance / inflationFactor
			principalReplenished := false
			switch plan.PrincipalPolicy {
			case types.PrincipalAllowDrawdown:
				principalReplenished = true
			case types.PrincipalPreserveNominal:
				principalReplenished = endingSelectedAssetBalance+fiEpsilon >= startingSelectedAssetBalance
			case types.PrincipalPreserveReal:
				principalReplenished = endingRealSelectedAssetBalance+fiEpsilon >= startingSelectedAssetBalance
			}
			cycleEstablished := candidate.IsEligible && !state.hadWithdrawalShortfall && principalReplenished
			if summaryOnly {
				return &FIRunOutcome{
					CandidateDate:       candidate.Date,
					Status:              "summary",
					SimulationAttempted: true,
					MinimumNetWorthMet:  true,
					InitialCoverageMet:  true,
					CycleEstablished:    cycleEstablished,
					FirstShortfallDate:  nil,
				}
			}
			status := "ineligible"
			if candidate.IsEligible {
				status = "evaluated"
			}
			return &FIRunOutcome{
				CandidateDate:                    candidate.Date,
				Status:                           status,
				MinimumNetWorthMet:               candidate.MinimumNetWorthMet,
				InitialCoverageMet:               candidate.IsCovered,
				ExpensesFullyCovered:             !state.hadWithdrawalShortfall,
				HadWithdrawalShortfall:           state.hadWithdrawalShortfall,
				StartingSelectedAssetBalance:     startingSelectedAssetBalance,
				EndingSelectedAssetBalance:       endingSelectedAssetBalance,
				StartingRealSelectedAssetBalance: startingSelectedAssetBalance,
				EndingRealSelectedAssetBalance:   endingRealSelectedAssetBalance,
				PrincipalReplenished:             principalReplenished,
				CycleEstablished:                 cycleEstablished,
				Withdrawals:                      summarizeWithdrawals(state.withdrawalAttempts),
				BalanceTrajectory:                state.balanceTrajectory,
			}
		},
	}
	outcome := RunReactiveBehavior(periods, behavior)
	if branchErr != nil {
		return nil, branchErr
	}
	outcome.isEligible = candidate.IsEligible
	return outcome, nil
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

// EvaluateFinancialIndependence runs the deterministic FI analysis.
func EvaluateFinancialIndependence(path *types.ProjectionPath, plan *types.FIPlan, monteCarloSample *types.MonteCarloSample, candidateDates []IsoDate, detailLevel string) (*FIAnalysisResult, error) {
	assetRates := selectedAssetRates(plan)
	assetRateOrder := selectedAssetRateOrder(plan, assetRates)
	cashflowIDs := selectedCashflowIDs(plan)
	requestedDates := candidateDates
	if requestedDates == nil {
		requestedDates = BuildFICandidateDates(path.ProjectionStartDate, path.ProjectionEndDate, plan.EvaluationYears)
	}
	unique := map[IsoDate]bool{}
	filtered := []IsoDate{}
	for _, date := range requestedDates {
		if unique[date] {
			continue
		}
		unique[date] = true
		if date >= path.ProjectionStartDate && AddYearsClamped(date, plan.EvaluationYears) <= path.ProjectionEndDate {
			filtered = append(filtered, date)
		}
	}
	sort.Slice(filtered, func(i, j int) bool { return CompareIsoDates(filtered[i], filtered[j]) < 0 })

	result := &FIAnalysisResult{}
	for _, date := range filtered {
		row := latestRowAtOrBefore(path.Rows, date)
		annualDirectIncome := realizedCashflowBetween(path.MovementEvents, cashflowIDs, date, AddYearsClamped(date, 1))
		analysisRow := FIRow{Date: date}
		analysisRow.MinimumNetWorth = plan.MinimumNetWorth
		for _, accountID := range assetRateOrder {
			rate := assetRates[accountID]
			balance := math.Max(0, balanceAt(row, accountID))
			analysisRow.AssetContributions = append(analysisRow.AssetContributions, FIAssetContribution{
				AccountID:                accountID,
				Balance:                  balance,
				WithdrawalRate:           rate,
				AnnualWithdrawalCapacity: balance * rate,
			})
		}
		selectedAssetBalance := 0.0
		annualWithdrawalCapacity := 0.0
		for _, contribution := range analysisRow.AssetContributions {
			selectedAssetBalance += contribution.Balance
			annualWithdrawalCapacity += contribution.AnnualWithdrawalCapacity
		}
		analysisRow.SelectedAssetBalance = selectedAssetBalance
		analysisRow.AnnualWithdrawalCapacity = annualWithdrawalCapacity
		analysisRow.AnnualDirectIncome = annualDirectIncome
		analysisRow.AnnualExpenseTarget = expenseAt(plan, expenseBaselineDate(plan, path.ProjectionStartDate, date), date)
		analysisRow.TotalAnnualCapacity = annualDirectIncome + annualWithdrawalCapacity
		if analysisRow.AnnualExpenseTarget > 0 {
			analysisRow.CoverageRatio = analysisRow.TotalAnnualCapacity / analysisRow.AnnualExpenseTarget
		}
		netWorth := 0.0
		if row != nil {
			netWorth = row.NetWorth
		}
		analysisRow.NetWorth = netWorth
		analysisRow.MinimumNetWorthMet = netWorth >= plan.MinimumNetWorth
		analysisRow.IsCovered = analysisRow.AnnualExpenseTarget > 0 && analysisRow.CoverageRatio >= 1
		analysisRow.IsEligible = analysisRow.MinimumNetWorthMet && analysisRow.IsCovered
		result.Rows = append(result.Rows, analysisRow)
	}

	for index := range result.Rows {
		candidate := &result.Rows[index]
		outcome, err := evaluateCycle(path, plan, candidate, monteCarloSample, false, true)
		if err != nil {
			return nil, fmt.Errorf("fi.cycle.summary: %w", err)
		}
		result.RunOutcomes = append(result.RunOutcomes, outcome)
		if outcome.CycleEstablished {
			break
		}
	}
	if detailLevel != "summary" {
		selectedIndex := SelectFIOutcomeIndex(result.RunOutcomes)
		if selectedIndex >= 0 && selectedIndex < len(result.Rows) {
			candidate := &result.Rows[selectedIndex]
			outcome, err := evaluateCycle(path, plan, candidate, monteCarloSample, monteCarloSample == nil, false)
			if err != nil {
				return nil, fmt.Errorf("fi.cycle.detailed: %w", err)
			}
			result.RunOutcomes[selectedIndex] = outcome
		}
	}

	for index := range result.Rows {
		row := &result.Rows[index]
		if row.IsCovered {
			date := row.Date
			result.Milestones.FirstCoverageDate = &date
			break
		}
	}
	for _, outcome := range result.RunOutcomes {
		if outcome.CycleEstablished {
			date := outcome.CandidateDate
			result.Milestones.FirstSelfSustainingDate = &date
			break
		}
	}
	return result, nil
}

// AvailableFIPlan filters sources to existing accounts/postings.
func AvailableFIPlan(path *types.ProjectionPath, config *types.FIPlan) *types.FIPlan {
	accountIDs := map[string]bool{}
	for _, account := range path.EffectiveDocument.Accounts {
		accountIDs[account.ID] = true
	}
	postingIDs := map[string]bool{}
	for _, posting := range path.EffectiveDocument.Postings {
		postingIDs[posting.ID] = true
	}
	filtered := *config
	filtered.Sources = []types.FISource{}
	for _, source := range config.Sources {
		if source.Type == "asset" {
			if accountIDs[source.AccountID] {
				filtered.Sources = append(filtered.Sources, source)
			}
		} else if postingIDs[source.PostingID] {
			filtered.Sources = append(filtered.Sources, source)
		}
	}
	filtered.ContinuingPostingIDs = []string{}
	for _, id := range config.ContinuingPostingIDs {
		if postingIDs[id] {
			filtered.ContinuingPostingIDs = append(filtered.ContinuingPostingIDs, id)
		}
	}
	return &filtered
}

type fiAccumulator struct {
	candidateDates        []IsoDate
	coverageRatios        [][]float64
	cycleSuccessCounts    []int
	requiredConfidence    float64
	successfulRunCount    int
	checkedCandidateCount int
	evaluatedCycleCount   int
	runCount              int
}

// FIProbabilisticResult mirrors the stochastic finalize output.
type FIProbabilisticResult struct {
	FiCycleSuccessProbability float64  `json:"fiCycleSuccessProbability"`
	MedianCoverageDate        *IsoDate `json:"medianCoverageDate"`
	SelfSustainingDate        *IsoDate `json:"selfSustainingDate"`
	SelfSustainingProbability *float64 `json:"selfSustainingProbability"`
}

func medianValue(values []float64) float64 {
	if len(values) == 0 {
		return 0
	}
	sorted := make([]float64, len(values))
	copy(sorted, values)
	sort.Float64s(sorted)
	middle := len(sorted) / 2
	if len(sorted)%2 == 0 {
		return (sorted[middle-1] + sorted[middle]) / 2
	}
	return sorted[middle]
}

var financialIndependenceDefinition = &EvaluationDefinition{
	Type:  types.EvaluationTypeFinancialIndependence,
	Label: "Financial independence",

	ValidateConfig: ValidateFIPlanConfig,
	ParseConfig: func(config any) (any, error) {
		parsed, err := ParseFIPlan(config)
		if err != nil {
			return nil, err
		}
		return parsed, nil
	},

	DescribeStochasticWork: func(ctx *EvaluationContext, config any) *EvaluationWorkloadPlan {
		typed := config.(types.FIPlan)
		candidateCount := len(BuildFICandidateDates(ctx.Path.ProjectionStartDate, ctx.Path.ProjectionEndDate, typed.EvaluationYears))
		plan := &EvaluationWorkloadPlan{
			UnitsPerRun:         candidateCount,
			UnitLabel:           "monthly start dates",
			UnitAction:          "checked",
			IntensiveUnitLabel:  "candidate sustainability cycles",
			IntensiveUnitAction: "attempted",
		}
		if candidateCount == 0 {
			plan.Description = fmt.Sprintf("No complete %d-year FI test fits in this projection horizon.", typed.EvaluationYears)
		}
		return plan
	},

	DiagnoseConfig: func(ctx *EvaluationContext, config any) []types.EvaluationDiagnostic {
		typed := config.(types.FIPlan)
		accountIDs := map[string]bool{}
		for _, account := range ctx.Path.EffectiveDocument.Accounts {
			accountIDs[account.ID] = true
		}
		postingIDs := map[string]bool{}
		for _, posting := range ctx.Path.EffectiveDocument.Postings {
			postingIDs[posting.ID] = true
		}
		diagnostics := []types.EvaluationDiagnostic{}
		for _, source := range typed.Sources {
			if !source.Included {
				continue
			}
			var missing bool
			if source.Type == "asset" {
				missing = !accountIDs[source.AccountID]
			} else {
				missing = !postingIDs[source.PostingID]
			}
			if !missing {
				continue
			}
			diagnostic := types.EvaluationDiagnostic{
				Code:     "missing-financial-independence-source",
				Severity: "warning",
				Message:  "An enabled FI source is unavailable and was ignored.",
			}
			if source.Type == "asset" {
				diagnostic.RelatedAccountIDs = []string{source.AccountID}
			} else {
				diagnostic.RelatedPostingIDs = []string{source.PostingID}
			}
			diagnostics = append(diagnostics, diagnostic)
		}
		return diagnostics
	},

	EvaluatePath: func(ctx *EvaluationContext, config any) (PathResult, error) {
		typed := config.(types.FIPlan)
		available := AvailableFIPlan(ctx.Path, &typed)
		return EvaluateFinancialIndependence(ctx.Path, available, ctx.MonteCarloSample, nil, ctx.DetailLevel)
	},

	CreateAccumulator: func(config any, deterministic PathResult) (Accumulator, error) {
		typed := config.(types.FIPlan)
		analysis := deterministic.(*FIAnalysisResult)
		acc := &fiAccumulator{
			candidateDates:     make([]IsoDate, len(analysis.Rows)),
			coverageRatios:     make([][]float64, len(analysis.Rows)),
			cycleSuccessCounts: make([]int, len(analysis.Rows)),
			requiredConfidence: typed.RequiredConfidence,
		}
		for index, row := range analysis.Rows {
			acc.candidateDates[index] = row.Date
			acc.coverageRatios[index] = []float64{}
		}
		return acc, nil
	},
	Accumulate: func(accumulator Accumulator, pathResult PathResult) error {
		acc := accumulator.(*fiAccumulator)
		analysis := pathResult.(*FIAnalysisResult)
		if len(analysis.Rows) != len(acc.candidateDates) {
			return fmt.Errorf("FI evaluation returned an inconsistent candidate count.")
		}
		for index, row := range analysis.Rows {
			if row.Date != acc.candidateDates[index] {
				return fmt.Errorf("FI evaluation returned an inconsistent candidate schedule.")
			}
			acc.coverageRatios[index] = append(acc.coverageRatios[index], row.CoverageRatio)
		}
		acc.checkedCandidateCount += len(analysis.RunOutcomes)
		for _, outcome := range analysis.RunOutcomes {
			if outcome.Status == "evaluated" || (outcome.Status == "summary" && outcome.SimulationAttempted) {
				acc.evaluatedCycleCount++
			}
		}
		firstSuccessIndex := -1
		for index, outcome := range analysis.RunOutcomes {
			if outcome.CycleEstablished {
				firstSuccessIndex = index
				break
			}
		}
		if firstSuccessIndex >= 0 {
			for index := firstSuccessIndex; index < len(acc.cycleSuccessCounts); index++ {
				acc.cycleSuccessCounts[index]++
			}
			acc.successfulRunCount++
		}
		acc.runCount++
		return nil
	},
	MeasureStochasticWork: func(accumulator Accumulator) *EvaluationWorkloadMeasurement {
		acc := accumulator.(*fiAccumulator)
		return &EvaluationWorkloadMeasurement{
			UnitsCompleted:          acc.checkedCandidateCount,
			IntensiveUnitsCompleted: acc.evaluatedCycleCount,
		}
	},
	Finalize: func(accumulator Accumulator, ctx *EvaluationFinalizeContext) (types.JsonValue, error) {
		acc := accumulator.(*fiAccumulator)
		var medianCoverageDate, selfSustainingDate *IsoDate
		var selfSustainingProbability *float64
		for index := 0; index < len(acc.candidateDates); index++ {
			if medianCoverageDate == nil && medianValue(acc.coverageRatios[index]) >= 1 {
				date := acc.candidateDates[index]
				medianCoverageDate = &date
			}
			probability := 0.0
			if acc.runCount > 0 {
				probability = float64(acc.cycleSuccessCounts[index]) / float64(acc.runCount)
			}
			if selfSustainingDate == nil && probability >= acc.requiredConfidence {
				date := acc.candidateDates[index]
				selfSustainingDate = &date
				selfSustainingProbability = &probability
			}
		}
		fiProbability := 0.0
		if acc.runCount > 0 {
			fiProbability = float64(acc.successfulRunCount) / float64(acc.runCount)
		}
		payload := map[string]any{
			"fiCycleSuccessProbability": fiProbability,
			"medianCoverageDate":        medianCoverageDate,
			"selfSustainingDate":        selfSustainingDate,
			"selfSustainingProbability": selfSustainingProbability,
		}
		return payload, nil
	},
	Status: func(deterministic PathResult, probabilistic types.JsonValue) types.EvaluationResultStatus {
		if probabilistic != nil {
			payload := probabilistic.(map[string]any)
			// The payload stores *IsoDate values; a nil pointer boxed in the
			// interface is not nil itself, so assert the concrete type.
			if date, ok := payload["selfSustainingDate"].(*IsoDate); ok && date != nil {
				return types.StatusSatisfied
			}
			return types.StatusNotSatisfied
		}
		if deterministic != nil {
			analysis := deterministic.(*FIAnalysisResult)
			if analysis.Milestones.FirstSelfSustainingDate != nil {
				return types.StatusSatisfied
			}
		}
		return types.StatusNotSatisfied
	},
}
