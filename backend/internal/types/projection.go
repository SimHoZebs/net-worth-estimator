package types

// Projection output types: movement events, path rows, public results.

type AccountDelta struct {
	PostingID string  `json:"postingId"`
	Delta     float64 `json:"delta"`
}

// MovementOrigin mirrors {"type":"posting","postingId":"..."}.
type MovementOrigin struct {
	Type      string `json:"type"` // always "posting"
	PostingID string `json:"postingId"`
}

type IncomeResolverEvent struct {
	Resolver                    string  `json:"resolver"`
	RequestedAmount             float64 `json:"requestedAmount"`
	RealizedAmount              float64 `json:"realizedAmount"`
	DestinationAccountID        *string `json:"destinationAccountId"`
	TaxableAmountAfter          float64 `json:"taxableAmountAfter"`
	EmployerMatchAmount         float64 `json:"employerMatchAmount"`
	EmployerMatchRealizedAmount float64 `json:"employerMatchRealizedAmount"`
}

type IncomeEvent struct {
	AnnualGrossIncome      float64               `json:"annualGrossIncome"`
	GrossAmount            float64               `json:"grossAmount"`
	Resolvers              []IncomeResolverEvent `json:"resolvers"`
	NetCashRequested       float64               `json:"netCashRequested"`
	NetCashRealized        float64               `json:"netCashRealized"`
	EmployerMatchRequested float64               `json:"employerMatchRequested"`
	EmployerMatchRealized  float64               `json:"employerMatchRealized"`
}

type MovementEvent struct {
	Date            IsoDate        `json:"date"`
	Sequence        int            `json:"sequence"`
	Origin          MovementOrigin `json:"origin"`
	RequestedAmount float64        `json:"requestedAmount"`
	RealizedAmount  float64        `json:"realizedAmount"`
	AccountDeltas   []struct {
		AccountID string  `json:"accountId"`
		Delta     float64 `json:"delta"`
	} `json:"accountDeltas"`
	Income *IncomeEvent `json:"income,omitempty"`
}

type AccountSnapshot struct {
	AccountID string         `json:"accountId"`
	Date      IsoDate        `json:"date"`
	Balance   float64        `json:"balance"`
	Impacts   []AccountDelta `json:"impacts"`
}

type ProjectionRow struct {
	Date                   IsoDate                `json:"date"`
	IsHistorical           bool                   `json:"isHistorical"`
	NetWorth               float64                `json:"netWorth"`
	AccountSnapshots       []AccountSnapshot      `json:"accountSnapshots"`
	ExternalInflowAmount   float64                `json:"externalInflowAmount"`
	ExternalOutflowAmount  float64                `json:"externalOutflowAmount"`
	InternalTransferAmount float64                `json:"internalTransferAmount"`
	CheckpointCorrections  []CheckpointCorrection `json:"checkpointCorrections"`
}

type ProjectionAccountSummary struct {
	AccountID       string  `json:"accountId"`
	Label           string  `json:"label"`
	Color           *string `json:"color"`
	Enabled         bool    `json:"enabled"`
	StartingBalance float64 `json:"startingBalance"`
	EndingBalance   float64 `json:"endingBalance"`
}

type ProjectionCoreResult struct {
	Timeline struct {
		Rows        []ProjectionRow `json:"rows"`
		SampledRows []ProjectionRow `json:"sampledRows"`
	} `json:"timeline"`
	AccountSummaries []ProjectionAccountSummary `json:"accountSummaries"`
	Totals           struct {
		ExternalInflowAmount   float64 `json:"externalInflowAmount"`
		ExternalOutflowAmount  float64 `json:"externalOutflowAmount"`
		InternalTransferAmount float64 `json:"internalTransferAmount"`
	} `json:"totals"`
	Milestones struct {
		LatestHistoricalDate *IsoDate `json:"latestHistoricalDate"`
		ProjectionStartDate  IsoDate  `json:"projectionStartDate"`
	} `json:"milestones"`
	Summary struct {
		CurrentNetWorth float64 `json:"currentNetWorth"`
		FinalNetWorth   float64 `json:"finalNetWorth"`
	} `json:"summary"`
}

type ProjectionResult struct {
	Timeline struct {
		Rows        []ProjectionRow `json:"rows"`
		SampledRows []ProjectionRow `json:"sampledRows"`
	} `json:"timeline"`
	AccountSummaries []ProjectionAccountSummary `json:"accountSummaries"`
	Totals           struct {
		ExternalInflowAmount   float64 `json:"externalInflowAmount"`
		ExternalOutflowAmount  float64 `json:"externalOutflowAmount"`
		InternalTransferAmount float64 `json:"internalTransferAmount"`
	} `json:"totals"`
	Milestones struct {
		LatestHistoricalDate *IsoDate `json:"latestHistoricalDate"`
		ProjectionStartDate  IsoDate  `json:"projectionStartDate"`
	} `json:"milestones"`
	Summary struct {
		CurrentNetWorth float64 `json:"currentNetWorth"`
		FinalNetWorth   float64 `json:"finalNetWorth"`
	} `json:"summary"`
	Evaluations EvaluationResultTables `json:"evaluations"`
}

// ProjectionPath is the evaluator-facing immutable timeline.
type ProjectionPath struct {
	Rows                        []ProjectionRow        `json:"rows"`
	MovementEvents              []MovementEvent        `json:"movementEvents"`
	EffectiveDocument           FinancialModelDocument `json:"effectiveDocument"`
	IncomeData                  *IncomeDataSnapshot    `json:"incomeData,omitempty"`
	ProjectionStartPostingState struct {
		LatestRealizedPostingAmounts map[string]float64            `json:"latestRealizedPostingAmounts"`
		RealizedPostingAmountsByYear map[string]map[string]float64 `json:"realizedPostingAmountsByYear"`
	} `json:"projectionStartPostingState"`
	ProjectionStartDate IsoDate `json:"projectionStartDate"`
	ProjectionEndDate   IsoDate `json:"projectionEndDate"`
}

type StochasticProjectionResult struct {
	Config        StochasticConfig    `json:"config"`
	Deterministic ProjectionResult    `json:"deterministic"`
	Bands         []StochasticBandRow `json:"bands"`
	Milestones    struct {
		FinalNetWorthPercentiles PercentileBands `json:"finalNetWorthPercentiles"`
	} `json:"milestones"`
	Evaluations EvaluationResultTables `json:"evaluations"`
}
