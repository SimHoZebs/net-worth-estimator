package types

// FIPrincipalPolicy and FIExpenseBasis enums.
type (
	FIPrincipalPolicy string
	FIExpenseBasis    string
)

const (
	PrincipalAllowDrawdown   FIPrincipalPolicy = "allow-drawdown"
	PrincipalPreserveNominal FIPrincipalPolicy = "preserve-nominal-principal"
	PrincipalPreserveReal    FIPrincipalPolicy = "preserve-real-principal"

	ExpenseBasisProjectionStart FIExpenseBasis = "projection-start-purchasing-power"
	ExpenseBasisFIDateDollars   FIExpenseBasis = "fi-date-dollars"
)

type FISource struct {
	Type                   string   `json:"type"` // "cashflow" | "asset"
	PostingID              string   `json:"postingId,omitempty"`
	AccountID              string   `json:"accountId,omitempty"`
	Included               bool     `json:"included"`
	WithdrawalRateOverride *float64 `json:"withdrawalRateOverride,omitempty"`
}

type FIPlan struct {
	MinimumNetWorth          float64           `json:"minimumNetWorth"`
	AnnualExpenseTarget      float64           `json:"annualExpenseTarget"`
	AnnualExpenseTargetBasis FIExpenseBasis    `json:"annualExpenseTargetBasis"`
	AnnualExpenseGrowthRate  float64           `json:"annualExpenseGrowthRate"`
	WithdrawalRate           float64           `json:"withdrawalRate"`
	EvaluationYears          int               `json:"evaluationYears"`
	RequiredConfidence       float64           `json:"requiredConfidence"`
	Sources                  []FISource        `json:"sources"`
	ContinuingPostingIDs     []string          `json:"continuingPostingIds"`
	PrincipalPolicy          FIPrincipalPolicy `json:"principalPolicy"`
}

type NetWorthThresholdConfig struct {
	Target float64 `json:"target"`
}

type PostingFulfillmentConfig struct {
	PostingIDs []string `json:"postingIds"` // nil = null (all)
}

// EvaluationInstance is the generic configured evaluation row.
type EvaluationInstance[T any] struct {
	InstanceID string `json:"instanceId"`
	Label      string `json:"label"`
	Enabled    bool   `json:"enabled"`
	Config     T      `json:"config"`
}

// Evaluation tables carry raw JSON configs (matching TS), validated lazily by
// the evaluation runtime / document validators.
type (
	FIEvaluation          = EvaluationInstance[JsonValue]
	ThresholdEvaluation   = EvaluationInstance[JsonValue]
	FulfillmentEvaluation = EvaluationInstance[JsonValue]
)

type EvaluationTables struct {
	FinancialIndependence []FIEvaluation          `json:"financialIndependence"`
	NetWorthThreshold     []ThresholdEvaluation   `json:"netWorthThreshold"`
	PostingFulfillment    []FulfillmentEvaluation `json:"postingFulfillment"`
}

func EmptyEvaluationTables() EvaluationTables {
	return EvaluationTables{
		FinancialIndependence: []FIEvaluation{},
		NetWorthThreshold:     []ThresholdEvaluation{},
		PostingFulfillment:    []FulfillmentEvaluation{},
	}
}

type ProjectionRuntimeSettings struct {
	FallbackProjectionStartDate IsoDate          `json:"fallbackProjectionStartDate"`
	HorizonYears                int              `json:"horizonYears"`
	Evaluations                 EvaluationTables `json:"evaluations"`
}
