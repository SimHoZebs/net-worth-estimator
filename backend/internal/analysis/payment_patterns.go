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

const PaymentPatternsVersion = "payments-v3"

// PaymentPatterns extracts streams once and batches applicable classifications.
// Definitions contain domain policy; evaluators own how judgments are produced.
// Providers resolves massive provider catalogs lazily per stream; nil keeps
// current behavior.
type PaymentPatterns struct {
	Judge           judgment.Evaluator
	Classifications []PaymentClassification
	Providers       ProviderResolver
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
	version := PaymentPatternsVersion + "/" + hex.EncodeToString(hash[:8])
	if p.Providers != nil && p.Providers.Revision() != "" {
		version += "/providers-" + p.Providers.Revision()
	}
	return version
}
func (p PaymentPatterns) MatchesVersion(version string) bool {
	base := (PaymentPatterns{Classifications: p.Classifications, Providers: p.Providers}).Version()
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
	streamID                                                                  string
	recurrence                                                                *paymentStream
	nonrepeating                                                              *paymentStream
	external                                                                  *paymentStream
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
	// Provider signals resolve per stream, never per transaction, so catalog
	// size never enters the per-occurrence scan.
	enrichStreamsWithProviders(p.Providers, streams)
	// Index once by structural applicability, not one transaction scan per type.
	patterns := classifyPaymentStreams(definitions, streams)
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
	assignPaymentMain(patterns)
	findings, err := paymentPatternFindings(ctx, patterns)
	if err != nil {
		return nil, err
	}
	return findings, judgmentErr
}

// classifyPaymentStreams indexes streams once by structural applicability,
// not one transaction scan per type.
func classifyPaymentStreams(definitions []PaymentClassification, streams []*paymentStream) []*classifiedPayment {
	byDirection := map[string][]*paymentStream{}
	for _, stream := range streams {
		byDirection[stream.direction] = append(byDirection[stream.direction], stream)
	}
	var patterns []*classifiedPayment
	for _, definition := range definitions {
		for _, stream := range byDirection[definition.Direction] {
			if definition.ExternalOnly {
				stream = stream.external
			}
			if stream == nil {
				continue
			}
			views := []*paymentStream{stream}
			if stream.recurrence != nil {
				views = []*paymentStream{stream.recurrence}
				if !definition.RequireRecurrence && stream.nonrepeating != nil {
					views = append(views, stream.nonrepeating)
				}
			} else if definition.RequireRecurrence {
				continue
			}
			for _, view := range views {
				candidate := &classifiedPayment{paymentStream: view, classification: definition}
				if candidate.deterministicDecision() != "unsupported" {
					patterns = append(patterns, candidate)
				}
			}
		}
	}
	return patterns
}

// assignPaymentMain sorts candidates heaviest-first and marks the top
// comparable RankMain candidate per classification. Currency mixing withholds
// the mark instead of ranking incomparable amounts.
func assignPaymentMain(patterns []*classifiedPayment) {
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
		if pat.classification.RankMain && pat.cadence != "" && pat.decision() != "unsupported" {
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
}

// paymentPatternFindings renders one finding per occurrence in stable
// transaction order. Keep explicit negative assessments of eligible
// candidates correctable.
func paymentPatternFindings(ctx context.Context, patterns []*classifiedPayment) ([]types.AnalysisDetection, error) {
	findings := []types.AnalysisDetection{}
	for _, pat := range patterns {
		if err := ctx.Err(); err != nil {
			return nil, err
		}
		findings = append(findings, pat.findings()...)
	}
	sort.Slice(findings, func(i, j int) bool {
		if findings[i].TransactionID != findings[j].TransactionID {
			return findings[i].TransactionID < findings[j].TransactionID
		}
		return findings[i].Kind < findings[j].Kind
	})
	return findings, nil
}
