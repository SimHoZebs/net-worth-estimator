package types

// AnalysisJudgmentInput is immutable domain evidence, not model features. ID
// identifies this exact request; PatternID identifies the recurring pattern.
type AnalysisJudgmentInput struct {
	ID        string             `json:"id"`
	Kind      string             `json:"kind"`
	PatternID string             `json:"patternId"`
	Pattern   JudgmentPattern    `json:"pattern"`
	Samples   []TransactionFacts `json:"samples"`
}

type JudgmentPattern struct {
	Merchant             string  `json:"merchant"`
	Cadence              string  `json:"cadence"`
	Currency             string  `json:"currency"`
	TypicalAmount        string  `json:"typicalAmount"`
	AnnualizedEstimate   string  `json:"annualizedEstimate"`
	OccurrenceCount      int     `json:"occurrenceCount"`
	CadenceDays          float64 `json:"cadenceDays"`
	AmountVariation      float64 `json:"amountVariation"`
	IntervalVariation    float64 `json:"intervalVariation"`
	RecencyDays          float64 `json:"recencyDays"`
	PayrollDescriptor    bool    `json:"payrollDescriptor"`
	SourceCategoryIncome bool    `json:"sourceCategoryIncome"`
}

// Providers return domain strength, not scores, training counts, or engine
// configuration. Pending supports asynchronous services and human queues.
type AnalysisJudgment struct {
	RequestID string `json:"requestId"`
	Status    string `json:"status" enum:"ready,pending,unavailable"`
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
