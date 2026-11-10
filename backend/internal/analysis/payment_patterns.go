package analysis

import (
	"context"
	"crypto/sha256"
	"encoding/hex"
	"encoding/json"
	"math"
	"regexp"
	"sort"
	"strings"

	"github.com/simhozebs/net-worth-estimator/backend/internal/judgment"
	"github.com/simhozebs/net-worth-estimator/backend/internal/types"
)

const PaymentPatternsVersion = "payments-v2"

// PaymentPatterns extracts streams once and batches applicable classifications.
// Definitions contain domain policy; evaluators own how judgments are produced.
type PaymentPatterns struct {
	Judge           judgment.Evaluator
	Classifications []PaymentClassification
	version         string
	preparationErr  error
}

func (PaymentPatterns) Type() string { return "payments" }
func (p PaymentPatterns) Version() string {
	if p.version != "" {
		return p.version
	}
	definitions := p.Classifications
	if definitions == nil {
		definitions = PaymentClassifications()
	}
	data, _ := json.Marshal(definitions)
	hash := sha256.Sum256(data)
	return PaymentPatternsVersion + "/" + hex.EncodeToString(hash[:8])
}
func (p PaymentPatterns) MatchesVersion(version string) bool {
	base := (PaymentPatterns{Classifications: p.Classifications}).Version()
	return version == base || strings.HasPrefix(version, base+"/")
}

var payrollDescriptor = regexp.MustCompile(`(?i)\b(payroll|salary|paycheck|direct[ _-]*deposit|dir[ _-]*dep|ach[ _-]*credit|paystub|pension|ssa|va[ _-]*benefits|social[ _-]*security)\b`)
var paymentRefundMarker = regexp.MustCompile(`(?i)\b(refund|reversal|chargeback|return)\b`)

type paymentCadence struct {
	id     string
	days   float64
	minOcc int
	factor float64
}

var paymentCadences = []paymentCadence{
	{"weekly", 7, 3, 52}, {"biweekly", 14, 3, 26}, {"monthly", 30.4375, 3, 12},
	{"quarterly", 91.3125, 3, 4}, {"annual", 365.25, 2, 1},
}

type paymentOccurrence struct {
	transaction types.AnalysisTransaction
	amount      float64
	day         int64
	text        string
}

// paymentStream contains observations only, independent of semantic labels.
type paymentStream struct {
	patternID, merchant, cadence, currency, direction                         string
	cadenceDays, typical, annualized, amountCV, gapCV, medianGap, recencyDays float64
	occurrences                                                               []paymentOccurrence
	signals                                                                   []string
}

type classifiedPayment struct {
	*paymentStream
	classification PaymentClassification
	judgment       *types.AnalysisJudgment
	isMain         bool
}

func paymentMedian(values []float64) float64 { return recurringMedian(values) }
func paymentMean(values []float64) float64 {
	var sum float64
	for _, v := range values {
		sum += v
	}
	if len(values) == 0 {
		return 0
	}
	return sum / float64(len(values))
}
func paymentStd(values []float64) float64 {
	mean := paymentMean(values)
	var sum float64
	for _, v := range values {
		sum += (v - mean) * (v - mean)
	}
	if len(values) == 0 {
		return 0
	}
	return math.Sqrt(sum / float64(len(values)))
}
func paymentCV(values []float64) float64 {
	mean := paymentMean(values)
	if mean == 0 {
		return 0
	}
	return paymentStd(values) / mean
}
func paymentStamp(facts types.TransactionFacts) int64 {
	if facts.OccurredAt > 0 {
		return facts.OccurredAt
	}
	return facts.PostedTime
}

func detectPaymentStreams(ctx context.Context, input types.AnalysisSnapshot) ([]*paymentStream, error) {
	transfers, err := paymentTransferIDs(ctx, input.Transactions)
	if err != nil {
		return nil, err
	}
	groups, err := paymentGroups(ctx, input.Transactions, transfers)
	if err != nil {
		return nil, err
	}
	var latestDay int64
	for _, tx := range input.Transactions {
		if !tx.Pending && !tx.Void {
			latestDay = max(latestDay, paymentStamp(tx.Facts)/86400)
		}
	}
	var streams []*paymentStream
	for _, group := range groups {
		if err := ctx.Err(); err != nil {
			return nil, err
		}
		amounts := make([]float64, 0, len(group.candidates))
		for _, item := range group.candidates {
			amounts = append(amounts, math.Abs(item.amount))
		}
		typical := paymentMedian(amounts)
		if typical <= 0 {
			continue
		}
		kept := make([]paymentOccurrence, 0, len(group.candidates))
		for _, item := range group.candidates {
			if math.Abs(math.Abs(item.amount)-typical) <= recurringTolerance*typical {
				kept = append(kept, item)
			}
		}
		if len(kept) < 2 {
			continue
		}
		sort.Slice(kept, func(i, j int) bool {
			if kept[i].day != kept[j].day {
				return kept[i].day < kept[j].day
			}
			return kept[i].transaction.TransactionID < kept[j].transaction.TransactionID
		})
		gaps := make([]float64, 0, len(kept)-1)
		for i := 1; i < len(kept); i++ {
			gaps = append(gaps, float64(kept[i].day-kept[i-1].day))
		}
		medianGap := paymentMedian(gaps)
		if medianGap <= 0 {
			continue
		}
		var cadence paymentCadence
		for _, option := range paymentCadences {
			if math.Abs(medianGap-option.days) <= recurringTolerance*option.days {
				cadence = option
				break
			}
		}
		if cadence.id == "" || len(kept) < cadence.minOcc {
			continue
		}
		regular := true
		for _, gap := range gaps {
			regular = regular && math.Abs(gap-medianGap) <= recurringTolerance*medianGap
		}
		if !regular {
			continue
		}
		amounts = amounts[:0]
		for _, item := range kept {
			amounts = append(amounts, math.Abs(item.amount))
		}
		streams = append(streams, &paymentStream{
			patternID: paymentPatternID(input.UserID, group.key, cadence.id), merchant: group.merchant,
			cadence: cadence.id, cadenceDays: cadence.days, currency: kept[0].transaction.Facts.Currency,
			direction: group.direction, typical: typical, annualized: typical * cadence.factor,
			amountCV: paymentCV(amounts), gapCV: paymentCV(gaps), medianGap: medianGap,
			recencyDays: float64(latestDay - kept[len(kept)-1].day), occurrences: kept, signals: paymentSignals(kept),
		})
	}
	return streams, nil
}

func (p PaymentPatterns) Analyze(ctx context.Context, input types.AnalysisSnapshot) ([]types.AnalysisDetection, error) {
	definitions := p.Classifications
	if definitions == nil {
		definitions = PaymentClassifications()
	}
	if err := validatePaymentClassifications(definitions); err != nil {
		return nil, err
	}
	streams, err := detectPaymentStreams(ctx, input)
	if err != nil {
		return nil, err
	}
	// Index once by structural applicability, not one transaction scan per type.
	byDirection := map[string][]*paymentStream{}
	for _, stream := range streams {
		byDirection[stream.direction] = append(byDirection[stream.direction], stream)
	}
	var patterns []*classifiedPayment
	for _, definition := range definitions {
		for _, stream := range byDirection[definition.Direction] {
			candidate := &classifiedPayment{paymentStream: stream, classification: definition}
			if candidate.deterministicDecision() != "unsupported" {
				patterns = append(patterns, candidate)
			}
		}
	}
	if len(patterns) == 0 {
		return []types.AnalysisDetection{}, nil
	}
	judgmentErr := p.preparationErr
	if p.Judge != nil {
		judgmentErr = judgePayments(ctx, p.Judge, patterns)
	} else if judgmentErr != nil {
		for _, pat := range patterns {
			pat.judgment = &types.AnalysisJudgment{RequestID: pat.judgmentInput().ID, Status: "unavailable"}
		}
	}
	// Income ranking remains source-currency comparable and excludes explicit negatives.
	sort.Slice(patterns, func(i, j int) bool {
		if patterns[i].annualized != patterns[j].annualized {
			return patterns[i].annualized > patterns[j].annualized
		}
		if patterns[i].merchant != patterns[j].merchant {
			return patterns[i].merchant < patterns[j].merchant
		}
		if patterns[i].patternID != patterns[j].patternID {
			return patterns[i].patternID < patterns[j].patternID
		}
		return patterns[i].classification.ID < patterns[j].classification.ID
	})
	ranked := map[string][]*classifiedPayment{}
	for _, pat := range patterns {
		if pat.classification.RankMain && pat.decision() != "unsupported" {
			ranked[pat.classification.ID] = append(ranked[pat.classification.ID], pat)
		}
	}
	for _, group := range ranked {
		comparable := group[0].currency != ""
		for _, pat := range group {
			comparable = comparable && pat.currency == group[0].currency
		}
		if comparable {
			group[0].isMain = true
		}
	}
	findings := []types.AnalysisDetection{}
	for _, pat := range patterns {
		if err := ctx.Err(); err != nil {
			return nil, err
		}
		// Keep explicit negative assessments of eligible candidates correctable.
		findings = append(findings, pat.findings()...)
	}
	sort.Slice(findings, func(i, j int) bool {
		if findings[i].TransactionID != findings[j].TransactionID {
			return findings[i].TransactionID < findings[j].TransactionID
		}
		return findings[i].Kind < findings[j].Kind
	})
	return findings, judgmentErr
}
