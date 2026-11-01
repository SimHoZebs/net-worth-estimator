package analysis

import (
	"context"
	"fmt"
	"math"
	"sort"
	"strconv"
	"strings"
	"time"

	"github.com/simhozebs/net-worth-estimator/backend/internal/types"
)

const RecurringVersion = "recurring-v1"

// Recurring detects repeated payments and deposits from saved bank evidence.
// It is a second independent producer on the shared Analysis lifecycle: one
// transaction may hold both a BNPL claim and a recurring claim without the
// producers competing. Findings only annotate transactions; promoting a
// confirmed pattern into a forecast rule is a separate explicit action.
type Recurring struct{}

func (Recurring) Type() string    { return "recurring" }
func (Recurring) Version() string { return RecurringVersion }

// The cadence windows below are heuristics, not calibrated probabilities.
// Weekly, biweekly, monthly, quarterly, and annual thresholds, the shared
// timing/amount tolerance, and the merchant-key normalization are open
// product decisions; the detector keeps them in named constants.
const recurringTolerance = 0.15

var recurringCadences = []struct {
	id     string
	days   float64
	minOcc int
}{
	{"weekly", 7, 3},
	{"biweekly", 14, 3},
	{"monthly", 30.4375, 3},
	{"quarterly", 91.3125, 3},
	{"annual", 365.25, 2},
}

type recurringCandidate struct {
	transaction types.AnalysisTransaction
	amount      float64
	day         int64
}

func recurringKey(text string) string {
	lowered := strings.ToLower(text)
	cleaned := strings.Map(func(r rune) rune {
		if r >= 'a' && r <= 'z' || r >= '0' && r <= '9' {
			return r
		}
		return ' '
	}, lowered)
	for _, token := range strings.Fields(cleaned) {
		if len(token) < 3 {
			continue
		}
		digits := true
		for _, r := range token {
			if r < '0' || r > '9' {
				digits = false
				break
			}
		}
		if !digits {
			return token
		}
	}
	return ""
}

func recurringMedian(values []float64) float64 {
	sorted := append([]float64(nil), values...)
	sort.Float64s(sorted)
	middle := len(sorted) / 2
	if len(sorted)%2 == 0 {
		return (sorted[middle-1] + sorted[middle]) / 2
	}
	return sorted[middle]
}

func (Recurring) Analyze(ctx context.Context, input types.AnalysisSnapshot) ([]types.AnalysisDetection, error) {
	findings := []types.AnalysisDetection{}
	groups := map[string][]recurringCandidate{}
	for _, transaction := range input.Transactions {
		if err := ctx.Err(); err != nil {
			return nil, err
		}
		if transaction.Pending || transaction.Void {
			continue
		}
		facts := transaction.Facts
		text := strings.Join([]string{facts.Description, facts.Payee, facts.Memo, facts.Metadata["merchant_name"]}, " ")
		merchant := recurringKey(text)
		if merchant == "" {
			continue
		}
		amount, err := strconv.ParseFloat(facts.Amount, 64)
		if err != nil || math.IsNaN(amount) || math.IsInf(amount, 0) || math.Abs(amount) > 1e10 || amount == 0 {
			continue
		}
		stamp := facts.OccurredAt
		if stamp <= 0 {
			stamp = facts.PostedTime
		}
		if stamp <= 0 {
			continue
		}
		sign := "outflow"
		if amount > 0 {
			sign = "inflow"
		}
		key := strings.Join([]string{transaction.SourceProvider, transaction.AccountID, facts.Currency, sign, merchant}, "\x00")
		groups[key] = append(groups[key], recurringCandidate{transaction, amount, stamp / 86400})
	}
	for key, group := range groups {
		if err := ctx.Err(); err != nil {
			return nil, err
		}
		amounts := make([]float64, 0, len(group))
		for _, item := range group {
			amounts = append(amounts, math.Abs(item.amount))
		}
		typical := recurringMedian(amounts)
		kept := group[:0]
		for _, item := range group {
			if math.Abs(math.Abs(item.amount)-typical) <= recurringTolerance*typical {
				kept = append(kept, item)
			}
		}
		if len(kept) < 2 {
			continue
		}
		sort.Slice(kept, func(i, j int) bool { return kept[i].day < kept[j].day })
		gaps := make([]float64, 0, len(kept)-1)
		for i := 1; i < len(kept); i++ {
			gaps = append(gaps, float64(kept[i].day-kept[i-1].day))
		}
		medianGap := recurringMedian(gaps)
		if medianGap <= 0 {
			continue
		}
		cadence := ""
		minOcc := 0
		for _, option := range recurringCadences {
			if math.Abs(medianGap-option.days) <= recurringTolerance*option.days {
				cadence, minOcc = option.id, option.minOcc
				break
			}
		}
		if cadence == "" || len(kept) < minOcc {
			continue
		}
		regular := true
		for _, gap := range gaps {
			regular = regular && math.Abs(gap-medianGap) <= recurringTolerance*medianGap
		}
		if !regular {
			continue
		}
		ids := make([]string, 0, len(kept))
		for _, item := range kept {
			ids = append(ids, item.transaction.PostingID)
		}
		sort.Strings(ids)
		merchant := strings.Split(key, "\x00")[4]
		role := "outflow"
		if kept[0].amount > 0 {
			role = "inflow"
		}
		currency := kept[0].transaction.Facts.Currency
		first := time.Unix(kept[0].day*86400, 0).UTC().Format("2006-01-02")
		last := time.Unix(kept[len(kept)-1].day*86400, 0).UTC().Format("2006-01-02")
		reason := fmt.Sprintf("%d transactions from %q occur approximately %s (median interval %d days, typical source amount %s %s, %s to %s). This pattern suggests recurrence but does not establish a forecast rule.",
			len(kept), merchant, cadence, int64(math.Round(medianGap)), strconv.FormatFloat(typical, 'f', 2, 64), currency, first, last)
		for _, item := range kept {
			findings = append(findings, types.AnalysisDetection{PostingID: item.transaction.PostingID, Kind: "recurring", Provider: merchant, Product: cadence, Role: role, Strength: "moderate", Evidence: []types.AnalysisEvidence{{Code: "recurring.cadence", Reason: reason, PostingIDs: ids}}})
		}
	}
	sort.Slice(findings, func(i, j int) bool { return findings[i].PostingID < findings[j].PostingID })
	return findings, nil
}
