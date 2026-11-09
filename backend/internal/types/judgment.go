package types

// AnalysisJudgmentInput is immutable domain evidence, not model features. ID
// identifies this exact request; PatternID identifies the recurring pattern.
type AnalysisJudgmentInput struct {
	ID        string             `json:"id"`
	Kind      string             `json:"kind"`
	PatternID string             `json:"patternId"`
	Pattern   JudgmentPattern    `json:"pattern"`
	Question  JudgmentQuestion   `json:"question"`
	Samples   []TransactionFacts `json:"samples"`
}

// JudgmentQuestion describes the domain hypothesis, not a model implementation.
// It travels with immutable evidence so review and learning use the same policy.
type JudgmentQuestion struct {
	Label                string   `json:"label"`
	SupportSignals       []string `json:"supportSignals"`
	CandidateSignals     []string `json:"candidateSignals"`
	ExcludeSignals       []string `json:"excludeSignals"`
	SuggestWithoutSignal bool     `json:"suggestWithoutSignal"`
}

type JudgmentPattern struct {
	Merchant           string   `json:"merchant"`
	Cadence            string   `json:"cadence"`
	Currency           string   `json:"currency"`
	TypicalAmount      string   `json:"typicalAmount"`
	AnnualizedEstimate string   `json:"annualizedEstimate"`
	OccurrenceCount    int      `json:"occurrenceCount"`
	CadenceDays        float64  `json:"cadenceDays"`
	AmountVariation    float64  `json:"amountVariation"`
	IntervalVariation  float64  `json:"intervalVariation"`
	RecencyDays        float64  `json:"recencyDays"`
	Direction          string   `json:"direction"`
	Signals            []string `json:"signals"`
}

// Providers return domain strength, not scores, training counts, or engine
// configuration. Pending supports asynchronous services and human queues.
type AnalysisJudgment struct {
	RequestID string `json:"requestId"`
	Status    string `json:"status" enum:"ready,pending,unavailable"`
	Decision  string `json:"decision,omitempty" enum:"supported,unsupported,uncertain"`
	Strength  string `json:"strength,omitempty" enum:"strong,moderate"`
	Reason    string `json:"reason,omitempty" maxLength:"2000"`
}

const (
	JudgmentUnavailable = "judgment-unavailable"
	JudgmentPending     = "judgment-pending"
)

func RetryableJudgmentProblem(problem string) bool {
	return problem == JudgmentUnavailable || problem == JudgmentPending
}
