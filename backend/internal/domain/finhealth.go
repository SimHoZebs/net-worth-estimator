package domain

import (
	"fmt"
	"math"
	"sort"

	"github.com/simhozebs/net-worth-estimator/backend/internal/types"
)

// Reusable financial-health evaluation metrics (FIN-03). This layer answers
// descriptive questions about recorded state: balances at the as-of cut
// plus realized one-time flows inside a lookback window. It never runs a
// projection and never touches the projection-goal evaluation registry: a
// health check describes what is saved, while a goal evaluation asks what
// a simulated future reaches. Shared measurements are reused directly:
// ComputeNetWorth, counterparty classification (IsExternalInflow /
// IsExternalOutflow), payment-terms minimums, and account bound sentinels.
//
// Every verdict is relative to the supplied FinancialHealthStandards. The
// defaults are adjustable guidelines, echoed back in each result, and must
// never be presented as universal requirements.

const finHealthWindowMonthsDivisor = 30.4375

// NormalizeFinancialHealthStandards clamps standards to a usable shape:
// finite non-negative numbers, a usable lookback window, and ordered
// meet/risk bands (meet is the stronger requirement).
func NormalizeFinancialHealthStandards(standards types.FinancialHealthStandards) types.FinancialHealthStandards {
	normalized := standards
	if normalized.LookbackDays < 7 {
		normalized.LookbackDays = 7
	}
	// Bounded so the calendar-month enumeration stays aligned with the
	// flow window it summarizes.
	if normalized.LookbackDays > 5*365 {
		normalized.LookbackDays = 5 * 365
	}
	if len(normalized.LiquidAccountKinds) == 0 {
		normalized.LiquidAccountKinds = []string{string(types.AccountKindCash)}
	}
	normalized.EmergencyMeetMonths = math.Max(0, finiteNonNegative(normalized.EmergencyMeetMonths, 0))
	normalized.EmergencyRiskMonths = math.Max(0, finiteNonNegative(normalized.EmergencyRiskMonths, 0))
	if normalized.EmergencyMeetMonths < normalized.EmergencyRiskMonths {
		normalized.EmergencyMeetMonths, normalized.EmergencyRiskMonths = normalized.EmergencyRiskMonths, normalized.EmergencyMeetMonths
	}
	normalized.CashFlowRiskRatio = finiteNonNegative(normalized.CashFlowRiskRatio, 0)
	// Meeting is fixed at a ratio of 1, so the risk edge clamps there too;
	// otherwise the at-risk band is unreachable.
	normalized.CashFlowRiskRatio = math.Min(1, normalized.CashFlowRiskRatio)
	normalized.DebtBurdenMeetRatio = finiteNonNegative(normalized.DebtBurdenMeetRatio, 0)
	normalized.DebtBurdenRiskRatio = finiteNonNegative(normalized.DebtBurdenRiskRatio, 0)
	if normalized.DebtBurdenMeetRatio > normalized.DebtBurdenRiskRatio {
		normalized.DebtBurdenMeetRatio, normalized.DebtBurdenRiskRatio = normalized.DebtBurdenRiskRatio, normalized.DebtBurdenMeetRatio
	}
	normalized.CarriedBalanceTolerance = finiteNonNegative(normalized.CarriedBalanceTolerance, 0)
	normalized.CarriedBalanceRiskAmount = finiteNonNegative(normalized.CarriedBalanceRiskAmount, 0)
	if normalized.CarriedBalanceTolerance > normalized.CarriedBalanceRiskAmount {
		normalized.CarriedBalanceTolerance, normalized.CarriedBalanceRiskAmount = normalized.CarriedBalanceRiskAmount, normalized.CarriedBalanceTolerance
	}
	normalized.SavingsRateMeet = finiteNonNegative(normalized.SavingsRateMeet, 0)
	normalized.UtilizationMeetRatio = finiteNonNegative(normalized.UtilizationMeetRatio, 0)
	normalized.UtilizationRiskRatio = finiteNonNegative(normalized.UtilizationRiskRatio, 0)
	if normalized.UtilizationMeetRatio > normalized.UtilizationRiskRatio {
		normalized.UtilizationMeetRatio, normalized.UtilizationRiskRatio = normalized.UtilizationRiskRatio, normalized.UtilizationMeetRatio
	}
	normalized.ConsistencyMeetCV = finiteNonNegative(normalized.ConsistencyMeetCV, 0)
	normalized.ConsistencyRiskCV = finiteNonNegative(normalized.ConsistencyRiskCV, 0)
	if normalized.ConsistencyMeetCV > normalized.ConsistencyRiskCV {
		normalized.ConsistencyMeetCV, normalized.ConsistencyRiskCV = normalized.ConsistencyRiskCV, normalized.ConsistencyMeetCV
	}
	return normalized
}

// finHealthFlow is one realized one-time flow inside the window.
type finHealthFlow struct {
	date      string
	postingID string
	amount    float64
	inflow    bool
}

// finHealthInputs is the shared descriptive state every check reads.
type finHealthInputs struct {
	model        *types.FinancialModel
	balances     map[string]float64
	inflows      []finHealthFlow
	outflows     []finHealthFlow
	inflowTotal  float64
	outflowTotal float64
	excludedIDs  []string
	considered   int
	resolved     int
	asOfDay      string
	windowStart  string
}

// finHealthResolvableAmount reports whether a descriptor resolves
// deterministically from its own literals. Live-balance and history
// providers (model-value, account-balance, terms-minimum, late-fee,
// balance-fee) read replay-time state the descriptive layer does not
// reconstruct, so those postings are excluded evidence instead of silently
// misresolved against as-of balances. occurrence-rate and growth-factor are
// deterministic for one-time postings (divisor 1, factor 1, base rate).
func finHealthResolvableAmount(amount types.PostingAmountResolution) bool {
	for _, binding := range amount.Inputs {
		if binding.Source == "literal" {
			continue
		}
		if binding.Source != "provider" {
			return false
		}
		switch binding.Provider {
		case "occurrence-rate", "growth-factor":
		default:
			return false
		}
	}
	return true
}

// collectFinHealthFlows extracts realized one-time flows dated inside
// [windowStart, asOfDay]. Internal transfers are out of scope for
// income/spending checks; pending, void, and disabled rows never moved
// balances and stay out. Amounts resolve through the same descriptor path
// as history replay, but only for stateless descriptors: stateful or
// otherwise unresolvable amounts are counted as excluded evidence instead
// of silently dropped or misresolved.
func collectFinHealthFlows(model *types.FinancialModel, balances map[string]float64, windowStart, asOfDay string) finHealthInputs {
	inputs := finHealthInputs{
		model:       model,
		balances:    balances,
		asOfDay:     asOfDay,
		windowStart: windowStart,
		excludedIDs: []string{},
	}
	if model == nil {
		return inputs
	}
	terms := PaymentTermsByAccount(model)
	for index := range model.Postings {
		posting := &model.Postings[index]
		if !posting.Enabled || posting.Pending || posting.Void {
			continue
		}
		day := postingDay(posting)
		if day == "" || CompareIsoDates(day, windowStart) < 0 || CompareIsoDates(day, asOfDay) > 0 {
			continue
		}
		isInflow := IsExternalInflow(posting)
		isOutflow := IsExternalOutflow(posting)
		if !isInflow && !isOutflow {
			continue
		}
		inputs.considered++
		if !finHealthResolvableAmount(posting.Amount) {
			inputs.excludedIDs = append(inputs.excludedIDs, posting.ID)
			continue
		}
		amount, err := ComputeRequestedAmount(
			DatedPostingOccurrence{Posting: posting, Index: index},
			day, map[string]float64{}, map[string]string{}, map[string]map[string]float64{},
			balances, terms, nil,
		)
		if err != nil || math.IsNaN(amount) || math.IsInf(amount, 0) {
			inputs.excludedIDs = append(inputs.excludedIDs, posting.ID)
			continue
		}
		inputs.resolved++
		flow := finHealthFlow{date: day, postingID: posting.ID, amount: amount, inflow: isInflow}
		if isInflow {
			// Inflow totals stay net of investment losses, matching the
			// projection path's classification of negative realized
			// amounts on sourceless postings.
			inputs.inflows = append(inputs.inflows, flow)
			inputs.inflowTotal += amount
		} else {
			flow.amount = math.Max(0, amount)
			inputs.outflows = append(inputs.outflows, flow)
			inputs.outflowTotal += flow.amount
		}
	}
	sort.Strings(inputs.excludedIDs)
	return inputs
}

// finHealthBand applies a meet/risk band. When higherIsBetter, values at or
// above meet are meeting and values at or above risk are at-risk.
func finHealthBand(value, meet, risk float64, higherIsBetter bool) types.FinancialHealthStatus {
	if higherIsBetter {
		switch {
		case value >= meet:
			return types.FinancialHealthMeeting
		case value >= risk:
			return types.FinancialHealthAtRisk
		default:
			return types.FinancialHealthNotMeeting
		}
	}
	switch {
	case value <= meet:
		return types.FinancialHealthMeeting
	case value <= risk:
		return types.FinancialHealthAtRisk
	default:
		return types.FinancialHealthNotMeeting
	}
}

func finHealthFloatPtr(value float64) *float64 { rounded := roundAmount(value); return &rounded }

func finHealthDatePtr(day string) *types.IsoDate {
	date := types.IsoDate(day)
	return &date
}

func finHealthInsufficient(checkID, summary string) types.FinancialHealthCheckResult {
	return types.FinancialHealthCheckResult{
		CheckID:     checkID,
		Status:      types.FinancialHealthInsufficientData,
		Summary:     summary,
		Input:       map[string]float64{},
		Calculation: "",
		Threshold:   map[string]float64{},
		Evidence:    []types.FinancialHealthEvidenceItem{},
	}
}

// EvaluateFinancialHealth computes the seven descriptive checks from the
// saved model and the current position at its as-of cut. It never simulates
// the future; FIN-04 (presentation) and FIN-05 (explainability) consume this
// report.
func EvaluateFinancialHealth(model *types.FinancialModel, position *types.CurrentPosition, standards types.FinancialHealthStandards) types.FinancialHealthReport {
	standards = NormalizeFinancialHealthStandards(standards)
	asOf := ""
	if position != nil {
		asOf = position.AsOfDate
	}
	_, cutDay, err := ParseAsOfCut(asOf)
	if err != nil || model == nil || position == nil {
		report := types.FinancialHealthReport{
			AsOfDate:  types.IsoDate(asOf),
			Standards: standards,
			Checks:    []types.FinancialHealthCheckResult{},
		}
		for _, checkID := range types.FinancialHealthCheckOrder {
			report.Checks = append(report.Checks, finHealthInsufficient(checkID, "No usable saved state at the as-of cut, so this check has insufficient data."))
		}
		return report
	}
	windowStart := FormatIsoDate(MustParseIsoDate(cutDay).AddDate(0, 0, -standards.LookbackDays))
	balances := make(map[string]float64, len(position.Accounts))
	for _, row := range position.Accounts {
		balances[row.AccountID] = row.Balance
	}
	inputs := collectFinHealthFlows(model, balances, windowStart, cutDay)
	windowMonths := float64(standards.LookbackDays) / finHealthWindowMonthsDivisor

	report := types.FinancialHealthReport{
		AsOfDate:    types.IsoDate(cutDay),
		WindowStart: types.IsoDate(windowStart),
		WindowEnd:   types.IsoDate(cutDay),
		Standards:   standards,
		Checks: []types.FinancialHealthCheckResult{
			evaluateEmergencyCoverage(&inputs, standards, windowMonths),
			evaluateCashFlowSustainability(&inputs, standards),
			evaluateDebtBurden(&inputs, standards, windowMonths),
			evaluateHighInterestDebt(&inputs, standards),
			evaluateSavingsRate(&inputs, standards),
			evaluateUtilization(&inputs, standards),
			evaluateSpendingConsistency(&inputs, standards),
		},
		FlowCoverage: types.FinancialHealthFlowCoverage{
			WindowPostings:   inputs.considered,
			ResolvedPostings: inputs.resolved,
			ExcludedPostings: len(inputs.excludedIDs),
			ExcludedIDs:      append([]string(nil), inputs.excludedIDs...),
			InflowTotal:      roundAmount(inputs.inflowTotal),
			OutflowTotal:     roundAmount(inputs.outflowTotal),
		},
	}
	return report
}

// evaluateEmergencyCoverage measures liquid reserves in months of average
// recorded outflow: coverage = reserve / (windowOutflow / windowMonths).
func evaluateEmergencyCoverage(inputs *finHealthInputs, standards types.FinancialHealthStandards, windowMonths float64) types.FinancialHealthCheckResult {
	const checkID = types.FinancialHealthCheckEmergencyCoverage
	liquid := map[string]bool{}
	for _, kind := range standards.LiquidAccountKinds {
		liquid[kind] = true
	}
	reserve := 0.0
	evidence := []types.FinancialHealthEvidenceItem{}
	liquidAccounts := 0
	for _, account := range inputs.model.Accounts {
		if !account.Enabled || !liquid[string(account.Kind)] {
			continue
		}
		liquidAccounts++
		balance := inputs.balances[account.ID]
		reserve += balance
		evidence = append(evidence, types.FinancialHealthEvidenceItem{
			Label:      account.Name,
			Detail:     "Balance at the as-of cut counts toward the spendable reserve.",
			Amount:     finHealthFloatPtr(balance),
			AccountIDs: []string{account.ID},
		})
	}
	monthlyOutflow := inputs.outflowTotal / windowMonths
	input := map[string]float64{
		"liquidReserve":  roundAmount(reserve),
		"monthlyOutflow": roundAmount(monthlyOutflow),
	}
	threshold := map[string]float64{
		"meetMonths": standards.EmergencyMeetMonths,
		"riskMonths": standards.EmergencyRiskMonths,
	}
	if liquidAccounts == 0 {
		result := finHealthInsufficient(checkID, "No enabled accounts of the configured liquid kinds, so reserve coverage has insufficient data.")
		result.Input, result.Threshold, result.Evidence = input, threshold, evidence
		return result
	}
	if monthlyOutflow <= 0 {
		result := finHealthInsufficient(checkID, "No recorded outflows in the window, so average monthly spending has insufficient data.")
		result.Input, result.Threshold, result.Evidence = input, threshold, evidence
		return result
	}
	coverage := reserve / monthlyOutflow
	status := finHealthBand(coverage, standards.EmergencyMeetMonths, standards.EmergencyRiskMonths, true)
	return types.FinancialHealthCheckResult{
		CheckID:     checkID,
		Status:      status,
		Summary:     fmt.Sprintf("Reserves cover %.1f months of recorded spending against the configured %.1f-month guideline.", coverage, standards.EmergencyMeetMonths),
		Value:       finHealthFloatPtr(coverage),
		Input:       input,
		Calculation: "coverageMonths = liquidReserve / (windowOutflow / windowMonths)",
		Threshold:   threshold,
		Evidence:    evidence,
	}
}

// evaluateCashFlowSustainability compares realized inflow to realized
// outflow over the window: ratio = inflow / outflow.
func evaluateCashFlowSustainability(inputs *finHealthInputs, standards types.FinancialHealthStandards) types.FinancialHealthCheckResult {
	const checkID = types.FinancialHealthCheckCashFlowSustainability
	input := map[string]float64{
		"windowInflow":  roundAmount(inputs.inflowTotal),
		"windowOutflow": roundAmount(inputs.outflowTotal),
	}
	threshold := map[string]float64{"riskRatio": standards.CashFlowRiskRatio, "meetRatio": 1}
	evidence := []types.FinancialHealthEvidenceItem{
		{Label: "Recorded inflows", Detail: "Resolved external inflows dated in the window, net of investment losses.", Amount: finHealthFloatPtr(inputs.inflowTotal)},
		{Label: "Recorded outflows", Detail: "Resolved external outflows dated in the window.", Amount: finHealthFloatPtr(inputs.outflowTotal)},
	}
	if len(inputs.excludedIDs) > 0 {
		evidence = append(evidence, types.FinancialHealthEvidenceItem{
			Label:      "Unresolvable amounts",
			Detail:     "Window postings whose amounts need replay-time state (live balances, realized history) or simulation context and are excluded from both totals.",
			PostingIDs: append([]string(nil), inputs.excludedIDs...),
		})
	}
	if inputs.inflowTotal <= 0 && inputs.outflowTotal <= 0 {
		result := finHealthInsufficient(checkID, "No resolved inflows or outflows in the window, so cash flow has insufficient data.")
		result.Input, result.Threshold, result.Evidence = input, threshold, evidence
		return result
	}
	if inputs.outflowTotal <= 0 {
		return types.FinancialHealthCheckResult{
			CheckID:     checkID,
			Status:      types.FinancialHealthMeeting,
			Summary:     "Recorded inflows with no recorded outflows in the window meet the configured cash-flow guideline.",
			Input:       input,
			Calculation: "sustainabilityRatio = windowInflow / windowOutflow",
			Threshold:   threshold,
			Evidence:    evidence,
		}
	}
	ratio := inputs.inflowTotal / inputs.outflowTotal
	return types.FinancialHealthCheckResult{
		CheckID:     checkID,
		Status:      finHealthBand(ratio, 1, standards.CashFlowRiskRatio, true),
		Summary:     fmt.Sprintf("Recorded inflows are %.0f%% of recorded outflows against the configured break-even guideline.", ratio*100),
		Value:       finHealthFloatPtr(ratio),
		Input:       input,
		Calculation: "sustainabilityRatio = windowInflow / windowOutflow",
		Threshold:   threshold,
		Evidence:    evidence,
	}
}

// evaluateDebtBurden compares required monthly minimums from payment terms
// against average monthly inflow: burden = minimums / monthlyInflow.
func evaluateDebtBurden(inputs *finHealthInputs, standards types.FinancialHealthStandards, windowMonths float64) types.FinancialHealthCheckResult {
	const checkID = types.FinancialHealthCheckDebtBurden
	terms := PaymentTermsByAccount(inputs.model)
	minimums := 0.0
	evidence := []types.FinancialHealthEvidenceItem{}
	debtAccounts := 0
	for _, account := range inputs.model.Accounts {
		if !account.Enabled || account.Kind != types.AccountKindDebt {
			continue
		}
		debtAccounts++
		carried := math.Max(0, -inputs.balances[account.ID])
		minimum := 0.0
		if term, ok := terms[account.ID]; ok && carried > 0 {
			minimum = termsMinimum(term, -carried)
		}
		minimums += minimum
		evidence = append(evidence, types.FinancialHealthEvidenceItem{
			Label:      account.Name,
			Detail:     "Required minimum from payment terms against the carried balance at the cut.",
			Amount:     finHealthFloatPtr(minimum),
			AccountIDs: []string{account.ID},
		})
	}
	monthlyInflow := inputs.inflowTotal / windowMonths
	input := map[string]float64{
		"monthlyMinimums": roundAmount(minimums),
		"monthlyInflow":   roundAmount(monthlyInflow),
	}
	threshold := map[string]float64{
		"meetRatio": standards.DebtBurdenMeetRatio,
		"riskRatio": standards.DebtBurdenRiskRatio,
	}
	if debtAccounts == 0 || minimums <= 0 {
		return types.FinancialHealthCheckResult{
			CheckID:     checkID,
			Status:      types.FinancialHealthMeeting,
			Summary:     "No required debt minimums at the cut meet the configured debt-burden guideline.",
			Value:       finHealthFloatPtr(0),
			Input:       input,
			Calculation: "burden = monthlyMinimums / monthlyInflow",
			Threshold:   threshold,
			Evidence:    evidence,
		}
	}
	if monthlyInflow <= 0 {
		result := finHealthInsufficient(checkID, "Required minimums exist but no recorded inflows in the window, so debt burden has insufficient data.")
		result.Input, result.Threshold, result.Evidence = input, threshold, evidence
		return result
	}
	burden := minimums / monthlyInflow
	return types.FinancialHealthCheckResult{
		CheckID:     checkID,
		Status:      finHealthBand(burden, standards.DebtBurdenMeetRatio, standards.DebtBurdenRiskRatio, false),
		Summary:     fmt.Sprintf("Required minimums take %.0f%% of average monthly inflow against the configured %.0f%% guideline.", burden*100, standards.DebtBurdenMeetRatio*100),
		Value:       finHealthFloatPtr(burden),
		Input:       input,
		Calculation: "burden = monthlyMinimums / monthlyInflow",
		Threshold:   threshold,
		Evidence:    evidence,
	}
}

// evaluateHighInterestDebt flags carried revolving balances. The model
// carries no rate data, so this is an explicitly labeled proxy: carried
// balances on enabled debt accounts stand in for interest-bearing debt
// until a rate field exists.
func evaluateHighInterestDebt(inputs *finHealthInputs, standards types.FinancialHealthStandards) types.FinancialHealthCheckResult {
	const checkID = types.FinancialHealthCheckHighInterestDebt
	terms := PaymentTermsByAccount(inputs.model)
	carried := 0.0
	evidence := []types.FinancialHealthEvidenceItem{
		{Label: "Rate-data limitation", Detail: "The model carries no interest-rate data, so carried revolving balances stand in as the proxy for interest-bearing debt."},
	}
	debtAccounts := 0
	for _, account := range inputs.model.Accounts {
		if !account.Enabled || account.Kind != types.AccountKindDebt {
			continue
		}
		debtAccounts++
		balance := math.Max(0, -inputs.balances[account.ID])
		carried += balance
		detail := "Carried balance at the cut."
		if _, ok := terms[account.ID]; ok {
			detail = "Carried revolving balance with payment terms at the cut."
		}
		evidence = append(evidence, types.FinancialHealthEvidenceItem{
			Label:      account.Name,
			Detail:     detail,
			Amount:     finHealthFloatPtr(balance),
			AccountIDs: []string{account.ID},
		})
	}
	input := map[string]float64{"carriedBalance": roundAmount(carried)}
	threshold := map[string]float64{
		"tolerance":  standards.CarriedBalanceTolerance,
		"riskAmount": standards.CarriedBalanceRiskAmount,
	}
	if debtAccounts == 0 {
		return types.FinancialHealthCheckResult{
			CheckID:     checkID,
			Status:      types.FinancialHealthMeeting,
			Summary:     "No enabled debt accounts at the cut meet the configured high-interest-debt guideline.",
			Value:       finHealthFloatPtr(0),
			Input:       input,
			Calculation: "carriedBalance = sum over enabled debt accounts of max(0, -balance)",
			Threshold:   threshold,
			Evidence:    evidence,
		}
	}
	return types.FinancialHealthCheckResult{
		CheckID:     checkID,
		Status:      finHealthBand(carried, standards.CarriedBalanceTolerance, standards.CarriedBalanceRiskAmount, false),
		Summary:     fmt.Sprintf("Carried balances total %.0f against the configured %.0f tolerance (rate data unavailable; carried balances are the proxy).", carried, standards.CarriedBalanceTolerance),
		Value:       finHealthFloatPtr(carried),
		Input:       input,
		Calculation: "carriedBalance = sum over enabled debt accounts of max(0, -balance)",
		Threshold:   threshold,
		Evidence:    evidence,
	}
}

// evaluateSavingsRate measures (inflow-outflow)/inflow over the window.
func evaluateSavingsRate(inputs *finHealthInputs, standards types.FinancialHealthStandards) types.FinancialHealthCheckResult {
	const checkID = types.FinancialHealthCheckSavingsRate
	input := map[string]float64{
		"windowInflow":  roundAmount(inputs.inflowTotal),
		"windowOutflow": roundAmount(inputs.outflowTotal),
	}
	threshold := map[string]float64{"meetRate": standards.SavingsRateMeet, "riskFloor": 0}
	if inputs.inflowTotal <= 0 {
		result := finHealthInsufficient(checkID, "No recorded inflows in the window, so the savings rate has insufficient data.")
		result.Input, result.Threshold = input, threshold
		return result
	}
	rate := (inputs.inflowTotal - inputs.outflowTotal) / inputs.inflowTotal
	status := types.FinancialHealthNotMeeting
	switch {
	case rate >= standards.SavingsRateMeet:
		status = types.FinancialHealthMeeting
	case rate >= 0:
		status = types.FinancialHealthAtRisk
	}
	return types.FinancialHealthCheckResult{
		CheckID:     checkID,
		Status:      status,
		Summary:     fmt.Sprintf("The recorded savings rate is %.0f%% against the configured %.0f%% guideline.", rate*100, standards.SavingsRateMeet*100),
		Value:       finHealthFloatPtr(rate),
		Input:       input,
		Calculation: "savingsRate = (windowInflow - windowOutflow) / windowInflow",
		Threshold:   threshold,
		Evidence: []types.FinancialHealthEvidenceItem{
			{Label: "Recorded inflows", Detail: "Resolved external inflows dated in the window, net of investment losses.", Amount: finHealthFloatPtr(inputs.inflowTotal)},
			{Label: "Recorded outflows", Detail: "Resolved external outflows dated in the window.", Amount: finHealthFloatPtr(inputs.outflowTotal)},
		},
	}
}

// evaluateUtilization measures the limit-weighted drawn ratio: credit
// limits from debt-account floors (-minBalance) and caps from finite
// positive ceilings, reusing the bound sentinels behind withdrawable and
// headroom math.
func evaluateUtilization(inputs *finHealthInputs, standards types.FinancialHealthStandards) types.FinancialHealthCheckResult {
	const checkID = types.FinancialHealthCheckUtilization
	weighted, limitTotal := 0.0, 0.0
	evidence := []types.FinancialHealthEvidenceItem{}
	defined := 0
	for _, account := range inputs.model.Accounts {
		if !account.Enabled {
			continue
		}
		balance := inputs.balances[account.ID]
		if account.Kind == types.AccountKindDebt {
			floor := account.MinBalanceValue()
			if floor == types.NoFloor || floor >= 0 {
				continue
			}
			limit := -floor
			// Uncapped so over-limit breaches surface as ratios above 1.
			drawn := math.Max(0, -balance)
			defined++
			weighted += drawn
			limitTotal += limit
			evidence = append(evidence, types.FinancialHealthEvidenceItem{
				Label:      account.Name,
				Detail:     "Drawn credit against the floor-implied limit.",
				Amount:     finHealthFloatPtr(drawn / limit),
				AccountIDs: []string{account.ID},
			})
			continue
		}
		ceiling := account.MaxBalanceValue()
		if ceiling == types.NoCeiling || ceiling <= 0 || balance <= 0 {
			continue
		}
		used := math.Max(0, balance)
		defined++
		weighted += used
		limitTotal += ceiling
		evidence = append(evidence, types.FinancialHealthEvidenceItem{
			Label:      account.Name,
			Detail:     "Balance against the configured ceiling.",
			Amount:     finHealthFloatPtr(used / ceiling),
			AccountIDs: []string{account.ID},
		})
	}
	threshold := map[string]float64{
		"meetRatio": standards.UtilizationMeetRatio,
		"riskRatio": standards.UtilizationRiskRatio,
	}
	if defined == 0 || limitTotal <= 0 {
		result := finHealthInsufficient(checkID, "No enabled accounts define a usable limit (debt floors or positive ceilings), so utilization has insufficient data.")
		result.Threshold, result.Evidence = threshold, evidence
		result.Input = map[string]float64{}
		return result
	}
	ratio := weighted / limitTotal
	return types.FinancialHealthCheckResult{
		CheckID:     checkID,
		Status:      finHealthBand(ratio, standards.UtilizationMeetRatio, standards.UtilizationRiskRatio, false),
		Summary:     fmt.Sprintf("Limit-weighted utilization is %.0f%% against the configured %.0f%% guideline.", ratio*100, standards.UtilizationMeetRatio*100),
		Value:       finHealthFloatPtr(ratio),
		Input:       map[string]float64{"drawnTotal": roundAmount(weighted), "limitTotal": roundAmount(limitTotal)},
		Calculation: "utilization = sum(drawn) / sum(limits) over accounts with defined limits",
		Threshold:   threshold,
		Evidence:    evidence,
	}
}

// evaluateSpendingConsistency measures the coefficient of variation of
// monthly outflow across the calendar months intersecting the window:
// cv = stdev(monthlyOutflow) / mean(monthlyOutflow).
func evaluateSpendingConsistency(inputs *finHealthInputs, standards types.FinancialHealthStandards) types.FinancialHealthCheckResult {
	const checkID = types.FinancialHealthCheckSpendingConsistency
	months := finHealthWindowMonths(inputs.windowStart, inputs.asOfDay)
	buckets := make(map[string]float64, len(months))
	for _, month := range months {
		buckets[month] = 0
	}
	for _, flow := range inputs.outflows {
		month := flow.date[:7]
		if _, ok := buckets[month]; ok {
			buckets[month] += flow.amount
		}
	}
	values := make([]float64, 0, len(months))
	evidence := []types.FinancialHealthEvidenceItem{}
	for _, month := range months {
		values = append(values, buckets[month])
		date := types.IsoDate(month + "-01")
		evidence = append(evidence, types.FinancialHealthEvidenceItem{
			Label:  "Outflow in " + month,
			Detail: "Resolved external outflows dated in that calendar month.",
			Amount: finHealthFloatPtr(buckets[month]),
			Date:   &date,
		})
	}
	threshold := map[string]float64{
		"meetCV": standards.ConsistencyMeetCV,
		"riskCV": standards.ConsistencyRiskCV,
	}
	mean := 0.0
	for _, value := range values {
		mean += value
	}
	if len(values) > 0 {
		mean /= float64(len(values))
	}
	if len(values) < 3 || mean <= 0 {
		result := finHealthInsufficient(checkID, "Fewer than three window months or no recorded outflows, so spending consistency has insufficient data.")
		result.Threshold, result.Evidence = threshold, evidence
		result.Input = map[string]float64{"windowMonths": float64(len(values)), "meanMonthlyOutflow": roundAmount(mean)}
		return result
	}
	variance := 0.0
	for _, value := range values {
		variance += (value - mean) * (value - mean)
	}
	variance /= float64(len(values))
	cv := math.Sqrt(variance) / mean
	return types.FinancialHealthCheckResult{
		CheckID:     checkID,
		Status:      finHealthBand(cv, standards.ConsistencyMeetCV, standards.ConsistencyRiskCV, false),
		Summary:     fmt.Sprintf("Monthly outflow varies with a coefficient of %.2f against the configured %.2f guideline.", cv, standards.ConsistencyMeetCV),
		Value:       finHealthFloatPtr(cv),
		Input:       map[string]float64{"windowMonths": float64(len(values)), "meanMonthlyOutflow": roundAmount(mean)},
		Calculation: "cv = stdev(monthlyOutflow) / mean(monthlyOutflow) over window calendar months (edge months may be partial)",
		Threshold:   threshold,
		Evidence:    evidence,
	}
}

// finHealthWindowMonths lists the calendar months (YYYY-MM) intersecting
// [windowStart, asOfDay] in order.
func finHealthWindowMonths(windowStart, asOfDay string) []string {
	months := []string{}
	cursor := windowStart[:7]
	end := asOfDay[:7]
	for {
		months = append(months, cursor)
		if cursor >= end {
			break
		}
		cursor = AddMonthsClamped(cursor+"-01", 1)[:7]
		// 5-year lookbacks span at most ~61 months; the guard is safety only.
		if len(months) > 80 {
			break
		}
	}
	return months
}
