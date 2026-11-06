package domain

import (
	"cmp"
	"sort"
	"time"

	"github.com/simhozebs/net-worth-estimator/backend/internal/types"
)

// Rule expansion and claim suppression. Rules own repetition; transactions own
// timed transactions. Expansion is virtual: rule occurrences are synthesized at
// projection time and never stored. A synthesized instance carries the rule's
// ID, so all downstream ledgers (realized amounts, annual caps, transaction
// origins, evaluation references) key on one stable identity per rule.

// DatedTransactionOccurrence binds a transaction to its declaration order. Rule is
// non-nil for rule-generated instances; DocPath is the validation-style path
// identifying the owning row (["transactions", i] or ["schedules", i]).
type DatedTransactionOccurrence struct {
	Transaction *types.Transaction
	Index       int
	Rule        *types.Schedule
	Purchase    *types.PlannedPurchase // Set only by the isolated purchase simulation.
	DocPath     []any
}

// compareDatedTransactionOccurrences is the single strict ordering shared by
// simulation, history replay, and the financial independence branch: one
// definition so one edit changes all three. Negative means a sorts first;
// zero means every ordered field ties (callers break it stably).
func compareDatedTransactionOccurrences(a, b DatedTransactionOccurrence) int {
	aPurchase, bPurchase := a.Purchase, b.Purchase
	if (aPurchase != nil) != (bPurchase != nil) {
		if aPurchase == nil {
			return -1
		}
		return 1
	}
	if aPurchase != nil {
		if aPurchase.Priority != bPurchase.Priority {
			return cmp.Compare(aPurchase.Priority, bPurchase.Priority)
		}
		return cmp.Compare(a.Index, b.Index)
	}
	aRule, bRule := a.Rule != nil, b.Rule != nil
	if aRule != bRule {
		if !aRule {
			return -1
		}
		return 1
	}
	if !aRule {
		if a.Transaction.TransactionTime != b.Transaction.TransactionTime {
			return cmp.Compare(a.Transaction.TransactionTime, b.Transaction.TransactionTime)
		}
		if a.Transaction.PostedTime != b.Transaction.PostedTime {
			return cmp.Compare(a.Transaction.PostedTime, b.Transaction.PostedTime)
		}
		if a.Transaction.ExecutionOrder != b.Transaction.ExecutionOrder {
			return cmp.Compare(a.Transaction.ExecutionOrder, b.Transaction.ExecutionOrder)
		}
		return cmp.Compare(a.Index, b.Index)
	}
	if a.Rule.Priority != b.Rule.Priority {
		return cmp.Compare(a.Rule.Priority, b.Rule.Priority)
	}
	return cmp.Compare(a.Index, b.Index)
}

// sortOccurrences orders same-day occurrences with one-time transactions
// first, then scheduled rule instances. Within one-time transactions it orders
// by transaction time, then posted time, then explicit execution order.
// Within rule instances it orders by rule priority, then declaration sequence. Accepted purchases
// follow both, ordered by purchase priority then sequence. Simulate, history
// replay, and the financial independence branch share this order so one edit
// changes all three.
func sortOccurrences(occurrences []DatedTransactionOccurrence) {
	sort.SliceStable(occurrences, func(i, j int) bool {
		return compareDatedTransactionOccurrences(occurrences[i], occurrences[j]) < 0
	})
}

// transactionDay returns the UTC calendar day for a transaction, derived from
// transaction time with posted time as fallback.
func transactionDay(transaction *types.Transaction) string {
	stamp := transaction.TransactionTime
	if stamp <= 0 {
		stamp = transaction.PostedTime
	}
	if stamp <= 0 {
		return ""
	}
	return FormatIsoDate(time.Unix(stamp, 0).UTC())
}

// midnightUnix returns Unix seconds for UTC midnight of a calendar day.
func midnightUnix(date string) int64 {
	return MustParseIsoDate(date).Unix()
}

// FrequencyDivisor converts annual rates to per-occurrence rates.
func FrequencyDivisor(frequency types.Frequency) int {
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

// AdvanceRuleDate moves a calendar day forward by whole schedule periods.
// Pattern-to-new-rule creation uses it to start a generated rule one full interval after the
// latest recorded movement.
func AdvanceRuleDate(date string, frequency types.Frequency, periodCount int) string {
	return advanceDate(date, frequency, periodCount)
}

func advanceDate(date string, frequency types.Frequency, periodCount int) string {
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
func validScheduleFrequency(frequency types.Frequency) bool {
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
func RuleScheduleDates(rule *types.Schedule, endDate string) []string {
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

// ruleOccursOn tests one date without expanding the whole prefix: advance
// until reaching or passing the date. Daily rules with hundreds of claims
// no longer re-expand the shared prefix per claim.
func ruleOccursOn(rule *types.Schedule, date string) bool {
	if !validScheduleFrequency(rule.Frequency) {
		return false
	}
	if CompareIsoDates(date, rule.StartDate) < 0 {
		return false
	}
	if rule.EndDate != nil && CompareIsoDates(date, *rule.EndDate) > 0 {
		return false
	}
	for periodCount := 0; ; periodCount++ {
		occurrenceDate := advanceDate(rule.StartDate, rule.Frequency, periodCount)
		comparison := CompareIsoDates(occurrenceDate, date)
		if comparison == 0 {
			return true
		}
		if comparison > 0 {
			return false
		}
	}
}

// ResolvedOccurrences is the output of rule expansion: synthesized instance
// transactions plus the date-indexed occurrences to execute. Instances is owned
// by the caller and must outlive execution; occurrences point into it.
type ResolvedOccurrences struct {
	Instances []types.Transaction
	ByDate    map[string][]DatedTransactionOccurrence
}

// claimsByRule collects (rule, occurrence date) pairs suppressed by enabled
// manual transactions. Claims are manual and exact: only the named occurrence is
// skipped, with no date inference.
func claimsByRule(transactions []types.Transaction) map[string]map[string]bool {
	claims := map[string]map[string]bool{}
	for index := range transactions {
		transaction := &transactions[index]
		if !transaction.Enabled || transaction.Claim == nil {
			continue
		}
		dates, ok := claims[transaction.Claim.ScheduleID]
		if !ok {
			dates = map[string]bool{}
			claims[transaction.Claim.ScheduleID] = dates
		}
		dates[transaction.Claim.OccurrenceDate] = true
	}
	return claims
}

// ResolveOccurrences expands enabled rules into instance transactions within
// [windowStart, windowEnd] and merges enabled manual transactions dated in the
// window. Window inclusivity of the start follows includeStartDate. Claimed
// rule occurrences are skipped; the claiming transaction executes on its own
// date. Index values are global resolution order for stable sorting.
func ResolveOccurrences(rules []types.Schedule, transactions []types.Transaction, windowStart, windowEnd string, includeStartDate bool) ResolvedOccurrences {
	claims := claimsByRule(transactions)
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
		Instances: make([]types.Transaction, 0, len(specs)),
		ByDate:    map[string][]DatedTransactionOccurrence{},
	}
	sequence := 0
	for _, spec := range specs {
		rule := &rules[spec.ruleIndex]
		stamp := dayCloseUnix(spec.date)
		resolved.Instances = append(resolved.Instances, types.Transaction{
			ID:              rule.ID,
			Name:            rule.Name,
			SourceAccountID: rule.SourceAccountID,
			Destinations:    rule.Destinations,
			Amount:          rule.Amount,
			PostedTime:      stamp,
			TransactionTime: stamp,
			Enabled:         true,
		})
		instance := &resolved.Instances[len(resolved.Instances)-1]
		resolved.ByDate[spec.date] = append(resolved.ByDate[spec.date], DatedTransactionOccurrence{
			Transaction: instance,
			Index:       sequence,
			Rule:        rule,
			DocPath:     []any{"schedules", spec.ruleIndex},
		})
		sequence++
	}
	for transactionIndex := range transactions {
		transaction := &transactions[transactionIndex]
		if !transaction.Enabled {
			continue
		}
		day := transactionDay(transaction)
		if day == "" || !inWindow(day) {
			continue
		}
		resolved.ByDate[day] = append(resolved.ByDate[day], DatedTransactionOccurrence{
			Transaction: transaction,
			Index:       sequence,
			Rule:        nil,
			DocPath:     []any{"transactions", transactionIndex},
		})
		sequence++
	}
	return resolved
}

// ResolvedTransactionTransactions returns every transaction identity in a model
// as transactions: manual transactions in stored order, then one synthesized entry
// per rule carrying the rule's template (ID, name, routes, amount).
// Evaluation lookups keyed by origin ID work over this list without caring
// which side an ID came from. Caps are not carried: they live on rules and
// resolve through RuleCapsByID.
func ResolvedTransactionTransactions(model *types.FinancialModel) []types.Transaction {
	out := make([]types.Transaction, 0, len(model.Transactions)+len(model.Schedules))
	out = append(out, model.Transactions...)
	for index := range model.Schedules {
		rule := &model.Schedules[index]
		out = append(out, types.Transaction{
			ID:              rule.ID,
			Name:            rule.Name,
			SourceAccountID: rule.SourceAccountID,
			Destinations:    rule.Destinations,
			Amount:          rule.Amount,
			Enabled:         rule.Enabled,
			Claim:           nil,
		})
	}
	return out
}

// RuleCapsByID indexes enabled-or-not rule annual caps by rule ID. Caps
// live on rules only; manual transactions are uncapped single transactions.
func RuleCapsByID(model *types.FinancialModel) map[string]float64 {
	caps := make(map[string]float64, len(model.Schedules))
	for index := range model.Schedules {
		rule := &model.Schedules[index]
		if rule.AnnualCap != nil {
			caps[rule.ID] = *rule.AnnualCap
		}
	}
	return caps
}

// TransactionIDExists reports whether an ID names a manual transaction, a rule,
// or a planned purchase.
func TransactionIDExists(model *types.FinancialModel, id string) bool {
	for index := range model.Transactions {
		if model.Transactions[index].ID == id {
			return true
		}
	}
	for index := range model.Schedules {
		if model.Schedules[index].ID == id {
			return true
		}
	}
	for index := range model.PlannedPurchases {
		if model.PlannedPurchases[index].ID == id {
			return true
		}
	}
	return false
}

// TransactionIDs returns every transaction identity in a model: manual transaction
// IDs, rule IDs, and planned-purchase IDs.
func TransactionIDs(model *types.FinancialModel) map[string]bool {
	ids := make(map[string]bool, len(model.Transactions)+len(model.Schedules)+len(model.PlannedPurchases))
	for index := range model.Transactions {
		ids[model.Transactions[index].ID] = true
	}
	for index := range model.Schedules {
		ids[model.Schedules[index].ID] = true
	}
	for index := range model.PlannedPurchases {
		ids[model.PlannedPurchases[index].ID] = true
	}
	return ids
}
