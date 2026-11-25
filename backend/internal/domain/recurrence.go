package domain

import (
	"cmp"
	"fmt"
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

// CompareTransactionChronology orders one-time transactions by application
// instant, then raw transaction time, posted time, and execution order. Negative
// means a sorts first; zero means every chronology field ties.
func CompareTransactionChronology(a, b *types.Transaction) int {
	if aInstant, bInstant := TransactionInstant(a), TransactionInstant(b); aInstant != bInstant {
		return cmp.Compare(aInstant, bInstant)
	}
	if a.TransactionTime != b.TransactionTime {
		return cmp.Compare(a.TransactionTime, b.TransactionTime)
	}
	if a.PostedTime != b.PostedTime {
		return cmp.Compare(a.PostedTime, b.PostedTime)
	}
	return cmp.Compare(a.ExecutionOrder, b.ExecutionOrder)
}

// compareDatedTransactionOccurrences is the single strict ordering shared by
// simulation, recorded-history application, and the financial independence branch: one
// definition so one edit changes all three. One-time transactions order by
// application instant first, then retain raw transaction time, posted time,
// execution order, and index as deterministic tie-breakers. Negative means a
// sorts first; zero means every ordered field ties (callers break it stably).
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
		if chronology := CompareTransactionChronology(a.Transaction, b.Transaction); chronology != 0 {
			return chronology
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
// by application instant, then raw transaction time, posted time, and explicit
// execution order. The application instant keeps bank rows on their posted day
// while owner rows stay transaction-time ordered.
// Within rule instances it orders by rule priority, then declaration sequence. Accepted purchases
// follow both, ordered by purchase priority then sequence. Simulate, history
// application, and the financial independence branch share this order so one edit
// changes all three.
func sortOccurrences(occurrences []DatedTransactionOccurrence) {
	sort.SliceStable(occurrences, func(i, j int) bool {
		return compareDatedTransactionOccurrences(occurrences[i], occurrences[j]) < 0
	})
}

// transactionDay returns the UTC calendar day on which a transaction applies,
// derived from the same authored chronology as TransactionInstant.
func transactionDay(transaction *types.Transaction) string {
	stamp := TransactionInstant(transaction)
	if stamp <= 0 {
		return ""
	}
	return FormatIsoDate(time.Unix(stamp, 0).UTC())
}

// midnightUnix returns Unix seconds for UTC midnight of a calendar day.
func midnightUnix(date string) int64 {
	return MustParseIsoDate(date).Unix()
}

// RecurrenceDivisor converts annual rates to per-occurrence rates: daily
// schedules divide the year into 365 slices, weekly schedules into 52 weeks
// times the active weekday count, monthly schedules into 12 slices, and
// annual schedules keep the whole rate.
func RecurrenceDivisor(recurrence types.Recurrence) float64 {
	interval := recurrence.Interval
	if interval <= 0 {
		interval = 1
	}
	switch recurrence.Unit {
	case types.RecurrenceDay:
		return 365.0 / float64(interval)
	case types.RecurrenceWeek:
		count := len(recurrence.Weekdays)
		if count <= 0 {
			count = 1
		}
		return 52.0 * float64(count) / float64(interval)
	case types.RecurrenceMonth:
		return 12.0 / float64(interval)
	case types.RecurrenceYear:
		return 1.0 / float64(interval)
	default:
		return 1
	}
}

// weekdayOf returns the Sunday-first weekday of a validated calendar date
// (0=Sunday..6=Saturday), matching the Recurrence.Weekdays encoding.
func weekdayOf(date string) int {
	return int(MustParseIsoDate(date).Weekday())
}

func weekdayIn(weekdays []int, weekday int) bool {
	for _, day := range weekdays {
		if day == weekday {
			return true
		}
	}
	return false
}

// addDays moves a validated calendar day by whole days.
func addDays(date string, days int) string {
	return FormatIsoDate(MustParseIsoDate(date).AddDate(0, 0, days))
}

// monthsBetween counts whole calendar months from start to date by year and
// month fields only. Callers must validate both dates first.
func monthsBetween(start, date string) int {
	startYear, startMonth, _ := splitIsoDate(start)
	dateYear, dateMonth, _ := splitIsoDate(date)
	return (dateYear-startYear)*12 + (dateMonth - startMonth)
}

// recurrenceNthWeekday derives the monthly byNthWeekday shape from the start
// date: its weekday, its ordinal within its month (nth=ceil(day/7), 1..5),
// and whether a week later crosses into the next month (isLast).
func recurrenceNthWeekday(startDate string) (weekday time.Weekday, nth int, isLast bool) {
	start := MustParseIsoDate(startDate)
	weekday = start.Weekday()
	nth = (start.Day()-1)/7 + 1
	isLast = start.AddDate(0, 0, 7).Month() != start.Month()
	return weekday, nth, isLast
}

// nthWeekdayDate resolves one monthly byNthWeekday occurrence within the
// given year and month: the nth weekday when isLast is false, otherwise the
// last such weekday. It reports false when the month lacks an nth weekday
// (only possible for nth=5), in which case the month has no occurrence.
func nthWeekdayDate(year int, month time.Month, weekday time.Weekday, nth int, isLast bool) (string, bool) {
	first := time.Date(year, month, 1, 0, 0, 0, 0, time.UTC)
	offset := (int(weekday) - int(first.Weekday()) + 7) % 7
	lastDay := daysInMonth(year, month)
	if isLast {
		day := 1 + offset
		for day+7 <= lastDay {
			day += 7
		}
		return FormatIsoDate(time.Date(year, month, day, 0, 0, 0, 0, time.UTC)), true
	}
	day := 1 + offset + 7*(nth-1)
	if day > lastDay {
		return "", false
	}
	return FormatIsoDate(time.Date(year, month, day, 0, 0, 0, 0, time.UTC)), true
}

// nthWeekdayMonthsAfter resolves the byNthWeekday occurrence monthsAfter
// calendar months after the start date's month, deriving the weekday shape
// from the start date. It reports false for months that lack the weekday
// ordinal; callers skip those months.
func nthWeekdayMonthsAfter(startDate string, monthsAfter int) (string, bool) {
	weekday, nth, isLast := recurrenceNthWeekday(startDate)
	year, month, _ := splitIsoDate(startDate)
	nextMonthIndex := (month - 1) + monthsAfter
	targetYear := year + floorDiv(nextMonthIndex, 12)
	targetMonth := time.Month(((nextMonthIndex%12)+12)%12 + 1)
	return nthWeekdayDate(targetYear, targetMonth, weekday, nth, isLast)
}

// AdvanceRuleDate moves a calendar day forward by whole schedule periods,
// treating the base date as an occurrence. Pattern-to-new-rule creation uses
// it to list future-only Upcoming dates after the latest recorded movement.
// Weekly multi-day schedules have no single per-period date, so this returns
// the week anchor (start plus whole weeks); occurrence enumeration lives in
// recurrenceDatesFrom, not here.
func AdvanceRuleDate(date string, recurrence types.Recurrence, periodCount int) string {
	interval := recurrence.Interval
	if interval <= 0 {
		interval = 1
	}
	switch recurrence.Unit {
	case types.RecurrenceDay:
		return addDays(date, interval*periodCount)
	case types.RecurrenceWeek:
		return addDays(date, 7*interval*periodCount)
	case types.RecurrenceMonth:
		if recurrence.MonthlyMode == types.RecurrenceMonthlyByNthWeekday {
			return advanceNthWeekday(date, interval, periodCount)
		}
		return AddMonthsClamped(date, interval*periodCount)
	case types.RecurrenceYear:
		return AddMonthsClamped(date, interval*12*periodCount)
	default:
		return date
	}
}

// advanceNthWeekday steps a byNthWeekday schedule forward, deriving the
// weekday shape from the base occurrence and skipping months that lack the
// ordinal. Bases are occurrences by construction (the latest recorded
// movement), so the derived shape matches the schedule's own.
func advanceNthWeekday(date string, interval, periodCount int) string {
	monthsAfter := interval * periodCount
	for guard := 0; guard < 2400; guard++ {
		if occurrence, ok := nthWeekdayMonthsAfter(date, monthsAfter); ok {
			return occurrence
		}
		monthsAfter += interval
	}
	return AddMonthsClamped(date, interval*periodCount)
}

// recurrenceFromFrequency maps a legacy loan-term frequency onto a schedule
// recurrence for the monthly-clamped monthly, quarterly-as-every-3-months,
// and weekly-on-start-weekday equivalences. Unknown frequencies fall back to
// monthly byDate; loan terms only ever carry the five known values.
func recurrenceFromFrequency(frequency types.Frequency, startDate string) types.Recurrence {
	switch frequency {
	case types.FrequencyDaily:
		return types.Recurrence{Unit: types.RecurrenceDay, Interval: 1}
	case types.FrequencyWeekly:
		weekdays := []int(nil)
		if IsValidIsoDate(startDate) {
			weekdays = []int{weekdayOf(startDate)}
		}
		return types.Recurrence{Unit: types.RecurrenceWeek, Interval: 1, Weekdays: weekdays}
	case types.FrequencyMonthly:
		return types.Recurrence{Unit: types.RecurrenceMonth, Interval: 1, MonthlyMode: types.RecurrenceMonthlyByDate}
	case types.FrequencyQuarterly:
		return types.Recurrence{Unit: types.RecurrenceMonth, Interval: 3, MonthlyMode: types.RecurrenceMonthlyByDate}
	case types.FrequencyAnnual:
		return types.Recurrence{Unit: types.RecurrenceYear, Interval: 1}
	default:
		return types.Recurrence{Unit: types.RecurrenceMonth, Interval: 1, MonthlyMode: types.RecurrenceMonthlyByDate}
	}
}

// validRecurrence reports whether a recurrence expands. Unknown units,
// out-of-range intervals, and monthly schedules without a known mode never
// reach expansion past validation, but expansion must still terminate on
// them: every generator below consults this first.
func validRecurrence(recurrence types.Recurrence) bool {
	if recurrence.Interval < 1 || recurrence.Interval > 99 {
		return false
	}
	switch recurrence.Unit {
	case types.RecurrenceDay, types.RecurrenceWeek, types.RecurrenceYear:
		return true
	case types.RecurrenceMonth:
		return recurrence.MonthlyMode == types.RecurrenceMonthlyByDate ||
			recurrence.MonthlyMode == types.RecurrenceMonthlyByNthWeekday
	default:
		return false
	}
}

// recurrenceDatesFrom lists occurrence dates of a recurrence anchored at
// startDate up to endDate (inclusive), skipping periods before startPeriod.
// The fast-forward offset lets callers resume enumeration near a window
// without expanding the whole prefix; every loop advances its cursor past
// endDate, so unknown or degenerate inputs terminate through the
// validRecurrence gate above.
func recurrenceDatesFrom(recurrence types.Recurrence, startDate, endDate string, startPeriod int) []string {
	dates := []string{}
	interval := recurrence.Interval
	if interval <= 0 {
		interval = 1
	}
	if startPeriod < 0 {
		startPeriod = 0
	}
	switch recurrence.Unit {
	case types.RecurrenceDay:
		for period := startPeriod; ; period++ {
			occurrenceDate := addDays(startDate, period*interval)
			if CompareIsoDates(occurrenceDate, endDate) > 0 {
				break
			}
			dates = append(dates, occurrenceDate)
		}
	case types.RecurrenceWeek:
		anchor := addDays(startDate, startPeriod*7*interval)
		for date := anchor; CompareIsoDates(date, endDate) <= 0; date = addDays(date, 1) {
			if !weekdayIn(recurrence.Weekdays, weekdayOf(date)) {
				continue
			}
			if DaysBetween(startDate, date)/7%interval != 0 {
				continue
			}
			dates = append(dates, date)
		}
	case types.RecurrenceMonth:
		if recurrence.MonthlyMode == types.RecurrenceMonthlyByNthWeekday {
			for period := startPeriod; ; period++ {
				monthsAfter := period * interval
				year, month, _ := splitIsoDate(startDate)
				nextMonthIndex := (month - 1) + monthsAfter
				targetYear := year + floorDiv(nextMonthIndex, 12)
				targetMonth := ((nextMonthIndex % 12) + 12) % 12
				if CompareIsoDates(fmt.Sprintf("%04d-%02d-01", targetYear, targetMonth+1), endDate) > 0 {
					break
				}
				if occurrenceDate, ok := nthWeekdayMonthsAfter(startDate, monthsAfter); ok {
					if CompareIsoDates(occurrenceDate, endDate) <= 0 {
						dates = append(dates, occurrenceDate)
					}
				}
			}
			break
		}
		for period := startPeriod; ; period++ {
			occurrenceDate := AddMonthsClamped(startDate, period*interval)
			if CompareIsoDates(occurrenceDate, endDate) > 0 {
				break
			}
			dates = append(dates, occurrenceDate)
		}
	case types.RecurrenceYear:
		for period := startPeriod; ; period++ {
			occurrenceDate := AddMonthsClamped(startDate, period*interval*12)
			if CompareIsoDates(occurrenceDate, endDate) > 0 {
				break
			}
			dates = append(dates, occurrenceDate)
		}
	}
	return dates
}

// RuleScheduleDates lists every scheduled date of a rule up to endDate
// (inclusive), unfiltered by projection windows. Validation uses it to check
// that a claim names a real scheduled occurrence.
func RuleScheduleDates(rule *types.Schedule, endDate string) []string {
	if !validRecurrence(rule.Recurrence) {
		return []string{}
	}
	effectiveEnd := endDate
	if rule.EndDate != nil && CompareIsoDates(*rule.EndDate, endDate) < 0 {
		effectiveEnd = *rule.EndDate
	}
	return recurrenceDatesFrom(rule.Recurrence, rule.StartDate, effectiveEnd, 0)
}

// ScheduleOccurrencesHorizonMonths is the named default forward window for
// schedule occurrence reads when the caller omits `through`: three calendar
// months after today UTC.
const ScheduleOccurrencesHorizonMonths = 3

// DefaultScheduleOccurrencesThrough returns the default `through` date for
// schedule occurrence reads: today plus the named horizon, month-clamped
// exactly like monthly byDate expansion (Jan 31 + 3mo clamps to Apr 30).
func DefaultScheduleOccurrencesThrough(today string) string {
	return AddMonthsClamped(today, ScheduleOccurrencesHorizonMonths)
}

// ruleOccursOn tests one date without expanding the whole prefix: the date
// is an occurrence exactly when its calendar distance from the start date
// fits the recurrence arithmetic. Daily rules with hundreds of claims no
// longer re-expand the shared prefix per claim.
func ruleOccursOn(rule *types.Schedule, date string) bool {
	if !validRecurrence(rule.Recurrence) {
		return false
	}
	if !IsValidIsoDate(rule.StartDate) || !IsValidIsoDate(date) {
		return false
	}
	if CompareIsoDates(date, rule.StartDate) < 0 {
		return false
	}
	if rule.EndDate != nil && CompareIsoDates(date, *rule.EndDate) > 0 {
		return false
	}
	return recurrenceIncludes(rule.Recurrence, rule.StartDate, date)
}

// recurrenceIncludes reports whether date is an occurrence of a recurrence
// anchored at startDate. The date must already be within [startDate, end].
func recurrenceIncludes(recurrence types.Recurrence, startDate, date string) bool {
	switch recurrence.Unit {
	case types.RecurrenceDay:
		return DaysBetween(startDate, date)%recurrence.Interval == 0
	case types.RecurrenceWeek:
		if !weekdayIn(recurrence.Weekdays, weekdayOf(date)) {
			return false
		}
		// Week 0 is the 7-day window starting startDate, not the ISO week:
		// only whole elapsed weeks count toward the interval.
		return DaysBetween(startDate, date)/7%recurrence.Interval == 0
	case types.RecurrenceMonth:
		months := monthsBetween(startDate, date)
		if months%recurrence.Interval != 0 {
			return false
		}
		if recurrence.MonthlyMode == types.RecurrenceMonthlyByNthWeekday {
			occurrence, ok := nthWeekdayMonthsAfter(startDate, months)
			return ok && occurrence == date
		}
		return AddMonthsClamped(startDate, months) == date
	case types.RecurrenceYear:
		months := monthsBetween(startDate, date)
		if months%(recurrence.Interval*12) != 0 {
			return false
		}
		return AddMonthsClamped(startDate, months) == date
	default:
		return false
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
// application day. Index values are global resolution order for stable sorting.
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
		if !rule.Enabled || !validRecurrence(rule.Recurrence) {
			continue
		}
		effectiveEnd := windowEnd
		if rule.EndDate != nil && CompareIsoDates(*rule.EndDate, windowEnd) < 0 {
			effectiveEnd = *rule.EndDate
		}
		for _, occurrenceDate := range recurrenceDatesFrom(rule.Recurrence, rule.StartDate, effectiveEnd, 0) {
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
