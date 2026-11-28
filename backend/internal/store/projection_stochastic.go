package store

import "github.com/simhozebs/net-worth-estimator/backend/internal/types"

// StochasticEvaluationOutputs is one complete typed evaluation result set.
// Statistics and these rows are published together for one stochastic build.
type StochasticEvaluationOutputs struct {
	NetWorthThreshold      []types.NetWorthThresholdOutput
	AccountBalance         []types.AccountBalanceOutput
	TransactionFulfillment []types.TransactionFulfillmentOutput
	CycleFulfillment       []types.CycleFulfillmentOutput
	PlannedPurchases       []types.PlannedPurchasesOutput
	FinancialIndependence  []types.FinancialIndependenceOutput
	WhatIf                 []types.WhatIfOutput
}

// StochasticProjectionWrite replaces one published range atomically. The
// revision and dirty guard rejects stale builds. AllowSettingsSync permits the
// first range to replace an unset default count; PreviousTrialCount fences that
// synchronization against a concurrent first publication.
type StochasticProjectionWrite struct {
	StateID            string
	Revision           int64
	DirtyFrom          int64
	TrialCount         int
	Seed               *int64
	EvaluationsJSON    string
	PreviousTrialCount int
	AllowSettingsSync  bool
	Statistics         []types.MonteCarloStatistic
	Outputs            StochasticEvaluationOutputs
}

// StochasticProjectionRead is a consistent snapshot of one published range.
// ProjectionDates supplies the deterministic timeline used to verify complete
// statistic coverage before the range is served.
type StochasticProjectionRead struct {
	State           types.ProjectionState
	Slices          []types.ProjectionSlice
	Statistics      []types.MonteCarloStatistic
	ProjectionDates []string
	Outputs         StochasticEvaluationOutputs
}
