package types

// Financial-health descriptive checks (FIN-03). These are point-in-time
// assessments of recorded state: current balances plus realized one-time
// flows in a lookback window. They are distinct from projection-goal
// evaluations (financial independence, thresholds, fulfillment), which
// answer forward questions about a simulated path. Health checks reuse the
// underlying measurements (net worth, counterparty classification, payment
// terms, account bounds) without running a projection.
//
// Every verdict is relative to caller-supplied standards. The defaults in
// DefaultFinancialHealthStandards are adjustable starting points, not
// universal requirements, and every result echoes the applied thresholds.

// FinancialHealthStatus is the outcome of one descriptive check.
type FinancialHealthStatus string

const (
	// FinancialHealthMeeting means the realized value meets the configured guideline.
	FinancialHealthMeeting FinancialHealthStatus = "meeting"
	// FinancialHealthAtRisk means the realized value misses the configured
	// guideline but stays within the configured risk band.
	FinancialHealthAtRisk FinancialHealthStatus = "at-risk"
	// FinancialHealthNotMeeting means the realized value misses even the
	// configured risk band.
	FinancialHealthNotMeeting FinancialHealthStatus = "not-meeting"
	// FinancialHealthInsufficientData means the saved state has too little
	// evidence to compute the check. It is never reported as a failure.
	FinancialHealthInsufficientData FinancialHealthStatus = "insufficient-data"
)

// Financial-health check identifiers, in display order.
const (
	FinancialHealthCheckEmergencyCoverage      = "emergency-coverage"
	FinancialHealthCheckCashFlowSustainability = "cash-flow-sustainability"
	FinancialHealthCheckDebtBurden             = "debt-burden"
	FinancialHealthCheckHighInterestDebt       = "high-interest-debt"
	FinancialHealthCheckSavingsRate            = "savings-rate"
	FinancialHealthCheckUtilization            = "utilization"
	FinancialHealthCheckSpendingConsistency    = "spending-consistency"
)

// FinancialHealthCheckOrder fixes check ordering; the report preserves it.
var FinancialHealthCheckOrder = []string{
	FinancialHealthCheckEmergencyCoverage,
	FinancialHealthCheckCashFlowSustainability,
	FinancialHealthCheckDebtBurden,
	FinancialHealthCheckHighInterestDebt,
	FinancialHealthCheckSavingsRate,
	FinancialHealthCheckUtilization,
	FinancialHealthCheckSpendingConsistency,
}

// FinancialHealthStandards carries every adjustable guideline a health check
// compares against. Zero values are normalized by
// NormalizeFinancialHealthStandards; callers should start from
// DefaultFinancialHealthStandards and adjust openly.
type FinancialHealthStandards struct {
	// LookbackDays bounds the realized-flow window ending at the as-of cut.
	LookbackDays int `json:"lookbackDays"`
	// LiquidAccountIDs names the accounts counted as spendable reserves
	// for emergency coverage. Coverage is a caller configuration: the
	// backend holds no account-type taxonomy, so callers pass the IDs
	// openly instead of naming kinds.
	LiquidAccountIDs []string `json:"liquidAccountIds"`
	// EmergencyMeetMonths is the configured reserve guideline in months of
	// average outflow. EmergencyRiskMonths is the lower band edge.
	EmergencyMeetMonths float64 `json:"emergencyMeetMonths"`
	EmergencyRiskMonths float64 `json:"emergencyRiskMonths"`
	// CashFlowRiskRatio is the inflow/outflow band edge; meeting is >= 1.
	CashFlowRiskRatio float64 `json:"cashFlowRiskRatio"`
	// DebtBurdenMeetRatio and DebtBurdenRiskRatio bound required monthly
	// minimums over average monthly inflow.
	DebtBurdenMeetRatio float64 `json:"debtBurdenMeetRatio"`
	DebtBurdenRiskRatio float64 `json:"debtBurdenRiskRatio"`
	// CarriedBalanceTolerance is the carried revolving balance treated as
	// meeting the high-interest proxy; CarriedBalanceRiskAmount is the band
	// edge. The model carries no rate data, so this check treats carried
	// revolving balances as the proxy and says so in its evidence.
	CarriedBalanceTolerance  float64 `json:"carriedBalanceTolerance"`
	CarriedBalanceRiskAmount float64 `json:"carriedBalanceRiskAmount"`
	// SavingsRateMeet is the configured (inflow-outflow)/inflow guideline.
	// At-risk covers [0, meet); negative is not meeting.
	SavingsRateMeet float64 `json:"savingsRateMeet"`
	// UtilizationMeetRatio and UtilizationRiskRatio bound the
	// limit-weighted average drawn ratio.
	UtilizationMeetRatio float64 `json:"utilizationMeetRatio"`
	UtilizationRiskRatio float64 `json:"utilizationRiskRatio"`
	// ConsistencyMeetCV and ConsistencyRiskCV bound the coefficient of
	// variation of monthly outflow across the window.
	ConsistencyMeetCV float64 `json:"consistencyMeetCV"`
	ConsistencyRiskCV float64 `json:"consistencyRiskCV"`
}

// DefaultFinancialHealthStandards returns adjustable starting points. These
// are common rules of thumb, not universal requirements: callers must
// present them as configured guidelines and let the user change them.
func DefaultFinancialHealthStandards() FinancialHealthStandards {
	return FinancialHealthStandards{
		LookbackDays:             90,
		LiquidAccountIDs:         nil,
		EmergencyMeetMonths:      3,
		EmergencyRiskMonths:      1,
		CashFlowRiskRatio:        0.9,
		DebtBurdenMeetRatio:      0.2,
		DebtBurdenRiskRatio:      0.36,
		CarriedBalanceTolerance:  0,
		CarriedBalanceRiskAmount: 1000,
		SavingsRateMeet:          0.2,
		UtilizationMeetRatio:     0.3,
		UtilizationRiskRatio:     0.5,
		ConsistencyMeetCV:        0.3,
		ConsistencyRiskCV:        0.5,
	}
}

// FinancialHealthEvidenceItem is one inspectable fact behind a check:
// a balance, a dated flow, a threshold application, or a limitation.
type FinancialHealthEvidenceItem struct {
	Label          string   `json:"label"`
	Detail         string   `json:"detail"`
	Amount         *float64 `json:"amount,omitempty"`
	AccountIDs     []string `json:"accountIds,omitempty"`
	TransactionIDs []string `json:"transactionIds,omitempty"`
	Date           *IsoDate `json:"date,omitempty"`
}

// FinancialHealthCheckResult carries one check's input, calculation,
// applied thresholds, and evidence alongside its verdict.
type FinancialHealthCheckResult struct {
	CheckID     string                        `json:"checkId"`
	Status      FinancialHealthStatus         `json:"status"`
	Summary     string                        `json:"summary"`
	Value       *float64                      `json:"value,omitempty"`
	Input       map[string]float64            `json:"input"`
	Calculation string                        `json:"calculation"`
	Threshold   map[string]float64            `json:"threshold"`
	Evidence    []FinancialHealthEvidenceItem `json:"evidence"`
}

// FinancialHealthFlowCoverage reports how much of the window's recorded
// activity the flow-based checks could use. Unresolvable amounts (formula
// descriptors that need simulation context) and non-flow rows (transfers,
// pending, void, disabled) are counted, never silently dropped.
type FinancialHealthFlowCoverage struct {
	WindowTransactions   int      `json:"windowTransactions"`
	ResolvedTransactions int      `json:"resolvedTransactions"`
	ExcludedTransactions int      `json:"excludedTransactions"`
	ExcludedIDs          []string `json:"excludedIds"`
	InflowTotal          float64  `json:"inflowTotal"`
	OutflowTotal         float64  `json:"outflowTotal"`
}

// FinancialHealthReport is the complete FIN-03 output: one result per
// check in FinancialHealthCheckOrder plus the shared flow coverage.
type FinancialHealthReport struct {
	AsOfDate     IsoDate                      `json:"asOfDate"`
	WindowStart  IsoDate                      `json:"windowStart"`
	WindowEnd    IsoDate                      `json:"windowEnd"`
	Standards    FinancialHealthStandards     `json:"standards"`
	Checks       []FinancialHealthCheckResult `json:"checks"`
	FlowCoverage FinancialHealthFlowCoverage  `json:"flowCoverage"`
}
