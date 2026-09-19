package domain

import (
	"fmt"
	"regexp"
	"sort"
	"strings"
)

// Shared posting-classification plan, applied once per observation. Go is the
// owner of these classifiers.

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
