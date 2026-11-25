package types

// Simulation and stochastic wire types.

// SimulationInputs contains the executable rows for a prepared simulation.
type SimulationInputs struct {
	Accounts         []Account         `json:"accounts"`
	Transactions     []Transaction     `json:"transactions"`
	Schedules        []Schedule        `json:"schedules"`
	PaymentTerms     []PaymentTerms    `json:"paymentTerms,omitempty"`
	PlannedPurchases []PlannedPurchase `json:"plannedPurchases,omitempty"`
}

type SimulationState struct {
	Balances                         map[string]float64            `json:"balances"`
	LatestRealizedTransactionAmounts map[string]float64            `json:"latestRealizedTransactionAmounts"`
	LatestRealizedTransactionDates   map[string]string             `json:"latestRealizedTransactionDates,omitempty"`
	RealizedTransactionAmountsByYear map[string]map[string]float64 `json:"realizedTransactionAmountsByYear"`
}

type MonteCarloSample struct {
	AnnualRatesByTransactionID map[string][]float64 `json:"annualRatesByTransactionId"`
}

type SimulationRequest struct {
	Model                  SimulationInputs  `json:"model"`
	InitialState           SimulationState   `json:"initialState"`
	StartDate              IsoDate           `json:"startDate"`
	EndDate                IsoDate           `json:"endDate"`
	IncludeStartDateEvents bool              `json:"includeStartDateEvents"`
	MonteCarloSample       *MonteCarloSample `json:"monteCarloSample,omitempty"`
	// HistoryCutInstant is the single timestamp cut that history application used: start
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
		Model                  SimulationInputs `json:"model"`
		StartDate              IsoDate          `json:"startDate"`
		EndDate                IsoDate          `json:"endDate"`
		IncludeStartDateEvents bool             `json:"includeStartDateEvents"`
	} `json:"request"`
	InitialState        SimulationState      `json:"initialState"`
	FinalState          SimulationState      `json:"finalState"`
	Snapshots           []SimulationSnapshot `json:"snapshots"`
	TransactionAttempts []TransactionEvent   `json:"transactionAttempts"`
	MonteCarloSample    *MonteCarloSample    `json:"monteCarloSample,omitempty"`
}

type HistoricalObservationSnapshot struct {
	Date     IsoDate            `json:"date"`
	Balances map[string]float64 `json:"balances"`
}

type PreparedProjection struct {
	EffectiveModel      FinancialModel                  `json:"effectiveModel"`
	HistoricalSnapshots []HistoricalObservationSnapshot `json:"historicalSnapshots"`
	Request             SimulationRequest               `json:"request"`
}

// Stochastic types.

type StochasticConfig struct {
	RunCount int    `json:"runCount"`
	Seed     *int64 `json:"seed"` // nil = unseeded (fresh random draw)
}

type StochasticProgress struct {
	CompletedRuns int     `json:"completedRuns"`
	TotalRuns     int     `json:"totalRuns"`
	Fraction      float64 `json:"fraction"`
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
