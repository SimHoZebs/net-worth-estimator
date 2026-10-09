package domain

import (
	"github.com/simhozebs/net-worth-estimator/backend/internal/types"
)

// Rule expansion and claim suppression. Rules own repetition; postings own
// dated movements. Expansion is virtual: rule occurrences are synthesized at
// projection time and never stored. A synthesized instance carries the rule's
// ID, so all downstream ledgers (realized amounts, annual caps, movement
// origins, evaluation references) key on one stable identity per rule.

// DatedPostingOccurrence binds a posting to its declaration order. Rule is
// non-nil for rule-generated instances; DocPath is the validation-style path
// identifying the owning row (["postings", i] or ["recurrenceRules", i]).
type DatedPostingOccurrence struct {
	Posting *types.Posting
	Index   int
	Rule    *types.RecurrenceRule
	DocPath []any
}

// FrequencyDivisor converts annual rates to per-occurrence rates.
func FrequencyDivisor(frequency types.RecurrenceFrequency) int {
	switch frequency {
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

func advanceDate(date string, frequency types.RecurrenceFrequency, periodCount int) string {
	switch frequency {
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

// validScheduleFrequency reports whether a frequency expands. Unknown
// frequencies never reach expansion past validation, but expansion must
// still terminate on them: advanceDate returns unknown frequencies
// unchanged, which would otherwise loop forever.
func validScheduleFrequency(frequency types.RecurrenceFrequency) bool {
	switch frequency {
	case types.FrequencyDaily, types.FrequencyWeekly, types.FrequencyMonthly, types.FrequencyQuarterly, types.FrequencyAnnual:
		return true
	default:
		return false
	}
}

// RuleScheduleDates lists every scheduled date of a rule up to endDate
// (inclusive), unfiltered by projection windows. Validation uses it to check
// that a claim names a real scheduled occurrence.
func RuleScheduleDates(rule *types.RecurrenceRule, endDate string) []string {
	dates := []string{}
	if !validScheduleFrequency(rule.Frequency) {
		return dates
	}
	effectiveEnd := endDate
	if rule.EndDate != nil && CompareIsoDates(*rule.EndDate, endDate) < 0 {
		effectiveEnd = *rule.EndDate
	}
	for periodCount := 0; ; periodCount++ {
		occurrenceDate := advanceDate(rule.StartDate, rule.Frequency, periodCount)
		if CompareIsoDates(occurrenceDate, effectiveEnd) > 0 {
			break
		}
		dates = append(dates, occurrenceDate)
	}
	return dates
}

// ResolvedOccurrences is the output of rule expansion: synthesized instance
// postings plus the date-indexed occurrences to execute. Instances is owned
// by the caller and must outlive execution; occurrences point into it.
type ResolvedOccurrences struct {
	Instances []types.Posting
	ByDate    map[string][]DatedPostingOccurrence
}

// claimsByRule collects (rule, occurrence date) pairs suppressed by enabled
// manual postings. Claims are manual and exact: only the named occurrence is
// skipped, with no date inference.
func claimsByRule(postings []types.Posting) map[string]map[string]bool {
	claims := map[string]map[string]bool{}
	for index := range postings {
		posting := &postings[index]
		if !posting.Enabled || posting.Claim == nil {
			continue
		}
		dates, ok := claims[posting.Claim.RuleID]
		if !ok {
			dates = map[string]bool{}
			claims[posting.Claim.RuleID] = dates
		}
		dates[posting.Claim.OccurrenceDate] = true
	}
	return claims
}

// ResolveOccurrences expands enabled rules into instance postings within
// [windowStart, windowEnd] and merges enabled manual postings dated in the
// window. Window inclusivity of the start follows includeStartDate. Claimed
// rule occurrences are skipped; the claiming posting executes on its own
// date. Index values are global resolution order for stable sorting.
func ResolveOccurrences(rules []types.RecurrenceRule, postings []types.Posting, windowStart, windowEnd string, includeStartDate bool) ResolvedOccurrences {
	claims := claimsByRule(postings)
	inWindow := func(date string) bool {
		if includeStartDate {
			return CompareIsoDates(date, windowStart) >= 0 && CompareIsoDates(date, windowEnd) <= 0
		}
		return CompareIsoDates(date, windowStart) > 0 && CompareIsoDates(date, windowEnd) <= 0
	}
	type instanceSpec struct {
		ruleIndex int
		date      string
	}
	specs := []instanceSpec{}
	for ruleIndex := range rules {
		rule := &rules[ruleIndex]
		if !rule.Enabled || !validScheduleFrequency(rule.Frequency) {
			continue
		}
		effectiveEnd := windowEnd
		if rule.EndDate != nil && CompareIsoDates(*rule.EndDate, windowEnd) < 0 {
			effectiveEnd = *rule.EndDate
		}
		for periodCount := 0; ; periodCount++ {
			occurrenceDate := advanceDate(rule.StartDate, rule.Frequency, periodCount)
			if CompareIsoDates(occurrenceDate, effectiveEnd) > 0 {
				break
			}
			if !inWindow(occurrenceDate) {
				continue
			}
			if claims[rule.ID][occurrenceDate] {
				continue
			}
			specs = append(specs, instanceSpec{ruleIndex: ruleIndex, date: occurrenceDate})
		}
	}
	// Instances is allocated exactly once at full capacity so occurrence
	// pointers into it stay stable across appends.
	resolved := ResolvedOccurrences{
		Instances: make([]types.Posting, 0, len(specs)),
		ByDate:    map[string][]DatedPostingOccurrence{},
	}
	sequence := 0
	for _, spec := range specs {
		rule := &rules[spec.ruleIndex]
		resolved.Instances = append(resolved.Instances, types.Posting{
			ID:              rule.ID,
			Name:            rule.Name,
			SourceAccountID: rule.SourceAccountID,
			Destinations:    rule.Destinations,
			Amount:          rule.Amount,
			Date:            spec.date,
			Priority:        rule.Priority,
			Enabled:         true,
		})
		instance := &resolved.Instances[len(resolved.Instances)-1]
		resolved.ByDate[spec.date] = append(resolved.ByDate[spec.date], DatedPostingOccurrence{
			Posting: instance,
			Index:   sequence,
			Rule:    rule,
			DocPath: []any{"recurrenceRules", spec.ruleIndex},
		})
		sequence++
	}
	for postingIndex := range postings {
		posting := &postings[postingIndex]
		if !posting.Enabled {
			continue
		}
		if !inWindow(posting.Date) {
			continue
		}
		resolved.ByDate[posting.Date] = append(resolved.ByDate[posting.Date], DatedPostingOccurrence{
			Posting: posting,
			Index:   sequence,
			Rule:    nil,
			DocPath: []any{"postings", postingIndex},
		})
		sequence++
	}
	return resolved
}

// incomeDivisor converts an occurrence into its annual-income divisor:
// rule instances divide by their rule's frequency, manual postings resolve
// the whole annual figure at once.
func incomeDivisor(occurrence DatedPostingOccurrence) int {
	if occurrence.Rule != nil {
		return FrequencyDivisor(occurrence.Rule.Frequency)
	}
	return 1
}

// ResolvedMovementPostings returns every movement identity in a document
// as postings: manual postings in stored order, then one synthesized entry
// per rule carrying the rule's template (ID, name, routes, amount,
// priority). Evaluation lookups keyed by origin ID work over this list
// without caring which side an ID came from. Caps are not carried: they
// live on rules and resolve through RuleCapsByID.
func ResolvedMovementPostings(document *types.FinancialModelDocument) []types.Posting {
	out := make([]types.Posting, 0, len(document.Postings)+len(document.RecurrenceRules))
	out = append(out, document.Postings...)
	for index := range document.RecurrenceRules {
		rule := &document.RecurrenceRules[index]
		out = append(out, types.Posting{
			ID:              rule.ID,
			Name:            rule.Name,
			SourceAccountID: rule.SourceAccountID,
			Destinations:    rule.Destinations,
			Amount:          rule.Amount,
			Priority:        rule.Priority,
			Enabled:         rule.Enabled,
			Claim:           nil,
		})
	}
	return out
}

// RuleCapsByID indexes enabled-or-not rule annual caps by rule ID. Caps
// live on rules only; manual postings are uncapped single movements.
func RuleCapsByID(document *types.FinancialModelDocument) map[string]float64 {
	caps := make(map[string]float64, len(document.RecurrenceRules))
	for index := range document.RecurrenceRules {
		rule := &document.RecurrenceRules[index]
		if rule.AnnualCap != nil {
			caps[rule.ID] = *rule.AnnualCap
		}
	}
	return caps
}

// MovementIDExists reports whether an ID names a manual posting or a rule.
func MovementIDExists(document *types.FinancialModelDocument, id string) bool {
	for index := range document.Postings {
		if document.Postings[index].ID == id {
			return true
		}
	}
	for index := range document.RecurrenceRules {
		if document.RecurrenceRules[index].ID == id {
			return true
		}
	}
	return false
}

// MovementIDs returns every movement identity in a document: manual posting
// IDs plus rule IDs.
func MovementIDs(document *types.FinancialModelDocument) map[string]bool {
	ids := make(map[string]bool, len(document.Postings)+len(document.RecurrenceRules))
	for index := range document.Postings {
		ids[document.Postings[index].ID] = true
	}
	for index := range document.RecurrenceRules {
		ids[document.RecurrenceRules[index].ID] = true
	}
	return ids
}
