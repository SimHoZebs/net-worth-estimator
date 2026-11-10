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

const RecurringVersion = "recurring-v2"
const recurringTolerance = 0.15

// Recurring assesses repetition over the same observations used for purpose
// assessments. Confirming repetition remains independent of purpose or forecast.
type Recurring struct{}

func (Recurring) Type() string    { return "recurring" }
func (Recurring) Version() string { return RecurringVersion }

func recurringKey(text string) string {
	cleaned := strings.Map(func(r rune) rune {
		if r >= 'a' && r <= 'z' || r >= '0' && r <= '9' {
			return r
		}
		return ' '
	}, strings.ToLower(text))
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
	streams, err := detectPaymentStreams(ctx, input)
	if err != nil {
		return nil, err
	}
	findings := []types.AnalysisDetection{}
	for _, stream := range streams {
		if err := ctx.Err(); err != nil {
			return nil, err
		}
		pat := stream.recurrence
		if pat == nil {
			continue
		}
		ids := make([]string, 0, len(pat.occurrences))
		for _, item := range pat.occurrences {
			ids = append(ids, item.transaction.TransactionID)
		}
		sort.Strings(ids)
		first := time.Unix(pat.occurrences[0].day*86400, 0).UTC().Format("2006-01-02")
		last := time.Unix(pat.occurrences[len(pat.occurrences)-1].day*86400, 0).UTC().Format("2006-01-02")
		reason := fmt.Sprintf("%d transactions from %q occur approximately %s (median interval %d days, typical source amount %s %s, %s to %s). This pattern suggests recurrence but does not establish a forecast rule.", len(pat.occurrences), pat.merchant, pat.cadence, int64(math.Round(pat.medianGap)), strconv.FormatFloat(pat.typical, 'f', 2, 64), pat.currency, first, last)
		for _, item := range pat.occurrences {
			findings = append(findings, types.AnalysisDetection{StreamID: pat.streamID, TransactionID: item.transaction.TransactionID, Kind: "recurring", Provider: pat.merchant, Product: pat.cadence, Role: pat.direction, Strength: "moderate", Evidence: []types.AnalysisEvidence{{Code: "recurring.cadence", Reason: reason, TransactionIDs: ids}}})
		}
	}
	sort.Slice(findings, func(i, j int) bool { return findings[i].TransactionID < findings[j].TransactionID })
	return findings, nil
}
