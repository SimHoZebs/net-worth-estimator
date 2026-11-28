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

// Pattern-to-new-rule errors classify why a pattern cannot become a forecast rule.
// The persistence layer maps them to its invalid/conflict contract.
var (
	ErrNotRecurring      = errors.New("finding is not a schedule pattern")
	ErrPatternStale      = errors.New("recurring pattern changed since confirmation")
	ErrPatternIncoherent = errors.New("recurring pattern evidence disagrees")
)

// IsSchedulePatternKind reports whether a finding kind can drive the
// pattern-to-schedule actions: the recurring detector or any registry
// payment classification. The registry is the composition point, so a new
// classification becomes actionable without touching these gates.
func IsSchedulePatternKind(kind string) bool {
	if kind == "recurring" {
		return true
	}
	for _, definition := range PaymentClassifications() {
		if definition.ID == kind {
			return true
		}
	}
	return false
}

// recurringCadenceRecurrence maps detected cadences onto forecast schedule
// recurrences: daily, weekly, biweekly, monthly, quarterly, and annual
// patterns all become creatable, with weekly shapes pinned to the start
// date's weekday so the start date stays a scheduled occurrence.
func recurringCadenceRecurrence(cadence, firstDay string) (types.Recurrence, bool) {
	weekday := 0
	if domain.IsValidIsoDate(firstDay) {
		weekday = int(domain.MustParseIsoDate(firstDay).Weekday())
	}
	switch cadence {
	case "daily":
		return types.Recurrence{Unit: types.RecurrenceDay, Interval: 1}, true
	case "weekly":
		return types.Recurrence{Unit: types.RecurrenceWeek, Interval: 1, Weekdays: []int{weekday}}, true
	case "biweekly":
		return types.Recurrence{Unit: types.RecurrenceWeek, Interval: 2, Weekdays: []int{weekday}}, true
	case "monthly":
		return types.Recurrence{Unit: types.RecurrenceMonth, Interval: 1, MonthlyMode: types.RecurrenceMonthlyByDate}, true
	case "quarterly":
		return types.Recurrence{Unit: types.RecurrenceMonth, Interval: 3, MonthlyMode: types.RecurrenceMonthlyByDate}, true
	case "annual":
		return types.Recurrence{Unit: types.RecurrenceYear, Interval: 1}, true
	default:
		return types.Recurrence{}, false
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

// formatCents is the single cents formatter for pattern amounts: round
// half away from the source decimal spelling to two places, absolute callers
// pass absolute values in. parsePatternAmount is its parsing entry point.
func formatCents(value float64) string {
	return strconv.FormatFloat(math.Round(value*100)/100, 'f', 2, 64)
}

// patternOccurrencePolicy tunes the shared occurrence resolver per builder.
// The resolver always enforces the kind/status/empty guards, the
// pending/void/stale checks, the transaction-time fallback, oldest-first
// ordering, and the single-account coherence check. Builders opt into only
// the checks their contract needs: the existing-schedule path rejects
// dismissed patterns and disabled movements, while the new-schedule path
// requires immutable source amounts.
type patternOccurrencePolicy struct {
	rejectDismissed bool
	requireEnabled  bool
	requireAmount   bool
}

// resolvePatternOccurrences validates one confirmed pattern's recorded
// movements and returns them oldest first with the transaction index behind
// them. Stale evidence reports ErrPatternStale and movements spanning
// accounts report ErrPatternIncoherent, so both preview builders share one
// guard ordering: kind, status, dismissal, empty, per-movement staleness,
// then coherence.
func resolvePatternOccurrences(anchor types.AnalysisFinding, occurrenceIDs []string, transactions []types.Transaction, facts map[string]types.TransactionFacts, policy patternOccurrencePolicy) ([]recurringOccurrence, map[string]types.Transaction, error) {
	if !IsSchedulePatternKind(anchor.Kind) {
		return nil, nil, ErrNotRecurring
	}
	if anchor.Status != "active" {
		return nil, nil, fmt.Errorf("%w: finding is %s", ErrPatternStale, anchor.Status)
	}
	if policy.rejectDismissed && (anchor.Dismissed || (anchor.Review != nil && anchor.Review.Decision == "rejected")) {
		return nil, nil, fmt.Errorf("%w: pattern needs review again", ErrPatternStale)
	}
	if len(occurrenceIDs) == 0 {
		return nil, nil, fmt.Errorf("%w: pattern names no recorded movements", ErrPatternStale)
	}
	byID := make(map[string]types.Transaction, len(transactions))
	for _, transaction := range transactions {
		byID[transaction.ID] = transaction
	}
	occurrences := make([]recurringOccurrence, 0, len(occurrenceIDs))
	for _, id := range occurrenceIDs {
		transaction, ok := byID[id]
		if !ok || transaction.Pending || transaction.Void {
			return nil, nil, fmt.Errorf("%w: a recorded movement changed", ErrPatternStale)
		}
		if policy.requireEnabled && !transaction.Enabled {
			return nil, nil, fmt.Errorf("%w: a recorded movement is disabled", ErrPatternStale)
		}
		var amount float64
		if policy.requireAmount {
			recorded, ok := facts[id]
			if !ok {
				return nil, nil, fmt.Errorf("%w: a recorded movement changed", ErrPatternStale)
			}
			parsed, err := strconv.ParseFloat(recorded.Amount, 64)
			if err != nil || math.IsNaN(parsed) || math.IsInf(parsed, 0) || parsed == 0 {
				return nil, nil, fmt.Errorf("%w: a recorded movement changed", ErrPatternStale)
			}
			amount = parsed
		}
		stamp := transaction.TransactionTime
		if stamp <= 0 {
			stamp = transaction.PostedTime
		}
		if stamp <= 0 {
			return nil, nil, fmt.Errorf("%w: a recorded movement changed", ErrPatternStale)
		}
		occurrences = append(occurrences, recurringOccurrence{id: id, day: time.Unix(stamp, 0).UTC().Format("2006-01-02"), stamp: stamp, amount: amount})
	}
	first := byID[occurrenceIDs[0]]
	for _, item := range occurrences {
		transaction := byID[item.id]
		if !sameRouting(transaction.SourceAccountID, transaction.Destinations, first.SourceAccountID, first.Destinations) {
			return nil, nil, fmt.Errorf("%w: recorded movements span accounts", ErrPatternIncoherent)
		}
	}
	sort.Slice(occurrences, func(i, j int) bool { return occurrences[i].stamp < occurrences[j].stamp })
	return occurrences, byID, nil
}

// PatternToNewScheduleInput carries everything creation needs: the confirmed
// anchor finding, the saved model rows behind its evidence, the immutable
// source facts for those rows, the known model account IDs, and the active
// generated rule for the pattern when one already exists.
type PatternToNewScheduleInput struct {
	Anchor             types.AnalysisFinding
	Transactions       []types.Transaction
	Facts              map[string]types.TransactionFacts
	AccountIDs         []string
	ExistingScheduleID string
}

// BuildPatternToNewSchedulePreview derives the forecast rule one confirmed recurring
// pattern would create, plus the forecast movements behind it. The proposed
// rule starts on the oldest recorded movement: creation claims each recorded
// movement onto its scheduled occurrence, so approving never duplicates bank
// facts as forecast movements. Upcoming lists the six scheduled dates after
// the latest recorded movement, so the interface shows future-only movements
// alongside the recorded evidence.
// Unknown cadences return a visible preview with Creatable=false instead of
// an error, so the interface can explain why.
func BuildPatternToNewSchedulePreview(input PatternToNewScheduleInput) (types.PatternToNewSchedulePreview, error) {
	anchor := input.Anchor
	occurrenceIDs := []string{}
	for _, evidence := range anchor.Evidence {
		occurrenceIDs = append(occurrenceIDs, evidence.TransactionIDs...)
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
	occurrences, byID, err := resolvePatternOccurrences(anchor, occurrenceIDs, input.Transactions, input.Facts, patternOccurrencePolicy{requireAmount: true})
	if err != nil {
		return types.PatternToNewSchedulePreview{}, err
	}
	first := byID[occurrenceIDs[0]]
	account := accountOf(first)
	known := false
	for _, id := range input.AccountIDs {
		if id == account {
			known = true
			break
		}
	}
	if !known {
		return types.PatternToNewSchedulePreview{}, fmt.Errorf("%w: the pattern account is gone", ErrPatternStale)
	}
	magnitudes := make([]float64, 0, len(occurrences))
	for _, item := range occurrences {
		magnitudes = append(magnitudes, math.Abs(item.amount))
	}
	typical := recurringMedian(magnitudes)
	firstDay := occurrences[0].day
	lastDay := occurrences[len(occurrences)-1].day
	cadence := anchor.Product
	preview := types.PatternToNewSchedulePreview{
		PatternPreviewHeader: types.PatternPreviewHeader{
			FindingID:  anchor.ID,
			PatternKey: RecurringPatternKey(anchor.Kind, cadence, occurrenceIDs),
			Merchant:   anchor.Provider,
			Cadence:    cadence,
			AccountID:  account,
		},
		TypicalAmount:      formatCents(typical),
		Currency:           input.Facts[occurrenceIDs[0]].Currency,
		ExistingScheduleID: input.ExistingScheduleID,
		Occurrences:        []types.PatternOccurrence{},
		Upcoming:           []types.PatternDatedAmount{},
	}
	if occurrences[0].amount > 0 {
		preview.Direction = "inflow"
	} else {
		preview.Direction = "outflow"
	}
	for _, item := range occurrences {
		preview.Occurrences = append(preview.Occurrences, types.PatternOccurrence{PatternDatedAmount: types.PatternDatedAmount{Date: item.day, Amount: formatCents(math.Abs(item.amount))}, TransactionID: item.id})
	}
	frequency, ok := recurringCadenceRecurrence(cadence, firstDay)
	if !ok {
		preview.Creatable = false
		preview.Reason = fmt.Sprintf("Patterns that repeat %s cannot become forecast rules yet. The evidence stays saved for review.", cadenceLabel(cadence))
		return preview, nil
	}
	proposal := types.ProposedNewSchedule{
		Name:            ruleName(occurrences, byID, anchor.Provider),
		SourceAccountID: first.SourceAccountID,
		Destinations:    append([]string(nil), first.Destinations...),
		Amount:          formatCents(typical),
		Recurrence:      frequency,
		StartDate:       firstDay,
		Enabled:         true,
	}
	preview.Creatable = true
	preview.Schedule = &proposal
	for i := 1; i <= 6; i++ {
		date := domain.AdvanceRuleDate(lastDay, frequency, i)
		if domain.CompareIsoDates(date, lastDay) <= 0 {
			continue
		}
		preview.Upcoming = append(preview.Upcoming, types.PatternDatedAmount{Date: date, Amount: formatCents(typical)})
	}
	if anchor.Dismissed || (anchor.Review != nil && anchor.Review.Decision == "rejected") {
		preview.Creatable = false
		preview.Reason = "Review this pattern again before creating its forecast schedule."
	}
	if input.ExistingScheduleID != "" {
		preview.Creatable = false
		preview.Reason = "This pattern already has an active forecast rule. Disable or delete that rule to create a replacement."
	}
	return preview, nil
}

func accountOf(transaction types.Transaction) string {
	if transaction.SourceAccountID != nil {
		return *transaction.SourceAccountID
	}
	if len(transaction.Destinations) > 0 {
		return transaction.Destinations[0]
	}
	return ""
}

// ruleName names the generated rule after the recorded movements: the most
// common saved transaction name, with the earliest movement breaking ties.
// The rule stays an ordinary editable row afterwards, so approval never has
// to get the wording perfect.
func ruleName(occurrences []recurringOccurrence, byID map[string]types.Transaction, fallback string) string {
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
