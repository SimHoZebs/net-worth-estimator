package domain

import (
	"fmt"
	"math"
	"sort"
	"strings"
)

// Salary estimation over detected payroll candidates. Go is the owner of this
// analysis.

// ---- Salary estimate ----

type PayrollCadence = string

type SalaryEstimate struct {
	PayerLabel                 string          `json:"payerLabel"`
	AccountID                  string          `json:"accountId"`
	Currency                   string          `json:"currency"`
	Cadence                    PayrollCadence  `json:"cadence"`
	TypicalNetDeposit          float64         `json:"typicalNetDeposit"`
	AnnualizedObservedNetPay   *map[string]any `json:"annualizedObservedNetPay"`
	IdentityEvidence           EvidenceSummary `json:"identityEvidence"`
	RegularPayEvidence         EvidenceSummary `json:"regularPayEvidence"`
	ObservationCount           int             `json:"observationCount"`
	ComparableObservationCount int             `json:"comparableObservationCount"`
	SupportingTransactionIDs   []string        `json:"supportingTransactionIds"`
	ExcludedTransactionIDs     []string        `json:"excludedTransactionIds"`
	Limitations                []string        `json:"limitations"`
}

type SalaryEstimateResult struct {
	Status   string          `json:"status"` // confirmed | provisional | unavailable
	Estimate *SalaryEstimate `json:"estimate"`
}

type amountCluster struct {
	included  []PayrollCandidateTransaction
	excluded  []PayrollCandidateTransaction
	ambiguous bool
}

func recurringAmountCluster(transactions []PayrollCandidateTransaction) amountCluster {
	core := make([]PayrollCandidateTransaction, len(transactions))
	copy(core, transactions)
	sort.SliceStable(core, func(i, j int) bool { return core[i].Amount < core[j].Amount })
	ambiguous := false
	for len(core) >= 4 {
		largestGap := 0.0
		largestGapIndex := -1
		for index := 1; index < len(core); index++ {
			gap := core[index].Amount - core[index-1].Amount
			if gap > largestGap {
				largestGap = gap
				largestGapIndex = index
			}
		}
		if largestGapIndex < 0 {
			break
		}
		amounts := make([]float64, len(core))
		for i, tx := range core {
			amounts[i] = tx.Amount
		}
		midpoint := medianOf(amounts)
		left := append([]PayrollCandidateTransaction{}, core[:largestGapIndex]...)
		right := append([]PayrollCandidateTransaction{}, core[largestGapIndex:]...)
		dominantSide := left
		if len(left) == 1 {
			dominantSide = right
		}
		dominantAmounts := make([]float64, len(dominantSide))
		for i, tx := range dominantSide {
			dominantAmounts[i] = tx.Amount
		}
		dominantMidpoint := medianOf(dominantAmounts)
		if largestGap > math.Max(dominantMidpoint*0.25, 1) && (len(left) == 1 || len(right) == 1) {
			if len(left) == 1 {
				core = right
			} else {
				core = left
			}
			continue
		}
		if len(left) >= 2 && len(right) >= 2 && largestGap > math.Max(midpoint*0.25, 1) {
			ambiguous = true
		}
		break
	}
	if ambiguous {
		return amountCluster{included: nil, excluded: transactions, ambiguous: true}
	}
	coreAmounts := make([]float64, len(core))
	for i, tx := range core {
		coreAmounts[i] = tx.Amount
	}
	midpoint := medianOf(coreAmounts)
	deviations := make([]float64, len(core))
	for i, tx := range core {
		deviations[i] = math.Abs(tx.Amount - midpoint)
	}
	mad := medianOf(deviations)
	threshold := math.Max(math.Max(midpoint*0.2, mad*3), 1)
	included := []PayrollCandidateTransaction{}
	excluded := []PayrollCandidateTransaction{}
	includedIDs := map[string]bool{}
	for _, tx := range core {
		if math.Abs(tx.Amount-midpoint) <= threshold {
			included = append(included, tx)
			includedIDs[tx.ID] = true
		}
	}
	for _, tx := range transactions {
		if !includedIDs[tx.ID] {
			excluded = append(excluded, tx)
		}
	}
	return amountCluster{included: included, excluded: excluded, ambiguous: false}
}

func weekdayModeRatio(transactions []PayrollCandidateTransaction) float64 {
	counts := map[int]int{}
	maxCount := 0
	for _, transaction := range transactions {
		weekday := int(MustParseIsoDate(transaction.BookedDate).Weekday())
		counts[weekday]++
		if counts[weekday] > maxCount {
			maxCount = counts[weekday]
		}
	}
	if maxCount == 0 {
		return 0
	}
	return float64(maxCount) / float64(len(transactions))
}

func daysInMonthOf(year, month int) int {
	isLeapYear := year%4 == 0 && (year%100 != 0 || year%400 == 0)
	lengths := [12]int{31, 28, 31, 30, 31, 30, 31, 31, 30, 31, 30, 31}
	if month == 2 && isLeapYear {
		return 29
	}
	if month >= 1 && month <= 12 {
		return lengths[month-1]
	}
	return 0
}

func twiceMonthlyCalendarPattern(transactions []PayrollCandidateTransaction) bool {
	descriptorsByMonth := map[string][]string{}
	observationsByMonth := map[string]int{}
	for _, transaction := range transactions {
		parts := strings.Split(transaction.BookedDate, "-")
		if len(parts) != 3 {
			return false
		}
		yearText, monthText, dayText := parts[0], parts[1], parts[2]
		year := atoiSafe(yearText)
		month := atoiSafe(monthText)
		day := atoiSafe(dayText)
		descriptor := dayText
		if day == daysInMonthOf(year, month) {
			descriptor = "last"
		}
		key := yearText + "-" + monthText
		observationsByMonth[key]++
		if !containsString(descriptorsByMonth[key], descriptor) {
			descriptorsByMonth[key] = append(descriptorsByMonth[key], descriptor)
		}
	}
	monthlyDescriptors := [][]string{}
	keys := make([]string, 0, len(descriptorsByMonth))
	for key := range descriptorsByMonth {
		keys = append(keys, key)
	}
	sort.Strings(keys)
	for _, key := range keys {
		monthlyDescriptors = append(monthlyDescriptors, descriptorsByMonth[key])
	}
	if len(monthlyDescriptors) < 2 {
		return false
	}
	for _, count := range observationsByMonth {
		if count != 2 {
			return false
		}
	}
	for _, descriptors := range monthlyDescriptors {
		if len(descriptors) != 2 {
			return false
		}
	}
	for index := 1; index < len(keys); index++ {
		previous := strings.Split(keys[index-1], "-")
		current := strings.Split(keys[index], "-")
		previousSerial := atoiSafe(previous[0])*12 + atoiSafe(previous[1])
		currentSerial := atoiSafe(current[0])*12 + atoiSafe(current[1])
		if currentSerial-previousSerial != 1 {
			return false
		}
	}
	for key, descriptors := range descriptorsByMonth {
		parts := strings.Split(key, "-")
		year := atoiSafe(parts[0])
		month := atoiSafe(parts[1])
		days := []int{}
		for _, descriptor := range descriptors {
			if descriptor == "last" {
				days = append(days, daysInMonthOf(year, month))
			} else {
				days = append(days, atoiSafe(descriptor))
			}
		}
		sort.Ints(days)
		if len(days) < 2 || days[1]-days[0] < 10 {
			return false
		}
	}
	signatures := map[string]bool{}
	firstSignature := ""
	firstSet := false
	for _, descriptors := range monthlyDescriptors {
		sortedDescriptors := append([]string{}, descriptors...)
		sort.Strings(sortedDescriptors)
		signature := strings.Join(sortedDescriptors, "/")
		signatures[signature] = true
		if !firstSet {
			firstSignature = signature
			firstSet = true
		}
	}
	return len(monthlyDescriptors) >= 2 && len(signatures) == 1 && firstSignature != ""
}

func monthlyCalendarPattern(transactions []PayrollCandidateTransaction) bool {
	descriptors := map[string]bool{}
	for _, transaction := range transactions {
		parts := strings.Split(transaction.BookedDate, "-")
		if len(parts) != 3 {
			return false
		}
		year := atoiSafe(parts[0])
		month := atoiSafe(parts[1])
		day := atoiSafe(parts[2])
		descriptor := parts[2]
		if day == daysInMonthOf(year, month) {
			descriptor = "last"
		}
		descriptors[descriptor] = true
	}
	return len(descriptors) == 1
}

func atoiSafe(value string) int {
	number := 0
	negative := false
	start := 0
	if start < len(value) && (value[start] == '-' || value[start] == '+') {
		negative = value[start] == '-'
		start++
	}
	for index := start; index < len(value); index++ {
		ch := value[index]
		if ch < '0' || ch > '9' {
			break
		}
		number = number*10 + int(ch-'0')
	}
	if negative {
		return -number
	}
	return number
}

type cadenceResult struct {
	cadence       PayrollCadence
	annualPeriods int
}

func classifyCadence(transactions []PayrollCandidateTransaction) *cadenceResult {
	sorted := make([]PayrollCandidateTransaction, len(transactions))
	copy(sorted, transactions)
	sort.SliceStable(sorted, func(i, j int) bool { return sorted[i].BookedDate < sorted[j].BookedDate })
	gaps := []float64{}
	for index := 1; index < len(sorted); index++ {
		gaps = append(gaps, float64(dayDifference(sorted[index-1].BookedDate, sorted[index].BookedDate)))
	}
	for _, gap := range gaps {
		if gap <= 0 {
			return nil
		}
	}
	typicalGap := medianOf(gaps)
	deviations := make([]float64, len(gaps))
	for i, gap := range gaps {
		deviations[i] = math.Abs(gap - typicalGap)
	}
	gapDeviation := medianOf(deviations)
	weekdayRatio := weekdayModeRatio(sorted)
	biweeklyLike := typicalGap >= 12 && typicalGap <= 16 && gapDeviation <= 3 &&
		weekdayRatio >= 0.75 && allInRange(gaps, 12, 16)
	calendarTwiceMonthly := twiceMonthlyCalendarPattern(sorted)
	if calendarTwiceMonthly && biweeklyLike {
		return nil
	}
	if calendarTwiceMonthly {
		return &cadenceResult{cadence: "twice-monthly", annualPeriods: 24}
	}
	if typicalGap >= 5 && typicalGap <= 9 && gapDeviation <= 2 &&
		weekdayRatio >= 0.75 && allInRange(gaps, 5, 9) {
		return &cadenceResult{cadence: "weekly", annualPeriods: 52}
	}
	if biweeklyLike {
		return &cadenceResult{cadence: "biweekly", annualPeriods: 26}
	}
	if typicalGap >= 25 && typicalGap <= 35 && gapDeviation <= 3 &&
		monthlyCalendarPattern(sorted) && allInRange(gaps, 25, 35) {
		return &cadenceResult{cadence: "monthly", annualPeriods: 12}
	}
	return nil
}

func allInRange(values []float64, low, high float64) bool {
	for _, value := range values {
		if value < low || value > high {
			return false
		}
	}
	return true
}

func candidateScore(candidate *PayrollCandidate) float64 {
	score := float64(strengthRank(candidate.IdentityEvidence.Strength)*10 +
		strengthRank(candidate.RegularityEvidence.Strength)*5)
	if candidate.Recurring {
		score += 2
	}
	txCount := len(candidate.Transactions)
	if txCount > 12 {
		txCount = 12
	}
	score += float64(txCount) / 12
	return score
}

func runSalaryEstimate(result *PayrollDetectionResult) (*SalaryEstimateResult, []AnalysisDiagnostic) {
	selectedCandidates := []*PayrollCandidate{}
	for index := range result.Candidates {
		candidate := &result.Candidates[index]
		if len(candidate.Transactions) >= 2 {
			selectedCandidates = append(selectedCandidates, candidate)
		}
	}
	sort.SliceStable(selectedCandidates, func(i, j int) bool {
		left, right := selectedCandidates[i], selectedCandidates[j]
		leftScore := candidateScore(left)
		rightScore := candidateScore(right)
		if rightScore != leftScore {
			return rightScore > leftScore
		}
		return left.Key < right.Key
	})

	unavailableWith := func(code, message string) (*SalaryEstimateResult, []AnalysisDiagnostic) {
		return &SalaryEstimateResult{Status: "unavailable", Estimate: nil}, []AnalysisDiagnostic{{
			Code: code, Severity: "warning", Message: message,
		}}
	}

	if len(selectedCandidates) == 0 {
		if len(result.Candidates) > 0 {
			return unavailableWith("salary.insufficient-history",
				"At least two comparable payroll deposits are required to show a provisional estimate.")
		}
		return unavailableWith("salary.no-recurring-payroll",
			"A net-pay estimate needs a recurring payroll deposit series.")
	}
	selected := selectedCandidates[0]

	rawTwiceMonthlyPattern := twiceMonthlyCalendarPattern(selected.Transactions)
	cluster := recurringAmountCluster(selected.Transactions)
	if cluster.ambiguous {
		return unavailableWith("salary.multimodal-deposits",
			"Payroll deposits have multiple materially different recurring amounts, so observed net pay is ambiguous.")
	}
	if len(cluster.included) < 2 {
		return unavailableWith("salary.insufficient-history",
			"At least two comparable payroll deposits are required to show a provisional estimate.")
	}
	cadence := classifyCadence(cluster.included)
	if cadence == nil {
		return unavailableWith("salary.ambiguous-cadence",
			"Payroll deposits were found, but their cadence is too irregular or ambiguous to estimate safely.")
	}
	if cadence.cadence == "twice-monthly" && !rawTwiceMonthlyPattern {
		return unavailableWith("salary.ambiguous-cadence",
			"An additional observed deposit makes the twice-monthly cadence ambiguous.")
	}
	amounts := make([]float64, len(cluster.included))
	for i, tx := range cluster.included {
		amounts[i] = tx.Amount
	}
	diagnostics := []AnalysisDiagnostic{}
	if len(cluster.excluded) > 0 {
		pluralSuffix := "s were"
		if len(cluster.excluded) == 1 {
			pluralSuffix = " was"
		}
		diagnostics = append(diagnostics, AnalysisDiagnostic{
			Code: "salary.off-cycle-payments-excluded", Severity: "info",
			Message: fmt.Sprintf("%d amount outlier%s excluded from the recurring-pay estimate.", len(cluster.excluded), pluralSuffix),
		})
	}
	typicalNetDeposit := medianOf(amounts)
	status := "provisional"
	if len(cluster.included) >= 3 {
		status = "confirmed"
	}
	evidenceStrength := StrengthWeak
	if status == "confirmed" {
		evidenceStrength = StrengthModerate
	}
	intervalMessage := "Only one observed interval supports this cadence; more history is needed."
	if status == "confirmed" {
		intervalMessage = fmt.Sprintf("%d observed intervals support a %s cadence.", len(cluster.included)-1, cadence.cadence)
	}
	comparableMessage := fmt.Sprintf("%d comparable deposit%s support the regular-pay estimate.",
		len(cluster.included), map[bool]string{true: "", false: "s"}[len(cluster.included) == 1])
	regularPayItems := []EvidenceItem{
		{
			Code: "regular-pay.comparable-count", Source: "behavioral", Strength: evidenceStrength,
			Message:        comparableMessage,
			TransactionIDs: idsOf(cluster.included),
		},
		{
			Code:     fmt.Sprintf("regular-pay.cadence.%s", cadence.cadence),
			Source:   "behavioral",
			Strength: evidenceStrength,
			Message:  intervalMessage,
		},
	}
	limitations := []string{}
	if status == "provisional" {
		limitations = append(limitations,
			"This is a per-deposit estimate only; annualization is withheld until more comparable history is available.")
	}
	if len(cluster.excluded) > 0 {
		regularPayItems = append(regularPayItems, EvidenceItem{
			Code: "regular-pay.variable-amount-candidate", Source: "behavioral", Strength: StrengthWeak,
			Message:        "An amount outlier was excluded from the regular-pay estimate; it is not classified as a bonus.",
			TransactionIDs: idsOf(cluster.excluded),
		})
		limitations = append(limitations,
			"Excluded amount candidates may be bonuses, raises, corrections, or other variable compensation.")
	}

	var annualized *map[string]any
	if status == "confirmed" {
		payload := map[string]any{
			"low":      quantileOf(amounts, 0.25) * float64(cadence.annualPeriods),
			"midpoint": typicalNetDeposit * float64(cadence.annualPeriods),
			"high":     quantileOf(amounts, 0.75) * float64(cadence.annualPeriods),
		}
		annualized = &payload
	}
	estimate := &SalaryEstimate{
		PayerLabel:                 selected.PayerLabel,
		AccountID:                  selected.AccountID,
		Currency:                   "USD",
		Cadence:                    cadence.cadence,
		TypicalNetDeposit:          typicalNetDeposit,
		AnnualizedObservedNetPay:   annualized,
		IdentityEvidence:           selected.IdentityEvidence,
		RegularPayEvidence:         EvidenceSummary{Strength: evidenceStrength, Items: regularPayItems},
		ObservationCount:           len(selected.Transactions),
		ComparableObservationCount: len(cluster.included),
		SupportingTransactionIDs:   idsOf(cluster.included),
		ExcludedTransactionIDs:     idsOf(cluster.excluded),
		Limitations:                limitations,
	}
	return &SalaryEstimateResult{Status: status, Estimate: estimate}, diagnostics
}
