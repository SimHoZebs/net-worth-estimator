package domain

import (
	"math"
	"strconv"
	"strings"
	"time"

	"github.com/simhozebs/net-worth-estimator/backend/internal/types"
)

// Auto-claim matches a new transaction to one existing schedule occurrence.
//
// The claim remains the only association: a match writes the same
// transaction_claims row a manual claim would write. Validation stays
// authoritative. False positives are fixed by tightening this matcher,
// never by removing automatic assignment.
func AutoClaimWindowDays(frequency types.Frequency) int {
	switch frequency {
	case types.FrequencyDaily:
		return 1
	case types.FrequencyWeekly:
		return 3
	case types.FrequencyMonthly:
		return 7
	case types.FrequencyQuarterly:
		return 15
	case types.FrequencyAnnual:
		return 31
	default:
		return 0
	}
}

func autoClaimLiteralCents(amount types.TransactionAmountResolution) (int64, bool) {
	if amount.Resolver != "expression" {
		return 0, false
	}
	if len(amount.Inputs) != 0 {
		return 0, false
	}
	raw, ok := amount.Config["expression"].(string)
	if !ok {
		return 0, false
	}
	value, err := strconv.ParseFloat(strings.TrimSpace(raw), 64)
	if err != nil || math.IsNaN(value) || math.IsInf(value, 0) || value <= 0 {
		return 0, false
	}
	return int64(math.Round(value * 100)), true
}

func autoClaimNamesMatch(a, b string) bool {
	left := autoClaimNameTokens(a)
	right := autoClaimNameTokens(b)
	if len(left) == 0 || len(right) == 0 {
		return false
	}
	if len(left) <= len(right) {
		return autoClaimTokensContain(right, left)
	}
	return autoClaimTokensContain(left, right)
}

func autoClaimNameTokens(name string) []string {
	upper := strings.ToUpper(strings.TrimSpace(name))
	fields := strings.FieldsFunc(upper, func(r rune) bool {
		return (r < 'A' || r > 'Z') && (r < '0' || r > '9')
	})
	out := make([]string, 0, len(fields))
	for _, token := range fields {
		if token != "" {
			out = append(out, token)
		}
	}
	return out
}

func autoClaimTokensContain(haystack, needle []string) bool {
	set := make(map[string]int, len(haystack))
	for _, token := range haystack {
		set[token]++
	}
	for _, token := range needle {
		if set[token] == 0 {
			return false
		}
		set[token]--
	}
	return true
}

func autoClaimRoutesMatch(transaction types.Transaction, schedule types.Schedule) bool {
	if (transaction.SourceAccountID == nil) != (schedule.SourceAccountID == nil) {
		return false
	}
	if transaction.SourceAccountID != nil && schedule.SourceAccountID != nil &&
		*transaction.SourceAccountID != *schedule.SourceAccountID {
		return false
	}
	if len(transaction.Destinations) != len(schedule.Destinations) {
		return false
	}
	seen := make(map[string]int, len(transaction.Destinations))
	for _, id := range transaction.Destinations {
		seen[id]++
	}
	for _, id := range schedule.Destinations {
		if seen[id] == 0 {
			return false
		}
		seen[id]--
	}
	return true
}

func autoClaimStartOffset(start, lower string, frequency types.Frequency) int {
	if CompareIsoDates(start, lower) >= 0 {
		return 0
	}
	startTime := MustParseIsoDate(start)
	lowerTime := MustParseIsoDate(lower)
	switch frequency {
	case types.FrequencyDaily:
		if days := DaysBetween(start, lower); days > 2 {
			return days - 2
		}
	case types.FrequencyWeekly:
		if days := DaysBetween(start, lower); days/7 > 2 {
			return days/7 - 2
		}
	case types.FrequencyMonthly, types.FrequencyQuarterly:
		months := (lowerTime.Year()-startTime.Year())*12 + int(lowerTime.Month()-startTime.Month())
		if frequency == types.FrequencyQuarterly {
			months /= 3
		}
		if months > 2 {
			return months - 2
		}
	case types.FrequencyAnnual:
		if years := lowerTime.Year() - startTime.Year(); years > 2 {
			return years - 2
		}
	}
	return 0
}

func autoClaimDay(transaction types.Transaction) string {
	stamp := transaction.TransactionTime
	if stamp <= 0 {
		stamp = transaction.PostedTime
	}
	if stamp <= 0 {
		return ""
	}
	return FormatIsoDate(time.Unix(stamp, 0).UTC())
}

// MatchAutoClaim returns the single schedule occurrence a transaction records,
// or nil when there is no unambiguous match. Zero or multiple winners means
// no automatic claim, leaving the row for manual review.
func MatchAutoClaim(transaction types.Transaction, schedules []types.Schedule, claimed map[string]map[string]bool) *types.TransactionClaim {
	if transaction.Claim != nil || transaction.Void {
		return nil
	}
	if !transaction.Enabled && !transaction.Pending {
		return nil
	}
	day := autoClaimDay(transaction)
	if !IsValidIsoDate(day) {
		return nil
	}
	transactionCents, ok := autoClaimLiteralCents(transaction.Amount)
	if !ok {
		return nil
	}
	type candidate struct {
		scheduleID string
		date       string
		daysDiff   int
		amountDiff float64
	}
	candidates := []candidate{}
	for i := range schedules {
		schedule := &schedules[i]
		if !schedule.Enabled {
			continue
		}
		if !IsValidIsoDate(schedule.StartDate) {
			continue
		}
		if !autoClaimRoutesMatch(transaction, *schedule) {
			continue
		}
		if !autoClaimNamesMatch(transaction.Name, schedule.Name) {
			continue
		}
		scheduleCents, ok := autoClaimLiteralCents(schedule.Amount)
		if !ok {
			continue
		}
		amountDiff := math.Abs(float64(transactionCents-scheduleCents)) / float64(scheduleCents)
		if amountDiff > 0.15 {
			continue
		}
		window := AutoClaimWindowDays(schedule.Frequency)
		if window <= 0 {
			continue
		}
		base := MustParseIsoDate(day)
		lower := FormatIsoDate(base.AddDate(0, 0, -window))
		upper := FormatIsoDate(base.AddDate(0, 0, window))
		bestDate := ""
		bestDiff := 0
		first := true
		for periodCount := autoClaimStartOffset(schedule.StartDate, lower, schedule.Frequency); ; periodCount++ {
			occurrence := AdvanceRuleDate(schedule.StartDate, schedule.Frequency, periodCount)
			if CompareIsoDates(occurrence, upper) > 0 {
				break
			}
			if CompareIsoDates(occurrence, lower) < 0 {
				continue
			}
			if CompareIsoDates(occurrence, schedule.StartDate) < 0 {
				continue
			}
			if schedule.EndDate != nil && CompareIsoDates(occurrence, *schedule.EndDate) > 0 {
				continue
			}
			if claimed[schedule.ID][occurrence] {
				continue
			}
			diff := DaysBetween(occurrence, day)
			if diff < 0 {
				diff = -diff
			}
			if first || diff < bestDiff {
				bestDate, bestDiff, first = occurrence, diff, false
			}
			// Unknown frequencies advance to the same date; the upper
			// window break above terminates every reachable loop.
			// A large guard remains only against a defective advance.
			if periodCount > 1000000 {
				break
			}
		}
		if bestDate == "" {
			continue
		}
		candidates = append(candidates, candidate{
			scheduleID: schedule.ID,
			date:       bestDate,
			daysDiff:   bestDiff,
			amountDiff: amountDiff,
		})
	}
	if len(candidates) == 0 {
		return nil
	}
	best := candidates[0]
	for _, item := range candidates[1:] {
		if item.daysDiff < best.daysDiff ||
			(item.daysDiff == best.daysDiff && item.amountDiff < best.amountDiff) {
			best = item
		}
	}
	tied := 0
	for _, item := range candidates {
		if item.daysDiff == best.daysDiff && item.amountDiff == best.amountDiff {
			tied++
		}
	}
	if tied > 1 {
		return nil
	}
	return &types.TransactionClaim{ScheduleID: best.scheduleID, OccurrenceDate: best.date}
}

// FindAutoClaims maps every unclaimed transaction to its unambiguous schedule
// occurrence. Callers apply the updates through the existing claim write
// path so validation, pending clearing, and dirty marking stay uniform.
func FindAutoClaims(transactions []types.Transaction, schedules []types.Schedule) []types.TransactionClaimUpdate {
	claimed := make(map[string]map[string]bool, len(schedules))
	for i := range transactions {
		transaction := &transactions[i]
		if transaction.Claim == nil {
			continue
		}
		dates, ok := claimed[transaction.Claim.ScheduleID]
		if !ok {
			dates = map[string]bool{}
			claimed[transaction.Claim.ScheduleID] = dates
		}
		dates[transaction.Claim.OccurrenceDate] = true
	}
	updates := []types.TransactionClaimUpdate{}
	for i := range transactions {
		transaction := &transactions[i]
		if transaction.Claim != nil {
			continue
		}
		match := MatchAutoClaim(*transaction, schedules, claimed)
		if match == nil {
			continue
		}
		updates = append(updates, types.TransactionClaimUpdate{
			TransactionID: transaction.ID,
			Claim:         *match,
		})
		dates, ok := claimed[match.ScheduleID]
		if !ok {
			dates = map[string]bool{}
			claimed[match.ScheduleID] = dates
		}
		dates[match.OccurrenceDate] = true
	}
	return updates
}
