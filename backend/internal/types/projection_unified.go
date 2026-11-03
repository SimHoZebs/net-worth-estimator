package types

// Unified projection wire types. Source decides fact versus output.
// Facts use user or banksync. Engine output uses projected.

const (
	TransactionSourceUser      = "user"
	TransactionSourceBankSync  = "banksync"
	TransactionSourceProjected = "projected"
)

// ProviderConnection tracks one bank bridge connection per scope.
type ProviderConnection struct {
	ID           string `json:"id"`
	ProviderKey  string `json:"providerKey"`
	Status       string `json:"status"`
	SyncCursor   string `json:"syncCursor"`
	LastSyncedAt string `json:"lastSyncedAt"`
}

// ProjectionState owns one scope projection build.
type ProjectionState struct {
	ID                string `json:"id"`
	ScopeID           string `json:"scopeId"`
	Revision          int64  `json:"revision"`
	PublishedRevision int64  `json:"publishedRevision"`
	DirtyFrom         int64  `json:"dirtyFrom"`
	ProjectionStart   string `json:"projectionStart"`
	HorizonEnd        string `json:"horizonEnd"`
	CalendarTimezone  string `json:"calendarTimezone"`
	EngineVersion     string `json:"engineVersion"`
	TrialCount        int    `json:"trialCount"`
	StochasticSeed    *int64 `json:"stochasticSeed,omitempty"`
	// DetEvaluationsJSON and StochEvaluationsJSON record the canonical
	// evaluation tables the stored outputs were built with. A request
	// with different tables bypasses the stored outputs and computes.
	DetEvaluationsJSON   string `json:"detEvaluationsJson"`
	StochEvaluationsJSON string `json:"stochEvaluationsJson"`
}

// ProjectionSlice is one contiguous date range in a state build.
type ProjectionSlice struct {
	ID                string `json:"id"`
	ProjectionStateID string `json:"projectionStateId"`
	FromAt            int64  `json:"fromAt"`
	ToAt              int64  `json:"toAt"`
	BuiltRevision     int64  `json:"builtRevision"`
	Status            string `json:"status"`
}

// MonteCarloStatistic is one per account per instant band summary.
type MonteCarloStatistic struct {
	ID                   string  `json:"id"`
	ProjectionSliceID    string  `json:"projectionSliceId"`
	AccountID            string  `json:"accountId"`
	AsOfAt               string  `json:"asOfAt"`
	SampleCount          int     `json:"sampleCount"`
	Mean                 float64 `json:"mean"`
	Median               float64 `json:"median"`
	P10                  float64 `json:"p10"`
	P25                  float64 `json:"p25"`
	P50                  float64 `json:"p50"`
	P75                  float64 `json:"p75"`
	P90                  float64 `json:"p90"`
	StdDev               float64 `json:"stdDev"`
	ProbabilityBelowZero float64 `json:"probabilityBelowZero"`
}

// EvaluationOutputBase carries the envelope identity every stored output
// table shares. One row per state, kind, and instance; kind separates the
// deterministic build from the stochastic build.
type EvaluationOutputBase struct {
	StateID          string `json:"stateId"`
	Kind             string `json:"kind"`
	InstanceID       string `json:"instanceId"`
	Name             string `json:"name"`
	Position         int    `json:"position"`
	Status           string `json:"status"`
	DiagnosticsJSON  string `json:"diagnosticsJson"`
	BuiltRevision    int64  `json:"builtRevision"`
	HasDeterministic bool   `json:"hasDeterministic"`
	HasProbabilistic bool   `json:"hasProbabilistic"`
}

// NetWorthThresholdOutput is one stored net-worth threshold result.
type NetWorthThresholdOutput struct {
	EvaluationOutputBase
	Reached          *bool    `json:"reached"`
	FirstReachedDate *string  `json:"firstReachedDate"`
	ProbProbability  *float64 `json:"probProbability"`
	ProbP10Date      *string  `json:"probP10Date"`
	ProbMedianDate   *string  `json:"probMedianDate"`
	ProbP90Date      *string  `json:"probP90Date"`
}

// AccountBalanceOutput is one stored account-balance result.
type AccountBalanceOutput struct {
	EvaluationOutputBase
	Reached          *bool    `json:"reached"`
	FirstReachedDate *string  `json:"firstReachedDate"`
	ProbProbability  *float64 `json:"probProbability"`
	ProbP10Date      *string  `json:"probP10Date"`
	ProbMedianDate   *string  `json:"probMedianDate"`
	ProbP90Date      *string  `json:"probP90Date"`
}

// PostingFulfillmentOutput is one stored posting-fulfillment result.
// Scalar evidence is typed; variable-length event evidence stays verbatim
// JSON so served bytes match the computed envelopes exactly.
type PostingFulfillmentOutput struct {
	EvaluationOutputBase
	RequestedAmount          *float64 `json:"requestedAmount"`
	RealizedAmount           *float64 `json:"realizedAmount"`
	DestinationLimitedAmount *float64 `json:"destinationLimitedAmount"`
	UnfulfilledAmount        *float64 `json:"unfulfilledAmount"`
	CompletionRate           *float64 `json:"completionRate"`
	FirstUnderfulfilledDate  *string  `json:"firstUnderfulfilledDate"`
	EventsJSON               string   `json:"eventsJson"`
	DatesJSON                string   `json:"datesJson"`
	PostingsJSON             string   `json:"postingsJson"`
	ProbRunCount             *int     `json:"probRunCount"`
	ProbFulfilledCount       *int     `json:"probFulfilledCount"`
	ProbFullProbability      *float64 `json:"probFullProbability"`
	ProbUnfulfilledP10       *float64 `json:"probUnfulfilledP10"`
	ProbUnfulfilledP25       *float64 `json:"probUnfulfilledP25"`
	ProbUnfulfilledP50       *float64 `json:"probUnfulfilledP50"`
	ProbUnfulfilledP75       *float64 `json:"probUnfulfilledP75"`
	ProbUnfulfilledP90       *float64 `json:"probUnfulfilledP90"`
}

// CycleFulfillmentOutput is one stored cycle-fulfillment result.
type CycleFulfillmentOutput struct {
	EvaluationOutputBase
	AccountIDsJSON        string   `json:"accountIdsJson"`
	StatementDay          *int     `json:"statementDay"`
	Budget                *float64 `json:"budget"`
	CycleStart            *string  `json:"cycleStart"`
	CycleEnd              *string  `json:"cycleEnd"`
	WindowStart           *string  `json:"windowStart"`
	DaysTotal             *int     `json:"daysTotal"`
	DaysLeft              *int     `json:"daysLeft"`
	RecordedSpend         *float64 `json:"recordedSpend"`
	ScheduledSpend        *float64 `json:"scheduledSpend"`
	Spent                 *float64 `json:"spent"`
	Remaining             *float64 `json:"remaining"`
	WithinBudget          *bool    `json:"withinBudget"`
	Shortfall             *float64 `json:"shortfall"`
	ProbRunCount          *int     `json:"probRunCount"`
	ProbWithinCount       *int     `json:"probWithinCount"`
	ProbWithinProbability *float64 `json:"probWithinProbability"`
	ProbSpentP10          *float64 `json:"probSpentP10"`
	ProbSpentP25          *float64 `json:"probSpentP25"`
	ProbSpentP50          *float64 `json:"probSpentP50"`
	ProbSpentP75          *float64 `json:"probSpentP75"`
	ProbSpentP90          *float64 `json:"probSpentP90"`
}

// PlannedPurchasesOutput is one stored planned-purchases result.
type PlannedPurchasesOutput struct {
	EvaluationOutputBase
	AllFunded        *bool    `json:"allFunded"`
	FirstReachedDate *string  `json:"firstReachedDate"`
	PurchasesJSON    string   `json:"purchasesJson"`
	ProbProbability  *float64 `json:"probProbability"`
	ProbP10Date      *string  `json:"probP10Date"`
	ProbMedianDate   *string  `json:"probMedianDate"`
	ProbP90Date      *string  `json:"probP90Date"`
}

// FinancialIndependenceOutput is one stored financial-independence result.
// Headline fields are typed; the full branch evidence document stays
// verbatim JSON because it nests arbitrarily deep.
type FinancialIndependenceOutput struct {
	EvaluationOutputBase
	FirstCoverageDate       *string  `json:"firstCoverageDate"`
	FirstSelfSustainingDate *string  `json:"firstSelfSustainingDate"`
	DetailJSON              string   `json:"detailJson"`
	ProbSuccess             *float64 `json:"probSuccess"`
	ProbMedianDate          *string  `json:"probMedianDate"`
	ProbSelfSustainingDate  *string  `json:"probSelfSustainingDate"`
	ProbSelfSustainingProb  *float64 `json:"probSelfSustainingProb"`
}

// WhatIfOutput is one stored what-if result.
type WhatIfOutput struct {
	EvaluationOutputBase
	FinalNetWorth        *float64 `json:"finalNetWorth"`
	TransactionCount     *int     `json:"transactionCount"`
	FirstUnfulfilledDate *string  `json:"firstUnfulfilledDate"`
	AllFunded            *bool    `json:"allFunded"`
	ProbFullProbability  *float64 `json:"probFullProbability"`
	ProbSampleCount      *int     `json:"probSampleCount"`
}

// UnifiedProjectionDefaults owns assumed defaults for fresh states.
func UnifiedProjectionDefaults() ProjectionState {
	return ProjectionState{
		CalendarTimezone: "UTC",
		EngineVersion:    "v1",
		TrialCount:       1000,
	}
}
