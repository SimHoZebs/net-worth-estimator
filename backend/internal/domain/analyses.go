package domain

import (
	"fmt"
	"math"
	"regexp"
	"sort"
	"strings"

	"github.com/simhozebs/net-worth-estimator/backend/internal/types"
)

// Analyses ported from src/lib/analysis/: posting observations, shared
// classification plan, payroll detection, and salary estimation.

// ---- Evidence ----

type EvidenceSource = string // source | lexical | rail | behavioral | user
type EvidenceStrength = string

const (
	StrengthWeak     = "weak"
	StrengthModerate = "moderate"
	StrengthStrong   = "strong"
)

type EvidenceItem struct {
	Code           string           `json:"code"`
	Source         EvidenceSource   `json:"source"`
	Strength       EvidenceStrength `json:"strength"`
	Message        string           `json:"message"`
	TransactionIDs []string         `json:"transactionIds,omitempty"`
}

type EvidenceSummary struct {
	Strength EvidenceStrength `json:"strength"`
	Items    []EvidenceItem   `json:"items"`
}

// ---- Posting observations ----

type PostingObservation struct {
	ID               string   `json:"id"`
	PostingID        string   `json:"postingId"`
	AccountID        string   `json:"accountId"`
	BookedDate       string   `json:"bookedDate"`
	Amount           *float64 `json:"amount"`
	Currency         string   `json:"currency"`
	Description      string   `json:"description"`
	CounterpartyName *string  `json:"counterpartyName"`
}

type PostingObservationDataset struct {
	Postings []PostingObservation `json:"postings"`
}

// BuildPostingObservationDataset derives observations from enabled once
// external-inflow postings.
func BuildPostingObservationDataset(document *types.FinancialModelDocument) *PostingObservationDataset {
	dataset := &PostingObservationDataset{Postings: []PostingObservation{}}
	for index := range document.Postings {
		posting := &document.Postings[index]
		if !posting.Enabled || posting.Frequency != types.FrequencyOnce ||
			posting.SourceAccountID != nil || len(posting.Destinations) == 0 {
			continue
		}
		var amount *float64
		if expression, ok := posting.Amount.Config["expression"]; ok && len(posting.Amount.Inputs) == 0 {
			if expressionText, isString := expression.(string); isString {
				resolved, err := ResolvePostingAmountDescriptor(posting.Amount, &AmountProviderContext{
					Balances:                     map[string]float64{},
					LatestRealizedPostingAmounts: map[string]float64{},
					RealizedPostingAmountsByYear: map[string]map[string]float64{},
					Date:                         posting.StartDate,
					OccurrenceRate:               0,
				})
				if err == nil && !math.IsNaN(resolved) && !math.IsInf(resolved, 0) {
					value := resolved
					amount = &value
				}
				_ = expressionText
			}
		}
		dataset.Postings = append(dataset.Postings, PostingObservation{
			ID:               posting.ID,
			PostingID:        posting.ID,
			AccountID:        posting.Destinations[0],
			BookedDate:       posting.StartDate,
			Amount:           amount,
			Currency:         "USD",
			Description:      posting.Label,
			CounterpartyName: nil,
		})
	}
	sort.SliceStable(dataset.Postings, func(i, j int) bool {
		if dataset.Postings[i].BookedDate != dataset.Postings[j].BookedDate {
			return dataset.Postings[i].BookedDate < dataset.Postings[j].BookedDate
		}
		return dataset.Postings[i].ID < dataset.Postings[j].ID
	})
	return dataset
}

// ---- Classifiers ----

type classificationValue struct {
	value    any
	evidence []EvidenceItem
}

type classifierFunc func(*PostingObservation) *classificationValue

type classifier struct {
	id       string
	classify classifierFunc
}

var payrollLanguagePattern = regexp.MustCompile(`(?i)\b(payroll|salary|paycheck|wages?|direct\s+dep(?:osit)?s?)\b`)
var railAchPattern = regexp.MustCompile(`(?i)\b(ach|ppd|ccd|direct\s+dep(?:osit)?s?)\b`)
var railCardPattern = regexp.MustCompile(`(?i)\b(card|visa|mastercard|debit)\b`)
var railCheckPattern = regexp.MustCompile(`(?i)\b(check|cheque)\b`)
var railWirePattern = regexp.MustCompile(`(?i)\b(wire|wire\s+transfer)\b`)

var genericPayerWords = map[string]bool{
	"ach": true, "credit": true, "deposit": true, "dep": true, "deposits": true,
	"direct": true, "paycheck": true, "payroll": true, "ppd": true,
	"salary": true, "wage": true, "wages": true, "id": true,
}

func normalizeText(value string) string {
	lowered := strings.ToLower(value)
	replacer := strings.NewReplacer(
		".", " ", ",", " ", "-", " ", "_", " ", "/", " ", "\\", " ", "(", " ", ")", " ",
		"[", " ", "]", " ", "{", " ", "}", " ", ":", " ", ";", " ", "'", " ", `"`, " ",
		"!", " ", "?", " ", "*", " ", "#", " ", "@", " ", "$", " ", "%", " ", "^", " ",
		"&", " ", "+", " ", "=", " ", "|", " ", "<", " ", ">", " ", "~", " ", "`", " ",
	)
	normalized := replacer.Replace(lowered)
	fields := strings.Fields(normalized)
	return strings.Join(fields, " ")
}

func meaningfulWords(value string) []string {
	out := []string{}
	for _, word := range strings.Split(normalizeText(value), " ") {
		if word == "" || isAllDigits(word) || genericPayerWords[word] {
			continue
		}
		out = append(out, word)
	}
	return out
}

func isAllDigits(word string) bool {
	for _, ch := range word {
		if ch < '0' || ch > '9' {
			return false
		}
	}
	return len(word) > 0
}

func payerDetails(transaction *PostingObservation) (identity, label string, hasIdentity bool) {
	counterpartyWords := []string{}
	if transaction.CounterpartyName != nil {
		counterpartyWords = meaningfulWords(*transaction.CounterpartyName)
	}
	descriptionWords := meaningfulWords(transaction.Description)
	identityWords := descriptionWords
	if len(counterpartyWords) > 0 {
		identityWords = counterpartyWords
	}
	if len(identityWords) > 0 {
		return strings.Join(identityWords, " "), strings.Join(identityWords, " "), true
	}
	labelValue := strings.TrimSpace(transaction.Description)
	return "", labelValue, false
}

func detectPaymentRail(text string) string {
	switch {
	case railAchPattern.MatchString(text):
		return "ach"
	case railCardPattern.MatchString(text):
		return "card"
	case railCheckPattern.MatchString(text):
		return "check"
	case railWirePattern.MatchString(text):
		return "wire"
	default:
		return "unknown"
	}
}

func payerClassifier() *classifier {
	return &classifier{id: "payer", classify: func(t *PostingObservation) *classificationValue {
		identity, label, hasIdentity := payerDetails(t)
		items := []EvidenceItem{}
		if hasIdentity {
			items = append(items, EvidenceItem{
				Code: "payer.identity", Source: "lexical", Strength: StrengthModerate,
				Message: fmt.Sprintf("Normalized payer identity: %s.", identity),
			})
		}
		return &classificationValue{value: map[string]any{
			"identity": boolPtrJSON(hasIdentity, identity),
			"label":    label,
		}, evidence: items}
	}}
}

func boolPtrJSON(condition bool, value string) any {
	if condition {
		return value
	}
	return nil
}

func payrollClassifier() *classifier {
	return &classifier{id: "payroll", classify: func(t *PostingObservation) *classificationValue {
		text := t.Description
		if t.CounterpartyName != nil {
			text += " " + *t.CounterpartyName
		}
		if t.Amount == nil || *t.Amount <= 0 || !payrollLanguagePattern.MatchString(text) {
			return nil
		}
		return &classificationValue{value: true, evidence: []EvidenceItem{{
			Code: "payroll.language", Source: "lexical", Strength: StrengthModerate,
			Message: "Payroll language was found in the transaction text.",
		}}}
	}}
}

func paymentRailClassifier() *classifier {
	return &classifier{id: "payment-rail", classify: func(t *PostingObservation) *classificationValue {
		text := t.Description
		if t.CounterpartyName != nil {
			text += " " + *t.CounterpartyName
		}
		rail := detectPaymentRail(text)
		evidence := []EvidenceItem{}
		if rail != "unknown" {
			evidence = append(evidence, EvidenceItem{
				Code:     fmt.Sprintf("payment-rail.%s", rail),
				Source:   "rail",
				Strength: StrengthWeak,
				Message:  fmt.Sprintf("Payment rail appears to be %s.", strings.ToUpper(rail)),
			})
		}
		return &classificationValue{value: rail, evidence: evidence}
	}}
}

// ClassifiedPosting pairs an observation with its matches by classifier id.
type ClassifiedPosting struct {
	Observation     *PostingObservation
	matches         map[string]*classificationValue
	classifierOrder []string
}

func (c *ClassifiedPosting) get(classifierID string) *classificationValue {
	return c.matches[classifierID]
}

func (c *ClassifiedPosting) evidenceFor(classifierIDs []string) []EvidenceItem {
	out := []EvidenceItem{}
	for _, id := range classifierIDs {
		if match, ok := c.matches[id]; ok {
			out = append(out, match.evidence...)
		}
	}
	return out
}

// RunClassification applies the shared plan once per posting.
func RunClassification(plan []*classifier, dataset *PostingObservationDataset) []*ClassifiedPosting {
	ids := make([]string, 0, len(plan))
	byID := map[string]classifierFunc{}
	for _, entry := range plan {
		ids = append(ids, entry.id)
		byID[entry.id] = entry.classify
	}
	sort.Strings(ids)
	out := make([]*ClassifiedPosting, 0, len(dataset.Postings))
	for index := range dataset.Postings {
		posting := &dataset.Postings[index]
		matches := map[string]*classificationValue{}
		for _, id := range ids {
			if match := byID[id](posting); match != nil {
				matches[id] = match
			}
		}
		out = append(out, &ClassifiedPosting{Observation: posting, matches: matches, classifierOrder: ids})
	}
	return out
}

// ---- Payroll detection ----

type PayrollCandidateTransaction struct {
	ID         string  `json:"id"`
	BookedDate string  `json:"bookedDate"`
	Amount     float64 `json:"amount"`
}

type PayrollCandidate struct {
	Key                string                        `json:"key"`
	AccountID          string                        `json:"accountId"`
	Currency           string                        `json:"currency"`
	PayerLabel         string                        `json:"payerLabel"`
	Transactions       []PayrollCandidateTransaction `json:"transactions"`
	IdentityEvidence   EvidenceSummary               `json:"identityEvidence"`
	RegularityEvidence EvidenceSummary               `json:"regularityEvidence"`
	Recurring          bool                          `json:"recurring"`
}

type PayrollDetectionResult struct {
	Candidates []PayrollCandidate `json:"candidates"`
}

func dayDifference(left, right string) int {
	return DaysBetween(left, right)
}

func medianOf(values []float64) float64 {
	sorted := make([]float64, len(values))
	copy(sorted, values)
	sort.Float64s(sorted)
	middle := len(sorted) / 2
	if len(sorted)%2 == 0 {
		return (sorted[middle-1] + sorted[middle]) / 2
	}
	return sorted[middle]
}

func strengthRank(strength EvidenceStrength) int {
	switch strength {
	case StrengthStrong:
		return 3
	case StrengthModerate:
		return 2
	default:
		return 1
	}
}

func runPayrollDetection(classified []*ClassifiedPosting, requirementIDs []string) (*PayrollDetectionResult, []AnalysisDiagnostic) {
	type group struct {
		accountID    string
		payerLabel   string
		transactions []PayrollCandidateTransaction
		evidence     []EvidenceItem
	}
	grouped := map[string]*group{}
	var keys []string

	for _, entry := range classified {
		transaction := entry.Observation
		if transaction.Amount == nil || *transaction.Amount <= 0 {
			continue
		}
		if entry.get("payroll") == nil {
			continue
		}
		payerMatch := entry.get("payer")
		if payerMatch == nil {
			continue
		}
		payerMap := payerMatch.value.(map[string]any)
		identityRaw := payerMap["identity"]
		label := payerMap["label"].(string)
		hasIdentity := identityRaw != nil
		identity := ""
		if hasIdentity {
			identity = identityRaw.(string)
		}
		classificationEvidence := entry.evidenceFor(requirementIDs)
		explicit := false
		hasLanguage := false
		for _, item := range classificationEvidence {
			if item.Code == "source.transaction-type" {
				explicit = true
			}
			if item.Code == "payroll.language" {
				hasLanguage = true
			}
		}
		if !explicit && (!hasLanguage || identity == "") {
			continue
		}
		payerKey := identity
		if !hasIdentity {
			payerKey = fmt.Sprintf("unidentified:%s", transaction.ID)
		}
		key := fmt.Sprintf("%s:USD:%s", transaction.AccountID, payerKey)
		entryGroup, ok := grouped[key]
		if !ok {
			entryGroup = &group{accountID: transaction.AccountID, payerLabel: label}
			grouped[key] = entryGroup
			keys = append(keys, key)
		}
		entryGroup.transactions = append(entryGroup.transactions, PayrollCandidateTransaction{
			ID: transaction.ID, BookedDate: transaction.BookedDate, Amount: *transaction.Amount,
		})
		for _, item := range classificationEvidence {
			found := false
			for _, existing := range entryGroup.evidence {
				if existing.Code == item.Code {
					found = true
					break
				}
			}
			if !found {
				entryGroup.evidence = append(entryGroup.evidence, item)
			}
		}
	}

	candidates := []PayrollCandidate{}
	for _, key := range keys {
		entryGroup := grouped[key]
		transactions := make([]PayrollCandidateTransaction, len(entryGroup.transactions))
		copy(transactions, entryGroup.transactions)
		sort.SliceStable(transactions, func(i, j int) bool {
			if transactions[i].BookedDate != transactions[j].BookedDate {
				return transactions[i].BookedDate < transactions[j].BookedDate
			}
			return transactions[i].ID < transactions[j].ID
		})
		adjacentGaps := make([]float64, 0, len(transactions))
		for index := 1; index < len(transactions); index++ {
			adjacentGaps = append(adjacentGaps, float64(dayDifference(transactions[index-1].BookedDate, transactions[index].BookedDate)))
		}
		allPositive := true
		for _, gapValue := range adjacentGaps {
			if gapValue <= 0 {
				allPositive = false
				break
			}
		}
		var medianGap *float64
		if allPositive && len(adjacentGaps) > 0 {
			value := medianOf(adjacentGaps)
			medianGap = &value
		} else if len(transactions) > 1 && allPositive {
			value := medianOf(adjacentGaps)
			medianGap = &value
		}
		var gapTolerance *float64
		if medianGap != nil {
			value := math.Max(3, *medianGap*0.2)
			gapTolerance = &value
		}
		recurring := false
		if len(transactions) >= 3 && medianGap != nil && gapTolerance != nil &&
			*medianGap >= 5 && *medianGap <= 40 {
			allWithinTolerance := true
			for _, gapValue := range adjacentGaps {
				if math.Abs(gapValue-*medianGap) > *gapTolerance {
					allWithinTolerance = false
					break
				}
			}
			recurring = allWithinTolerance
		}
		hasExplicitSourceEvidence := false
		hasIdentityEvidenceCode := false
		hasLanguageEvidenceCode := false
		for _, item := range entryGroup.evidence {
			if item.Code == "source.transaction-type" {
				hasExplicitSourceEvidence = true
			}
			if item.Code == "payer.identity" {
				hasIdentityEvidenceCode = true
			}
			if item.Code == "payroll.language" {
				hasLanguageEvidenceCode = true
			}
		}
		if !hasExplicitSourceEvidence && len(transactions) < 3 {
			continue
		}
		identityStrength := StrengthWeak
		if hasExplicitSourceEvidence {
			identityStrength = StrengthStrong
		} else if hasIdentityEvidenceCode && hasLanguageEvidenceCode {
			identityStrength = StrengthModerate
		}
		recurrenceStrength := StrengthWeak
		if recurring {
			recurrenceStrength = StrengthModerate
			if len(transactions) >= 4 {
				recurrenceStrength = StrengthStrong
			}
		}
		message := "Deposit dates do not yet establish a consistent cadence."
		if recurring {
			message = fmt.Sprintf("%d deposits support a recurring cadence.", len(transactions))
		}
		transactionIDs := make([]string, len(transactions))
		for i, tx := range transactions {
			transactionIDs[i] = tx.ID
		}
		candidate := PayrollCandidate{
			Key:              key,
			AccountID:        entryGroup.accountID,
			Currency:         "USD",
			PayerLabel:       entryGroup.payerLabel,
			Transactions:     transactions,
			IdentityEvidence: EvidenceSummary{Strength: identityStrength, Items: entryGroup.evidence},
			RegularityEvidence: EvidenceSummary{Strength: recurrenceStrength, Items: []EvidenceItem{{
				Code:   map[bool]string{true: "payroll.recurrence", false: "payroll.irregular-cadence"}[recurring],
				Source: "behavioral", Strength: recurrenceStrength, Message: message,
				TransactionIDs: transactionIDs,
			}}},
			Recurring: recurring,
		}
		candidates = append(candidates, candidate)
	}

	sort.SliceStable(candidates, func(i, j int) bool {
		left, right := &candidates[i], &candidates[j]
		if strengthRank(right.IdentityEvidence.Strength) != strengthRank(left.IdentityEvidence.Strength) {
			return strengthRank(right.IdentityEvidence.Strength) < strengthRank(left.IdentityEvidence.Strength)
		}
		if strengthRank(right.RegularityEvidence.Strength) != strengthRank(left.RegularityEvidence.Strength) {
			return strengthRank(right.RegularityEvidence.Strength) < strengthRank(left.RegularityEvidence.Strength)
		}
		if len(right.Transactions) != len(left.Transactions) {
			return len(right.Transactions) < len(left.Transactions)
		}
		return left.Key < right.Key
	})

	diagnostics := []AnalysisDiagnostic{}
	if len(candidates) == 0 {
		diagnostics = append(diagnostics, AnalysisDiagnostic{
			Code: "payroll.none-detected", Severity: "info",
			Message: "No recurring payroll deposits were detected.",
		})
	}
	return &PayrollDetectionResult{Candidates: candidates}, diagnostics
}

// ---- Salary estimate ----

type AnalysisDiagnostic struct {
	Code     string `json:"code"`
	Severity string `json:"severity"`
	Message  string `json:"message"`
}

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

func quantileOf(values []float64, percentile float64) float64 {
	sorted := make([]float64, len(values))
	copy(sorted, values)
	sort.Float64s(sorted)
	if len(sorted) == 0 {
		return 0
	}
	index := float64(len(sorted)-1) * percentile
	lower := int(math.Floor(index))
	fraction := index - float64(lower)
	next := lower + 1
	if next > len(sorted)-1 {
		next = len(sorted) - 1
	}
	return sorted[lower] + fraction*(sorted[next]-sorted[lower])
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

func idsOf(transactions []PayrollCandidateTransaction) []string {
	out := make([]string, len(transactions))
	for i, tx := range transactions {
		out[i] = tx.ID
	}
	return out
}

// RunPostingAnalyses executes the composed analysis pipeline.
func RunPostingAnalyses(document *types.FinancialModelDocument) (map[string]any, error) {
	dataset := BuildPostingObservationDataset(requireEnabledDocument(document))
	requirementIDs := []string{"payer", "payroll", "payment-rail"}
	classified := RunClassification([]*classifier{
		payerClassifier(), payrollClassifier(), paymentRailClassifier(),
	}, dataset)
	detection, detectionDiagnostics := runPayrollDetection(classified, requirementIDs)
	estimate, estimateDiagnostics := runSalaryEstimate(detection)
	return map[string]any{
		"observations":     dataset,
		"classification":   map[string]any{"classified": summarizeClassification(classified)},
		"payrollDetection": map[string]any{"result": detection, "diagnostics": detectionDiagnostics},
		"salaryEstimate":   map[string]any{"result": estimate, "diagnostics": estimateDiagnostics},
	}, nil
}

func requireEnabledDocument(document *types.FinancialModelDocument) *types.FinancialModelDocument {
	// Observations derive from the effective enabled postings only.
	return document
}

func summarizeClassification(classified []*ClassifiedPosting) []map[string]any {
	out := make([]map[string]any, 0, len(classified))
	for _, entry := range classified {
		entryMap := map[string]any{
			"id": entry.Observation.ID,
		}
		classifications := map[string]any{}
		for _, id := range entry.classifierOrder {
			match := entry.get(id)
			if match == nil {
				classifications[id] = nil
			} else {
				classifications[id] = map[string]any{"value": match.value, "evidence": match.evidence}
			}
		}
		entryMap["classifications"] = classifications
		out = append(out, entryMap)
	}
	return out
}
