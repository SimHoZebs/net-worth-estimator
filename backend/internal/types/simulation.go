package types

// Simulation-layer types (types/simulation.ts) and stochastic types
// (types/stochastic.ts).

type FinancialModel struct {
	Accounts []Account `json:"accounts"`
	Postings []Posting `json:"postings"`
}

type SimulationState struct {
	Balances                     map[string]float64            `json:"balances"`
	LatestRealizedPostingAmounts map[string]float64            `json:"latestRealizedPostingAmounts"`
	RealizedPostingAmountsByYear map[string]map[string]float64 `json:"realizedPostingAmountsByYear"`
}

type MonteCarloSample struct {
	AnnualRatesByPostingID map[string][]float64 `json:"annualRatesByPostingId"`
}

type SimulationRequest struct {
	Model                  FinancialModel      `json:"model"`
	IncomeData             *IncomeDataSnapshot `json:"incomeData,omitempty"`
	InitialState           SimulationState     `json:"initialState"`
	StartDate              IsoDate             `json:"startDate"`
	EndDate                IsoDate             `json:"endDate"`
	IncludeStartDateEvents bool                `json:"includeStartDateEvents"`
	MonteCarloSample       *MonteCarloSample   `json:"monteCarloSample,omitempty"`
}

type SimulationSnapshot struct {
	Date     IsoDate            `json:"date"`
	Balances map[string]float64 `json:"balances"`
}

type SimulationRun struct {
	Request struct {
		Model                  FinancialModel      `json:"model"`
		StartDate              IsoDate             `json:"startDate"`
		EndDate                IsoDate             `json:"endDate"`
		IncludeStartDateEvents bool                `json:"includeStartDateEvents"`
		IncomeData             *IncomeDataSnapshot `json:"incomeData,omitempty"`
	} `json:"request"`
	InitialState     SimulationState      `json:"initialState"`
	FinalState       SimulationState      `json:"finalState"`
	Snapshots        []SimulationSnapshot `json:"snapshots"`
	MovementAttempts []MovementEvent      `json:"movementAttempts"`
	MonteCarloSample *MonteCarloSample    `json:"monteCarloSample,omitempty"`
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
	Seed     *int64 `json:"seed"` // nil = unseeded (Math.random equivalent)
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
	Label                   string `json:"label"`
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
