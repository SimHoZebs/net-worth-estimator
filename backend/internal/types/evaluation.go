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

// AccountBalanceConfig targets one account's own balance. It answers a
// different question from a net worth threshold: a household can clear a net
// worth target while holding no liquid reserve, and can hold a full reserve
// while net worth is negative.
type AccountBalanceConfig struct {
	AccountID string  `json:"accountId"`
	Target    float64 `json:"target"`
}

type PostingFulfillmentConfig struct {
	PostingIDs []string `json:"postingIds"` // nil = null (all)
}

// CycleFulfillmentConfig targets a statement cycle shared across a
// configured account set. It answers whether combined cycle spend stays
// within one total set-aside: the statement window derives from StatementDay
// anchored at the projection start, and spend derives from realized movement
// amounts across all listed accounts.
type CycleFulfillmentConfig struct {
	AccountIDs   []string `json:"accountIds"`
	StatementDay int      `json:"statementDay"`
	Budget       float64  `json:"budget"`
}

// EvaluationInstance is the generic configured evaluation row.
type EvaluationInstance[T any] struct {
	InstanceID string `json:"instanceId"`
	Name       string `json:"name"`
	Enabled    bool   `json:"enabled"`
	Config     T      `json:"config"`
}

// Evaluation tables carry raw JSON configs, validated lazily by
// the evaluation runtime / document validators.
type (
	FIEvaluation          = EvaluationInstance[JsonValue]
	ThresholdEvaluation   = EvaluationInstance[JsonValue]
	BalanceEvaluation     = EvaluationInstance[JsonValue]
	FulfillmentEvaluation = EvaluationInstance[JsonValue]
	CycleEvaluation       = EvaluationInstance[JsonValue]
)

type EvaluationTables struct {
	FinancialIndependence []FIEvaluation          `json:"financialIndependence"`
	NetWorthThreshold     []ThresholdEvaluation   `json:"netWorthThreshold"`
	AccountBalance        []BalanceEvaluation     `json:"accountBalance"`
	PostingFulfillment    []FulfillmentEvaluation `json:"postingFulfillment"`
	CycleFulfillment      []CycleEvaluation       `json:"cycleFulfillment"`
}

func EmptyEvaluationTables() EvaluationTables {
	return EvaluationTables{
		FinancialIndependence: []FIEvaluation{},
		NetWorthThreshold:     []ThresholdEvaluation{},
		AccountBalance:        []BalanceEvaluation{},
		PostingFulfillment:    []FulfillmentEvaluation{},
		CycleFulfillment:      []CycleEvaluation{},
	}
}

type ProjectionRuntimeSettings struct {
	FallbackProjectionStartDate IsoDate          `json:"fallbackProjectionStartDate"`
	HorizonYears                int              `json:"horizonYears"`
	Evaluations                 EvaluationTables `json:"evaluations"`
}
