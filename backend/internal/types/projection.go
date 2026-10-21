package types

// Projection output types: movement events, path rows, public results.

type AccountDelta struct {
	PostingID string  `json:"postingId"`
	Delta     float64 `json:"delta"`
}

// MovementOrigin has the posting movement-origin JSON shape.
type MovementOrigin struct {
	Type      string `json:"type"` // always "posting"
	PostingID string `json:"postingId"`
}

// MovementFulfillment is the per-event assessment shared by public evidence
// and configured posting-fulfillment evaluations. Destination limits do not
// count as unfulfilled funding.
type MovementFulfillment struct {
	UnfulfilledAmount        float64 `json:"unfulfilledAmount"`
	DestinationLimitedAmount float64 `json:"destinationLimitedAmount"`
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
	BindingConstraints []JsonValue          `json:"bindingConstraints,omitempty"`
	AvailableAmount    *float64             `json:"availableAmount,omitempty"`
	Fulfillment        *MovementFulfillment `json:"fulfillment,omitempty"`
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
	Name            string  `json:"name"`
	Color           *string `json:"color"`
	Enabled         bool    `json:"enabled"`
	StartingBalance float64 `json:"startingBalance"`
	EndingBalance   float64 `json:"endingBalance"`
}

type ProjectionCoreResult struct {
	Timeline struct {
		Rows []ProjectionRow `json:"rows"`
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
		Rows []ProjectionRow `json:"rows"`
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
	Evaluations    EvaluationResultTables `json:"evaluations"`
	MovementEvents []MovementEvent        `json:"movementEvents,omitempty"`
}

// ProjectionPath is the evaluator-facing immutable timeline.
type ProjectionPath struct {
	Rows                        []ProjectionRow        `json:"rows"`
	MovementEvents              []MovementEvent        `json:"movementEvents"`
	EffectiveDocument           FinancialModelDocument `json:"effectiveDocument"`
	ProjectionStartPostingState struct {
		LatestRealizedPostingAmounts map[string]float64            `json:"latestRealizedPostingAmounts"`
		LatestRealizedPostingDates   map[string]string             `json:"latestRealizedPostingDates,omitempty"`
		RealizedPostingAmountsByYear map[string]map[string]float64 `json:"realizedPostingAmountsByYear"`
	} `json:"projectionStartPostingState"`
	ProjectionStartDate IsoDate `json:"projectionStartDate"`
	ProjectionEndDate   IsoDate `json:"projectionEndDate"`
}

type StochasticProjectionResult struct {
	Config     StochasticConfig    `json:"config"`
	Bands      []StochasticBandRow `json:"bands"`
	Milestones struct {
		FinalNetWorthPercentiles PercentileBands `json:"finalNetWorthPercentiles"`
	} `json:"milestones"`
	Evaluations EvaluationResultTables `json:"evaluations"`
}
