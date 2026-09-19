package domain

import (
	"fmt"
	"math"
	"sort"
)

// Payroll detection over classified postings. Go is the owner of this
// analysis.

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
