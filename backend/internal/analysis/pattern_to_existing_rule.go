package analysis

import (
	"errors"
	"fmt"
	"math"
	"sort"
	"strconv"
	"time"

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
// tolerance. It mirrors the detector cadences plus daily.
func existingRuleIntervalDays(frequency types.Frequency) (float64, bool) {
	switch frequency {
	case types.FrequencyDaily:
		return 1, true
	case types.FrequencyWeekly:
		return 7, true
	case types.FrequencyMonthly:
		return 30.4375, true
	case types.FrequencyQuarterly:
		return 91.3125, true
	case types.FrequencyAnnual:
		return 365.25, true
	default:
		return 0, false
	}
}

// PatternToExistingScheduleInput carries everything adding needs: the confirmed anchor
// finding, all saved postings (for routing, taken dates, and validation),
// the immutable source facts for display amounts, and the target rule.
type PatternToExistingScheduleInput struct {
	Anchor        types.AnalysisFinding
	Postings      []types.Posting
	Facts         map[string]types.TransactionFacts
	Rule          types.Schedule
	OccurrenceIDs []string
}

// existingRulePostingDay derives the UTC calendar day for one posting, using
// transaction time with posted time as fallback.
func existingRulePostingDay(posting types.Posting) (string, int64, error) {
	stamp := posting.TransactionTime
	if stamp <= 0 {
		stamp = posting.PostedTime
	}
	if stamp <= 0 {
		return "", 0, fmt.Errorf("%w: a recorded movement changed", ErrPatternStale)
	}
	return time.Unix(stamp, 0).UTC().Format("2006-01-02"), stamp, nil
}

// parsePatternAmount formats a source decimal spelling as absolute dollars.
func parsePatternAmount(raw string) (string, error) {
	amount, err := strconv.ParseFloat(raw, 64)
	if err != nil {
		return "", err
	}
	if math.IsNaN(amount) || math.IsInf(amount, 0) {
		return "", fmt.Errorf("non-finite amount %q", raw)
	}
	if amount < 0 {
		amount = -amount
	}
	return strconv.FormatFloat(math.Round(amount*100)/100, 'f', 2, 64), nil
}

func existingRuleMatchesPosting(rule types.Schedule, posting types.Posting) bool {
	if (rule.SourceAccountID == nil) != (posting.SourceAccountID == nil) {
		return false
	}
	if rule.SourceAccountID != nil && *rule.SourceAccountID != *posting.SourceAccountID {
		return false
	}
	if len(rule.Destinations) != len(posting.Destinations) {
		return false
	}
	for i := range rule.Destinations {
		if rule.Destinations[i] != posting.Destinations[i] {
			return false
		}
	}
	return true
}

// BuildPatternToExistingSchedule maps each recorded movement in a confirmed recurring
// pattern onto one unused scheduled occurrence of an existing rule. It never
// writes; callers validate the candidate model and persist claims through
// the ordinary finance boundary.
func BuildPatternToExistingSchedule(input PatternToExistingScheduleInput) ([]types.PatternOccurrence, error) {
	anchor := input.Anchor
	if anchor.Kind != "recurring" {
		return nil, ErrNotRecurring
	}
	if anchor.Status != "active" {
		return nil, fmt.Errorf("%w: finding is %s", ErrPatternStale, anchor.Status)
	}
	if anchor.Review == nil || anchor.Review.Decision != "confirmed" {
		return nil, fmt.Errorf("%w: pattern is not confirmed", ErrPatternStale)
	}
	if len(input.OccurrenceIDs) == 0 {
		return nil, fmt.Errorf("%w: pattern names no recorded movements", ErrPatternStale)
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
	byID := make(map[string]types.Posting, len(input.Postings))
	for _, posting := range input.Postings {
		byID[posting.ID] = posting
	}
	type occurrence struct {
		id    string
		day   string
		stamp int64
	}
	occurrences := make([]occurrence, 0, len(input.OccurrenceIDs))
	for _, id := range input.OccurrenceIDs {
		posting, ok := byID[id]
		if !ok || posting.Pending || posting.Void {
			return nil, fmt.Errorf("%w: a recorded movement changed", ErrPatternStale)
		}
		if !posting.Enabled {
			return nil, fmt.Errorf("%w: a recorded movement is disabled", ErrPatternStale)
		}
		day, stamp, err := existingRulePostingDay(posting)
		if err != nil {
			return nil, err
		}
		occurrences = append(occurrences, occurrence{id: id, day: day, stamp: stamp})
	}
	first := byID[input.OccurrenceIDs[0]]
	for _, item := range occurrences {
		posting := byID[item.id]
		if !equalRouting(posting, first) {
			return nil, fmt.Errorf("%w: recorded movements span accounts", ErrPatternIncoherent)
		}
	}
	for _, item := range occurrences {
		if !existingRuleMatchesPosting(rule, byID[item.id]) {
			return nil, ErrRoutingMismatch
		}
	}
	// Dates already claimed by other postings are taken and never reused.
	// Disabled postings claim nothing in projections, so their dates stay free.
	taken := map[string]bool{}
	for _, posting := range input.Postings {
		if posting.Claim == nil || posting.Claim.ScheduleID != rule.ID {
			continue
		}
		if !posting.Enabled {
			continue
		}
		inPattern := false
		for _, id := range input.OccurrenceIDs {
			if id == posting.ID {
				inPattern = true
				break
			}
		}
		if inPattern {
			continue
		}
		taken[posting.Claim.OccurrenceDate] = true
	}
	// Already-correct claims stay put and reserve their dates.
	used := map[string]bool{}
	for k, v := range taken {
		used[k] = v
	}
	sort.Slice(occurrences, func(i, j int) bool { return occurrences[i].stamp < occurrences[j].stamp })
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
	amountOf := func(postingID string) string {
		if facts, ok := input.Facts[postingID]; ok {
			if parsed, err := parsePatternAmount(facts.Amount); err == nil {
				return parsed
			}
		}
		if posting, ok := byID[postingID]; ok {
			if expr, ok := posting.Amount.Config["expression"]; ok {
				if s, ok := expr.(string); ok {
					if parsed, err := parsePatternAmount(s); err == nil {
						return parsed
					}
				}
			}
		}
		return ""
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
				assignments = append(assignments, types.PatternOccurrence{PostingID: item.id, Date: current.Claim.OccurrenceDate, Amount: amountOf(item.id)})
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
		assignments = append(assignments, types.PatternOccurrence{PostingID: item.id, Date: best, Amount: amountOf(item.id)})
	}
	sort.Slice(assignments, func(i, j int) bool { return assignments[i].PostingID < assignments[j].PostingID })
	return assignments, nil
}
