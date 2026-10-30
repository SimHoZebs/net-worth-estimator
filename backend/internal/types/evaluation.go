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
// anchored at the projection start, and spend derives from realized transaction
// amounts across all listed accounts.
type CycleFulfillmentConfig struct {
	AccountIDs   []string `json:"accountIds"`
	StatementDay int      `json:"statementDay"`
	Budget       float64  `json:"budget"`
}

// WhatIfConfig carries hypothetical additions, disables, and modified copies
// on top of saved state. A modified row is represented as a disable plus an
// addition with the same identity. The simulator overlays this set in a branch
// without mutating saved rows. Promote replays it as sequential row writes.
type WhatIfConfig struct {
	AddedAccounts      []Account        `json:"addedAccounts,omitempty"`
	AddedPostings      []Posting        `json:"addedPostings,omitempty"`
	AddedRules         []RecurrenceRule `json:"addedRules,omitempty"`
	DisabledAccountIDs []string         `json:"disabledAccountIds,omitempty"`
	DisabledPostingIDs []string         `json:"disabledPostingIds,omitempty"`
	DisabledRuleIDs    []string         `json:"disabledRuleIds,omitempty"`
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
	WhatIfEvaluation      = EvaluationInstance[JsonValue]
)

type EvaluationTables struct {
	FinancialIndependence []FIEvaluation                  `json:"financialIndependence"`
	NetWorthThreshold     []ThresholdEvaluation           `json:"netWorthThreshold"`
	AccountBalance        []BalanceEvaluation             `json:"accountBalance"`
	PostingFulfillment    []FulfillmentEvaluation         `json:"postingFulfillment"`
	CycleFulfillment      []CycleEvaluation               `json:"cycleFulfillment"`
	PlannedPurchases      []EvaluationInstance[JsonValue] `json:"plannedPurchases,omitempty"`
	WhatIf                []WhatIfEvaluation              `json:"whatIf,omitempty"`
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
