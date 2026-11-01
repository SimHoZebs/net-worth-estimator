package analysis

import (
	"errors"
	"fmt"
	"math"
	"sort"
	"strconv"
	"strings"
	"time"

	"github.com/simhozebs/net-worth-estimator/backend/internal/domain"
	"github.com/simhozebs/net-worth-estimator/backend/internal/types"
)

// Promotion errors classify why a pattern cannot become a forecast rule.
// The persistence layer maps them to its invalid/conflict contract.
var (
	ErrNotRecurring      = errors.New("finding is not a recurring pattern")
	ErrPatternStale      = errors.New("recurring pattern changed since confirmation")
	ErrPatternIncoherent = errors.New("recurring pattern evidence disagrees")
)

// recurringCadenceFrequencies maps detected cadences onto forecast rule
// schedules. Biweekly has no rule schedule: rules expand weekly, monthly,
// quarterly, or longer, so biweekly patterns stay visible without promotion
// until the product decides how they should repeat.
func recurringCadenceFrequency(cadence string) (types.RecurrenceFrequency, bool) {
	switch cadence {
	case "weekly":
		return types.FrequencyWeekly, true
	case "monthly":
		return types.FrequencyMonthly, true
	case "quarterly":
		return types.FrequencyQuarterly, true
	case "annual":
		return types.FrequencyAnnual, true
	default:
		return "", false
	}
}

// RecurringPatternKey identifies one confirmed source pattern: the claim
// kind, the detected cadence, and the full recorded occurrence set. One
// active generated rule belongs to one key.
func RecurringPatternKey(kind, product string, occurrenceIDs []string) string {
	ids := append([]string(nil), occurrenceIDs...)
	sort.Strings(ids)
	return strings.Join(append([]string{kind, product}, ids...), "\x00")
}

// recurringOccurrence is one recorded movement behind a pattern, ordered
// oldest first once resolved.
type recurringOccurrence struct {
	id     string
	day    string
	stamp  int64
	amount float64
}

func formatCents(value float64) string {
	return strconv.FormatFloat(math.Round(value*100)/100, 'f', 2, 64)
}

// RecurringPatternInput carries everything promotion needs: the confirmed
// anchor finding, the saved model rows behind its evidence, the immutable
// source facts for those rows, the known model account IDs, and the active
// generated rule for the pattern when one already exists.
type RecurringPatternInput struct {
	Anchor         types.AnalysisFinding
	Postings       []types.Posting
	Facts          map[string]types.TransactionFacts
	AccountIDs     []string
	ExistingRuleID string
}

// BuildRecurringPreview derives the forecast rule one confirmed recurring
// pattern would create, plus the forecast movements behind it. The proposed
// rule always starts one full interval after the latest recorded movement,
// so approving never duplicates bank facts as forecast movements.
// Biweekly and unknown cadences return a visible preview with
// Promotable=false instead of an error, so the interface can explain why.
func BuildRecurringPreview(input RecurringPatternInput) (types.RecurringPromotionPreview, error) {
	anchor := input.Anchor
	if anchor.Kind != "recurring" {
		return types.RecurringPromotionPreview{}, ErrNotRecurring
	}
	if anchor.Status != "active" {
		return types.RecurringPromotionPreview{}, fmt.Errorf("%w: finding is %s", ErrPatternStale, anchor.Status)
	}
	confirmed := anchor.Review != nil && anchor.Review.Decision == "confirmed"
	occurrenceIDs := []string{}
	for _, evidence := range anchor.Evidence {
		occurrenceIDs = append(occurrenceIDs, evidence.PostingIDs...)
	}
	seen := map[string]bool{}
	ordered := occurrenceIDs[:0]
	for _, id := range occurrenceIDs {
		if id == "" || seen[id] {
			continue
		}
		seen[id] = true
		ordered = append(ordered, id)
	}
	occurrenceIDs = ordered
	if len(occurrenceIDs) == 0 {
		return types.RecurringPromotionPreview{}, fmt.Errorf("%w: pattern names no recorded movements", ErrPatternStale)
	}
	byID := make(map[string]types.Posting, len(input.Postings))
	for _, posting := range input.Postings {
		byID[posting.ID] = posting
	}
	occurrences := make([]recurringOccurrence, 0, len(occurrenceIDs))
	for _, id := range occurrenceIDs {
		posting, ok := byID[id]
		if !ok || posting.Pending || posting.Void {
			return types.RecurringPromotionPreview{}, fmt.Errorf("%w: a recorded movement changed", ErrPatternStale)
		}
		facts, ok := input.Facts[id]
		if !ok {
			return types.RecurringPromotionPreview{}, fmt.Errorf("%w: a recorded movement changed", ErrPatternStale)
		}
		amount, err := strconv.ParseFloat(facts.Amount, 64)
		if err != nil || math.IsNaN(amount) || math.IsInf(amount, 0) || amount == 0 {
			return types.RecurringPromotionPreview{}, fmt.Errorf("%w: a recorded movement changed", ErrPatternStale)
		}
		stamp := posting.TransactionTime
		if stamp <= 0 {
			stamp = posting.PostedTime
		}
		if stamp <= 0 {
			return types.RecurringPromotionPreview{}, fmt.Errorf("%w: a recorded movement changed", ErrPatternStale)
		}
		occurrences = append(occurrences, recurringOccurrence{id: id, day: time.Unix(stamp, 0).UTC().Format("2006-01-02"), stamp: stamp, amount: amount})
	}
	first := byID[occurrenceIDs[0]]
	for _, item := range occurrences {
		posting := byID[item.id]
		if !equalRouting(posting, first) {
			return types.RecurringPromotionPreview{}, fmt.Errorf("%w: recorded movements span accounts", ErrPatternIncoherent)
		}
	}
	account := accountOf(first)
	known := false
	for _, id := range input.AccountIDs {
		if id == account {
			known = true
			break
		}
	}
	if !known {
		return types.RecurringPromotionPreview{}, fmt.Errorf("%w: the pattern account is gone", ErrPatternStale)
	}
	magnitudes := make([]float64, 0, len(occurrences))
	for _, item := range occurrences {
		magnitudes = append(magnitudes, math.Abs(item.amount))
	}
	typical := recurringMedian(magnitudes)
	sort.Slice(occurrences, func(i, j int) bool { return occurrences[i].stamp < occurrences[j].stamp })
	lastDay := occurrences[len(occurrences)-1].day
	cadence := anchor.Product
	preview := types.RecurringPromotionPreview{
		FindingID:      anchor.ID,
		PatternKey:     RecurringPatternKey(anchor.Kind, cadence, occurrenceIDs),
		Merchant:       anchor.Provider,
		Cadence:        cadence,
		TypicalAmount:  formatCents(typical),
		Currency:       input.Facts[occurrenceIDs[0]].Currency,
		AccountID:      account,
		ExistingRuleID: input.ExistingRuleID,
	}
	if occurrences[0].amount > 0 {
		preview.Direction = "inflow"
	} else {
		preview.Direction = "outflow"
	}
	for _, item := range occurrences {
		preview.Occurrences = append(preview.Occurrences, types.RecurringPromotionOccurrence{PostingID: item.id, Date: item.day, Amount: formatCents(math.Abs(item.amount))})
	}
	frequency, ok := recurringCadenceFrequency(cadence)
	if !ok {
		preview.Promotable = false
		preview.Reason = fmt.Sprintf("Patterns that repeat %s cannot become forecast rules yet. The evidence stays saved for review.", cadenceLabel(cadence))
		return preview, nil
	}
	rule := &types.RecurrenceRule{
		Name:            ruleName(occurrences, byID, anchor.Provider),
		SourceAccountID: first.SourceAccountID,
		Destinations:    append([]string(nil), first.Destinations...),
		Amount:          types.PostingAmountResolution{Resolver: "expression", Config: map[string]any{"expression": formatCents(typical)}, Inputs: map[string]types.AmountInputBinding{}},
		Frequency:       frequency,
		StartDate:       domain.AdvanceRuleDate(lastDay, frequency, 1),
		Enabled:         true,
	}
	preview.Promotable = true
	preview.Rule = &types.ProposedRecurringRule{
		Name: rule.Name, SourceAccountID: rule.SourceAccountID, Destinations: rule.Destinations,
		Amount: formatCents(typical), Frequency: frequency, StartDate: rule.StartDate, Enabled: true,
	}
	for _, date := range domain.RuleScheduleDates(rule, domain.AdvanceRuleDate(rule.StartDate, frequency, 5)) {
		preview.Upcoming = append(preview.Upcoming, types.UpcomingRecurringOccurrence{Date: date, Amount: formatCents(typical)})
	}
	if !confirmed {
		preview.Promotable = false
		preview.Reason = "Confirm this repeating pattern before creating its forecast rule."
	}
	if input.ExistingRuleID != "" {
		preview.Promotable = false
		preview.Reason = "This pattern already has an active forecast rule. Disable or delete that rule to create a replacement."
	}
	return preview, nil
}

func equalRouting(a, b types.Posting) bool {
	if (a.SourceAccountID == nil) != (b.SourceAccountID == nil) {
		return false
	}
	if a.SourceAccountID != nil && *a.SourceAccountID != *b.SourceAccountID {
		return false
	}
	if len(a.Destinations) != len(b.Destinations) {
		return false
	}
	for i := range a.Destinations {
		if a.Destinations[i] != b.Destinations[i] {
			return false
		}
	}
	return true
}

func accountOf(posting types.Posting) string {
	if posting.SourceAccountID != nil {
		return *posting.SourceAccountID
	}
	if len(posting.Destinations) > 0 {
		return posting.Destinations[0]
	}
	return ""
}

// ruleName names the generated rule after the recorded movements: the most
// common saved transaction name, with the earliest movement breaking ties.
// The rule stays an ordinary editable row afterwards, so approval never has
// to get the wording perfect.
func ruleName(occurrences []recurringOccurrence, byID map[string]types.Posting, fallback string) string {
	counts := map[string]int{}
	best, bestCount := "", 0
	for _, item := range occurrences {
		name := byID[item.id].Name
		if name == "" {
			continue
		}
		counts[name]++
		if counts[name] > bestCount {
			best, bestCount = name, counts[name]
		}
	}
	if best == "" {
		return fallback
	}
	return best
}

func cadenceLabel(cadence string) string {
	switch cadence {
	case "biweekly":
		return "every 2 weeks"
	case "":
		return "without a detected rhythm"
	default:
		return cadence
	}
}
