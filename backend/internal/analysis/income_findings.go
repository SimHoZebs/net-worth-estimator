package analysis

import (
	"fmt"
	"math"
	"sort"
	"strconv"
	"time"

	"github.com/simhozebs/net-worth-estimator/backend/internal/types"
)

func (pat *incomePattern) findings() []types.AnalysisDetection {
	ids := make([]string, 0, len(pat.occurrences))
	for _, item := range pat.occurrences {
		ids = append(ids, item.transaction.TransactionID)
	}
	sort.Strings(ids)
	first := time.Unix(pat.occurrences[0].day*86400, 0).UTC().Format("2006-01-02")
	last := time.Unix(pat.occurrences[len(pat.occurrences)-1].day*86400, 0).UTC().Format("2006-01-02")
	strength := "moderate"
	if pat.judgment != nil && pat.judgment.Status == "ready" {
		strength = pat.judgment.Strength
	} else if pat.descriptorHit || pat.categoryIncome {
		strength = "strong"
	}
	code := "income.inflow:annualized"
	// Keep deposit, cadence, estimate, and provenance distinct (TERMS §F).
	reason := fmt.Sprintf("%d deposits from %q occur approximately %s (median interval %d days, typical source amount %.2f %s, %s to %s, annualized estimate %.2f %s).",
		len(pat.occurrences), pat.merchant, pat.cadence, int64(math.Round(pat.medianGap)), pat.typical, pat.currency, first, last, pat.annualized, pat.currency)
	if pat.isMain {
		code = "income.main-inflow:annualized"
		reason += " This is the main consistent inflow."
	}
	reason += " This pattern suggests income but does not establish a forecast rule."
	if pat.descriptorHit {
		reason += " Payroll descriptor matched."
	}
	if pat.categoryIncome {
		reason += " Source category indicates income."
	}
	if pat.judgment != nil && pat.judgment.Reason != "" {
		reason += " Assessment: " + pat.judgment.Reason
	}
	var findings []types.AnalysisDetection
	for _, item := range pat.occurrences {
		findings = append(findings, types.AnalysisDetection{
			TransactionID: item.transaction.TransactionID, Kind: "income", Provider: pat.merchant,
			Product: pat.cadence, Role: "inflow", Strength: strength,
			Evidence:      []types.AnalysisEvidence{{Code: code, Reason: reason, TransactionIDs: ids}},
			JudgmentInput: pat.judgmentInput(),
			Judgment:      pat.judgment,
			Income: &types.AnalysisIncomePattern{
				PatternID:          pat.patternID,
				Currency:           pat.currency,
				TypicalAmount:      strconv.FormatFloat(pat.typical, 'f', 2, 64),
				AnnualizedEstimate: strconv.FormatFloat(pat.annualized, 'f', 2, 64),
			},
		})
	}
	return findings
}
