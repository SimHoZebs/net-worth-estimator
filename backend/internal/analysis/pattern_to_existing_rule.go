package analysis

import (
	"errors"
	"fmt"
	"math"
	"sort"
	"strconv"

	"github.com/simhozebs/net-worth-estimator/backend/internal/domain"
	"github.com/simhozebs/net-worth-estimator/backend/internal/types"
)

// Pattern-to-existing-rule errors classify why a pattern cannot claim an
// existing rule's occurrences. The persistence layer maps them to its
// invalid/conflict contract.
var (
	ErrRuleNotFound    = errors.New("forecast rule not found")
	ErrRuleDisabled    = errors.New("forecast rule is disabled")
	ErrRoutingMismatch = errors.New("recorded movements do not match the forecast rule")
	ErrNoScheduleMatch = errors.New("no scheduled occurrence matches a recorded movement")
)

// existingRuleIntervalDays converts a rule frequency to nominal days for drift
// tolerance via the single cadence registry: the reverse direction of
// recurringCadenceFrequency, so detector intervals and rule schedules cannot
// drift apart.
func existingRuleIntervalDays(frequency types.Frequency) (float64, bool) {
	if frequency == "" {
		return 0, false
	}
	for _, def := range patternCadenceDefs {
		if def.frequency == frequency {
			return def.days, true
		}
	}
	return 0, false
}

// PatternToExistingScheduleInput carries everything adding needs: the confirmed anchor
// finding, all saved transactions (for routing, taken dates, and validation),
// the immutable source facts for display amounts, and the target rule.
type PatternToExistingScheduleInput struct {
	Anchor        types.AnalysisFinding
	Transactions  []types.Transaction
	Facts         map[string]types.TransactionFacts
	Rule          types.Schedule
	OccurrenceIDs []string
}

// parsePatternAmount formats a source decimal spelling as absolute dollars
// through the single cents formatter.
func parsePatternAmount(raw string) (string, error) {
	amount, err := strconv.ParseFloat(raw, 64)
	if err != nil {
		return "", err
	}
	if math.IsNaN(amount) || math.IsInf(amount, 0) {
		return "", fmt.Errorf("non-finite amount %q", raw)
	}
	return formatCents(math.Abs(amount)), nil
}

// patternDisplayAmount renders one recorded movement as absolute dollars for
// link previews: immutable source facts first, then the saved amount
// expression. Creation previews never use this fallback: they resolve
// immutable facts amounts and report stale evidence when facts are missing,
// because a generated rule must start from source truth. Linking only
// assigns dates, so its display may fall back without changing product
// amounts.
func patternDisplayAmount(facts map[string]types.TransactionFacts, transactions map[string]types.Transaction, transactionID string) string {
	if recorded, ok := facts[transactionID]; ok {
		if parsed, err := parsePatternAmount(recorded.Amount); err == nil {
			return parsed
		}
	}
	if transaction, ok := transactions[transactionID]; ok {
		if expr, ok := transaction.Amount.Config["expression"]; ok {
			if s, ok := expr.(string); ok {
				if parsed, err := parsePatternAmount(s); err == nil {
					return parsed
				}
			}
		}
	}
	return ""
}

// BuildPatternToExistingSchedule maps each recorded movement in a confirmed recurring
// pattern onto one unused scheduled occurrence of an existing rule. It never
// writes; callers validate the candidate model and persist claims through
// the ordinary finance boundary.
func BuildPatternToExistingSchedule(input PatternToExistingScheduleInput) ([]types.PatternOccurrence, error) {
	anchor := input.Anchor
	occurrences, byID, err := resolvePatternOccurrences(anchor, input.OccurrenceIDs, input.Transactions, input.Facts, patternOccurrencePolicy{rejectDismissed: true, requireEnabled: true})
	if err != nil {
		return nil, err
	}
	rule := input.Rule
	if rule.ID == "" {
		return nil, ErrRuleNotFound
	}
	if !rule.Enabled {
		return nil, ErrRuleDisabled
	}
	interval, ok := existingRuleIntervalDays(rule.Frequency)
	if !ok {
		return nil, fmt.Errorf("%w: rule schedule is unknown", ErrNoScheduleMatch)
	}
	if !domain.IsValidIsoDate(rule.StartDate) {
		return nil, fmt.Errorf("%w: rule schedule is unknown", ErrNoScheduleMatch)
	}
	for _, item := range occurrences {
		transaction := byID[item.id]
		if !sameRouting(rule.SourceAccountID, rule.Destinations, transaction.SourceAccountID, transaction.Destinations) {
			return nil, ErrRoutingMismatch
		}
	}
	// Dates already claimed by other transactions are taken and never reused.
	// Disabled transactions claim nothing in projections, so their dates stay free.
	taken := map[string]bool{}
	for _, transaction := range input.Transactions {
		if transaction.Claim == nil || transaction.Claim.ScheduleID != rule.ID {
			continue
		}
		if !transaction.Enabled {
			continue
		}
		inPattern := false
		for _, id := range input.OccurrenceIDs {
			if id == transaction.ID {
				inPattern = true
				break
			}
		}
		if inPattern {
			continue
		}
		taken[transaction.Claim.OccurrenceDate] = true
	}
	// Already-correct claims stay put and reserve their dates.
	used := map[string]bool{}
	for k, v := range taken {
		used[k] = v
	}
	maxDay := occurrences[len(occurrences)-1].day
	schedule := domain.RuleScheduleDates(&rule, maxDay)
	if len(schedule) == 0 {
		return nil, fmt.Errorf("%w: rule has no occurrences through %s", ErrNoScheduleMatch, maxDay)
	}
	// Tolerance mirrors the detector: 15% of the nominal interval with a
	// one-day floor so weekly drift survives weekends.
	tolerance := int(math.Ceil(0.15 * interval))
	if tolerance < 1 {
		tolerance = 1
	}
	assignments := make([]types.PatternOccurrence, 0, len(occurrences))
	amountOf := func(transactionID string) string {
		return patternDisplayAmount(input.Facts, byID, transactionID)
	}
	// Greedy oldest-first: each movement takes its nearest unused scheduled
	// date. Skipped months stay skipped because no movement claims them.
	scheduled := map[string]bool{}
	for _, date := range schedule {
		scheduled[date] = true
	}
	for _, item := range occurrences {
		current := byID[item.id]
		if current.Claim != nil && current.Claim.ScheduleID == rule.ID && !used[current.Claim.OccurrenceDate] {
			// Keep an already-correct claim without re-matching when the
			// stored date is still a scheduled occurrence. Dates past maxDay
			// cannot appear in the prefix schedule, so expand to the claim
			// date itself to verify them.
			kept := false
			if scheduled[current.Claim.OccurrenceDate] {
				kept = true
			} else if domain.CompareIsoDates(current.Claim.OccurrenceDate, maxDay) > 0 {
				for _, date := range domain.RuleScheduleDates(&rule, current.Claim.OccurrenceDate) {
					if date == current.Claim.OccurrenceDate {
						kept = true
						break
					}
				}
			}
			if kept {
				used[current.Claim.OccurrenceDate] = true
				assignments = append(assignments, types.PatternOccurrence{PatternDatedAmount: types.PatternDatedAmount{Date: current.Claim.OccurrenceDate, Amount: amountOf(item.id)}, TransactionID: item.id})
				continue
			}
		}
		best := ""
		bestDiff := 1 << 30
		for _, date := range schedule {
			if used[date] {
				continue
			}
			diff := domain.DaysBetween(date, item.day)
			if diff < 0 {
				diff = -diff
			}
			if diff < bestDiff || (diff == bestDiff && (best == "" || domain.CompareIsoDates(date, best) < 0)) {
				best, bestDiff = date, diff
			}
		}
		if best == "" {
			return nil, fmt.Errorf("%w: no unused scheduled occurrence remains for %s", ErrNoScheduleMatch, item.day)
		}
		if bestDiff > tolerance {
			return nil, fmt.Errorf("%w: %s is %d days from its nearest free occurrence", ErrNoScheduleMatch, item.day, bestDiff)
		}
		used[best] = true
		assignments = append(assignments, types.PatternOccurrence{PatternDatedAmount: types.PatternDatedAmount{Date: best, Amount: amountOf(item.id)}, TransactionID: item.id})
	}
	sort.Slice(assignments, func(i, j int) bool { return assignments[i].TransactionID < assignments[j].TransactionID })
	return assignments, nil
}
