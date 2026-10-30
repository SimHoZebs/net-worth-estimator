package domain

import (
	"fmt"

	"github.com/simhozebs/net-worth-estimator/backend/internal/types"
)

// PlannedPurchasesConfig deliberately has no independent queue state. The
// evaluator reads the purchase inputs from the effective model.
func validatePlannedPurchasesConfig(config any) error {
	object, ok := config.(map[string]any)
	if !ok || len(object) != 0 {
		return fmt.Errorf("Planned purchases config must be an empty object.")
	}
	return nil
}

type PurchaseOutcome struct {
	PurchaseID string  `json:"purchaseId"`
	Date       *string `json:"date"`
	Amount     float64 `json:"amount"`
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

// NumericValue exposes the funded count for numeric envelope consumers.
func (r *PlannedPurchasesPathResult) NumericValue() float64 {
	funded := 0.0
	for _, purchase := range r.Purchases {
		if purchase.Date != nil {
			funded++
		}
	}
	return funded
}

func evaluatePlannedPurchases(ctx *EvaluationContext, _ any) (PathResult, error) {
	// Reuse the shared path: rebuild the candidate simulation request from
	// the already-prepared effective model and the caller's Monte Carlo
	// sample through the shared purchases builder. Candidate simulations own
	// all state and never write to the source path, model, or FI branch.
	// No PrepareSimulationRequest here: the base path already carries the
	// validated start state.
	model := ctx.Path.EffectiveModel
	request := purchasesCandidateRequest(ctx.Path, ctx.MonteCarloSample)
	run, err := simulatePurchases(request)
	if err != nil {
		return nil, err
	}
	result := &PlannedPurchasesPathResult{Purchases: []PurchaseOutcome{}, AllFunded: true}
	completed := ctx.Path.ProjectionStartDate
	for _, planned := range model.PlannedPurchases {
		if !planned.Enabled {
			continue
		}
		outcome := PurchaseOutcome{PurchaseID: planned.ID, Amount: planned.Cost}
		if event := fullyFundedPurchase(&run, planned.ID); event != nil {
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

var plannedPurchasesDefinition = NewReachedDateSimulator(
	types.EvaluationTypePlannedPurchases,
	"Planned purchases",
	validatePlannedPurchasesConfig,
	func(config any) (any, error) {
		return config, validatePlannedPurchasesConfig(config)
	},
	evaluatePlannedPurchases,
	func(deterministic PathResult) bool {
		return deterministic.(*PlannedPurchasesPathResult).AllFunded
	},
)
