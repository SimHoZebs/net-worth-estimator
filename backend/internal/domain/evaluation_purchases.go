package domain

import (
	"fmt"

	"github.com/simhozebs/net-worth-estimator/backend/internal/types"
)

// PlannedPurchasesConfig deliberately has no independent queue state. The
// evaluator reads the purchase inputs from the effective document.
func validatePlannedPurchasesConfig(config any) error {
	object, ok := config.(map[string]any)
	if !ok || len(object) != 0 {
		return fmt.Errorf("Planned purchases config must be an empty object.")
	}
	return nil
}

type PurchaseOutcome struct {
	PostingID string  `json:"postingId"`
	Date      *string `json:"date"`
	Amount    float64 `json:"amount"`
}

type PlannedPurchasesPathResult struct {
	Purchases        []PurchaseOutcome `json:"purchases"`
	AllFunded        bool              `json:"allFunded"`
	FirstReachedDate *string           `json:"firstReachedDate"`
}

func (r *PlannedPurchasesPathResult) ToJSON() types.JsonValue {
	return map[string]any{
		"purchases": r.Purchases, "allFunded": r.AllFunded,
		"firstReachedDate": r.FirstReachedDate,
	}
}

func (r *PlannedPurchasesPathResult) firstReached() *string { return r.FirstReachedDate }

func evaluatePlannedPurchases(ctx *EvaluationContext, _ any) (PathResult, error) {
	// Prepare the same start state and sample as the main projection. Trials
	// own all state and never write to the source path, document, or FI branch.
	settings := types.ProjectionRuntimeSettings{
		FallbackProjectionStartDate: ctx.Path.ProjectionStartDate, HorizonYears: 1,
	}
	prepared, err := PrepareSimulationRequest(&ctx.Path.EffectiveDocument, &settings, types.ModelOverrides{}, ctx.MonteCarloSample)
	if err != nil {
		return nil, err
	}
	prepared.Request.EndDate = ctx.Path.ProjectionEndDate
	run, err := simulatePurchases(prepared.Request)
	if err != nil {
		return nil, err
	}
	result := &PlannedPurchasesPathResult{Purchases: []PurchaseOutcome{}, AllFunded: true}
	completed := ctx.Path.ProjectionStartDate
	for _, posting := range prepared.Request.Model.Postings {
		if !posting.Enabled || posting.Purchase == nil {
			continue
		}
		cost, err := purchaseCost(&posting)
		if err != nil {
			return nil, err
		}
		outcome := PurchaseOutcome{PostingID: posting.ID, Amount: cost}
		if event := fullyFundedPurchase(&run, posting.ID); event != nil {
			date := event.Date
			outcome.Date = &date
			if date > completed {
				completed = date
			}
		} else {
			result.AllFunded = false
		}
		result.Purchases = append(result.Purchases, outcome)
	}
	if result.AllFunded {
		result.FirstReachedDate = &completed
	}
	return result, nil
}

var plannedPurchasesDefinition = &EvaluationDefinition{
	Type:           types.EvaluationTypePlannedPurchases,
	Name:           "Planned purchases",
	ValidateConfig: validatePlannedPurchasesConfig,
	ParseConfig: func(config any) (any, error) {
		return config, validatePlannedPurchasesConfig(config)
	},
	EvaluatePath: evaluatePlannedPurchases,
	CreateAccumulator: func(_ any, _ PathResult) (Accumulator, error) {
		return &thresholdAccumulator{reachedDates: []string{}}, nil
	},
	Accumulate: accumulateReachedDate,
	Finalize: func(accumulator Accumulator, _ *EvaluationFinalizeContext) (types.JsonValue, error) {
		return finalizeReachedDates(accumulator.(*thresholdAccumulator)), nil
	},
	Status: func(deterministic PathResult, probabilistic types.JsonValue) types.EvaluationResultStatus {
		if probabilistic != nil {
			probability, _ := probabilistic.(map[string]any)["probability"].(float64)
			if probability >= 0.5 {
				return types.StatusSatisfied
			}
		} else if deterministic != nil && deterministic.(*PlannedPurchasesPathResult).AllFunded {
			return types.StatusSatisfied
		}
		return types.StatusNotSatisfied
	},
}
