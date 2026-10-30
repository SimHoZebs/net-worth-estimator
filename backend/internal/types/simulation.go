package types

// Simulation and stochastic wire types.

type FinancialModel struct {
	Accounts         []Account         `json:"accounts"`
	Postings         []Posting         `json:"postings"`
	RecurrenceRules  []RecurrenceRule  `json:"recurrenceRules"`
	PaymentTerms     []PaymentTerms    `json:"paymentTerms,omitempty"`
	PlannedPurchases []PlannedPurchase `json:"plannedPurchases,omitempty"`
}

type SimulationState struct {
	Balances                     map[string]float64            `json:"balances"`
	LatestRealizedPostingAmounts map[string]float64            `json:"latestRealizedPostingAmounts"`
	LatestRealizedPostingDates   map[string]string             `json:"latestRealizedPostingDates,omitempty"`
	RealizedPostingAmountsByYear map[string]map[string]float64 `json:"realizedPostingAmountsByYear"`
}

type MonteCarloSample struct {
	AnnualRatesByPostingID map[string][]float64 `json:"annualRatesByPostingId"`
}

type SimulationRequest struct {
	Model                  FinancialModel    `json:"model"`
	InitialState           SimulationState   `json:"initialState"`
	StartDate              IsoDate           `json:"startDate"`
	EndDate                IsoDate           `json:"endDate"`
	IncludeStartDateEvents bool              `json:"includeStartDateEvents"`
	MonteCarloSample       *MonteCarloSample `json:"monteCarloSample,omitempty"`
	// HistoryCutInstant is the single timestamp cut the replay used: start
	// dates on or before it already executed and must not simulate again.
	// Zero disables filtering (callers without an exact cut keep their
	// date window).
	HistoryCutInstant int64 `json:"historyCutInstant,omitempty"`
}

type SimulationSnapshot struct {
	Date     IsoDate            `json:"date"`
	Balances map[string]float64 `json:"balances"`
}

type SimulationRun struct {
	Request struct {
		Model                  FinancialModel `json:"model"`
		StartDate              IsoDate        `json:"startDate"`
		EndDate                IsoDate        `json:"endDate"`
		IncludeStartDateEvents bool           `json:"includeStartDateEvents"`
	} `json:"request"`
	InitialState        SimulationState      `json:"initialState"`
	FinalState          SimulationState      `json:"finalState"`
	Snapshots           []SimulationSnapshot `json:"snapshots"`
	TransactionAttempts []TransactionEvent   `json:"transactionAttempts"`
	MonteCarloSample    *MonteCarloSample    `json:"monteCarloSample,omitempty"`
}

type HistoricalObservationSnapshot struct {
	Date                  IsoDate                `json:"date"`
	Balances              map[string]float64     `json:"balances"`
	CheckpointCorrections []CheckpointCorrection `json:"checkpointCorrections,omitempty"`
}

type PreparedProjection struct {
	EffectiveDocument   FinancialModelDocument          `json:"effectiveDocument"`
	HistoricalSnapshots []HistoricalObservationSnapshot `json:"historicalSnapshots"`
	Request             SimulationRequest               `json:"request"`
}

// Stochastic types.

type StochasticConfig struct {
	RunCount int    `json:"runCount"`
	Seed     *int64 `json:"seed"` // nil = unseeded (fresh random draw)
}

type StochasticProgressPhase string

const (
	PhasePreparing                StochasticProgressPhase = "preparing"
	PhaseDeterministicEvaluations StochasticProgressPhase = "deterministic-evaluations"
	PhaseStochasticRuns           StochasticProgressPhase = "stochastic-runs"
)

type StochasticEvaluationWorkload struct {
	Type                    string `json:"type"`
	InstanceID              string `json:"instanceId"`
	Name                    string `json:"name"`
	CompletedUnits          int    `json:"completedUnits"`
	TotalUnits              int    `json:"totalUnits"`
	UnitLabel               string `json:"unitLabel"`
	UnitAction              string `json:"unitAction"`
	IntensiveUnitsCompleted *int   `json:"intensiveUnitsCompleted,omitempty"`
	IntensiveUnitLabel      string `json:"intensiveUnitLabel,omitempty"`
	IntensiveUnitAction     string `json:"intensiveUnitAction,omitempty"`
	Description             string `json:"description,omitempty"`
}

type StochasticProgress struct {
	Phase               StochasticProgressPhase        `json:"phase"`
	CompletedRuns       int                            `json:"completedRuns"`
	TotalRuns           int                            `json:"totalRuns"`
	Fraction            float64                        `json:"fraction"`
	EvaluationWorkloads []StochasticEvaluationWorkload `json:"evaluationWorkloads"`
}

type PercentileBands struct {
	P10 float64 `json:"p10"`
	P25 float64 `json:"p25"`
	P50 float64 `json:"p50"`
	P75 float64 `json:"p75"`
	P90 float64 `json:"p90"`
}

type StochasticBandRow struct {
	Date         IsoDate         `json:"date"`
	IsHistorical bool            `json:"isHistorical"`
	NetWorth     PercentileBands `json:"netWorth"`
}
