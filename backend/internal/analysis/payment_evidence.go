package analysis

import (
	"crypto/sha256"
	"encoding/hex"
	"encoding/json"
	"strconv"
	"strings"

	"github.com/simhozebs/net-worth-estimator/backend/internal/types"
)

func paymentPatternID(owner, group, cadence string) string {
	hash := sha256.Sum256([]byte(strings.Join([]string{owner, group, cadence}, "\x00")))
	return hex.EncodeToString(hash[:])
}

// PaymentStreamIdentityVersion versions the payment-stream identity logic
// above. A cached stream whose identity version mismatches must mean full
// rebuild: the incremental worker never reuses stats or membership across it.
const PaymentStreamIdentityVersion = 1

func (pat *classifiedPayment) judgmentInput() *types.AnalysisJudgmentInput {
	// A bounded sample provides inspectable evidence for models or human queues.
	// Pattern statistics describe all occurrences. No engine-specific scaling,
	// categorical encoding, or probability policy belongs on this side.
	samples := []types.TransactionFacts{}
	start := max(0, len(pat.occurrences)-3)
	for _, item := range pat.occurrences[start:] {
		samples = append(samples, item.transaction.Facts)
	}
	annualized := ""
	if pat.cadence != "" {
		annualized = strconv.FormatFloat(pat.annualized, 'f', 2, 64)
	}
	var required []string
	if pat.classification.RequireRecurrence {
		required = []string{"regular-cadence"}
	}
	request := types.AnalysisJudgmentInput{
		Kind: pat.classification.ID, PatternID: pat.patternID, Samples: samples,
		Question: types.JudgmentQuestion{Label: pat.classification.Label,
			RequiredSignals: required,
			SupportSignals:  pat.classification.SupportSignals, CandidateSignals: pat.classification.CandidateSignals,
			ExcludeSignals: pat.classification.ExcludeSignals, SuggestWithoutSignal: pat.classification.SuggestWithoutSignal},
		Pattern: types.JudgmentPattern{
			Merchant: pat.merchant, Cadence: pat.cadence, Currency: pat.currency,
			TypicalAmount:      strconv.FormatFloat(pat.typical, 'f', 2, 64),
			AnnualizedEstimate: annualized,
			OccurrenceCount:    len(pat.occurrences), CadenceDays: pat.cadenceDays,
			AmountVariation: pat.amountCV, IntervalVariation: pat.gapCV, RecencyDays: pat.recencyDays,
			Direction: pat.direction, Signals: pat.signals,
		},
	}
	data, _ := json.Marshal(request) // Pattern construction admits only finite numeric values.
	hash := sha256.Sum256(data)
	request.ID = hex.EncodeToString(hash[:])
	return &request
}
