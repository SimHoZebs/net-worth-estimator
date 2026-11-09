package analysis

import (
	"fmt"
	"math"
	"sort"
	"strconv"
	"strings"
	"time"

	"github.com/simhozebs/net-worth-estimator/backend/internal/types"
)

func (pat *classifiedPayment) findings() []types.AnalysisDetection {
	ids := make([]string, 0, len(pat.occurrences))
	for _, item := range pat.occurrences {
		ids = append(ids, item.transaction.TransactionID)
	}
	sort.Strings(ids)
	first := time.Unix(pat.occurrences[0].day*86400, 0).UTC().Format("2006-01-02")
	last := time.Unix(pat.occurrences[len(pat.occurrences)-1].day*86400, 0).UTC().Format("2006-01-02")
	strength := "moderate"
	if pat.deterministicDecision() == "supported" {
		strength = "strong"
	}
	if pat.judgment != nil && pat.judgment.Status == "ready" {
		strength = pat.judgment.Strength
	}
	code := pat.classification.ID + "." + pat.direction + ":annualized"
	if pat.isMain {
		code = pat.classification.ID + ".main-inflow:annualized"
	}
	reason := fmt.Sprintf("%d payments from %q occur approximately %s (median interval %d days, typical source amount %.2f %s, %s to %s, annualized estimate %.2f %s).", len(pat.occurrences), pat.merchant, pat.cadence, int64(math.Round(pat.medianGap)), pat.typical, pat.currency, first, last, pat.annualized, pat.currency)
	if pat.isMain {
		reason += " This is the main consistent inflow."
	}
	reason += fmt.Sprintf(" Assessment of %s: %s. This does not establish a forecast rule.", pat.classification.Label, pat.decision())
	if len(pat.signals) > 0 {
		reason += " Observed signals: " + strings.Join(pat.signals, ", ") + "."
	}
	if pat.judgment != nil && pat.judgment.Reason != "" {
		reason += " Assessment: " + pat.judgment.Reason
	}
	findings := make([]types.AnalysisDetection, 0, len(pat.occurrences))
	request := pat.judgmentInput()
	for _, item := range pat.occurrences {
		findings = append(findings, types.AnalysisDetection{
			TransactionID: item.transaction.TransactionID, Kind: pat.classification.ID, Provider: pat.merchant,
			Product: pat.cadence, Role: pat.direction, Strength: strength,
			Evidence:      []types.AnalysisEvidence{{Code: code, Reason: reason, TransactionIDs: ids}},
			JudgmentInput: request, Judgment: pat.judgment,
			Pattern: &types.AnalysisPaymentPattern{PatternID: pat.patternID, Currency: pat.currency,
				TypicalAmount: strconv.FormatFloat(pat.typical, 'f', 2, 64), AnnualizedEstimate: strconv.FormatFloat(pat.annualized, 'f', 2, 64)},
		})
	}
	return findings
}
