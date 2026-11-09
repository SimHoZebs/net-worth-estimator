package analysis

import (
	"crypto/sha256"
	"encoding/hex"
	"encoding/json"
	"strconv"
	"strings"

	"github.com/simhozebs/net-worth-estimator/backend/internal/types"
)

func incomePatternID(owner, group, cadence string) string {
	hash := sha256.Sum256([]byte(strings.Join([]string{owner, group, cadence}, "\x00")))
	return hex.EncodeToString(hash[:])
}

func (pat *incomePattern) judgmentInput() *types.AnalysisJudgmentInput {
	// A bounded sample provides inspectable evidence for models or human queues.
	// Pattern statistics describe all occurrences. No engine-specific scaling,
	// categorical encoding, or probability policy belongs on this side.
	samples := []types.TransactionFacts{}
	start := max(0, len(pat.occurrences)-3)
	for _, item := range pat.occurrences[start:] {
		samples = append(samples, item.transaction.Facts)
	}
	request := types.AnalysisJudgmentInput{
		Kind: "income", PatternID: pat.patternID, Samples: samples,
		Pattern: types.JudgmentPattern{
			Merchant: pat.merchant, Cadence: pat.cadence, Currency: pat.currency,
			TypicalAmount:      strconv.FormatFloat(pat.typical, 'f', 2, 64),
			AnnualizedEstimate: strconv.FormatFloat(pat.annualized, 'f', 2, 64),
			OccurrenceCount:    len(pat.occurrences), CadenceDays: pat.cadenceDays,
			AmountVariation: pat.amountCV, IntervalVariation: pat.gapCV, RecencyDays: pat.recencyDays,
			PayrollDescriptor: pat.descriptorHit, SourceCategoryIncome: pat.categoryIncome,
		},
	}
	data, _ := json.Marshal(request) // Pattern construction admits only finite numeric values.
	hash := sha256.Sum256(data)
	request.ID = hex.EncodeToString(hash[:])
	return &request
}
