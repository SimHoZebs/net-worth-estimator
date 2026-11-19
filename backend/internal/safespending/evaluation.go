package safespending

import (
	"fmt"

	"github.com/simhozebs/net-worth-estimator/backend/internal/domain"
	"github.com/simhozebs/net-worth-estimator/backend/internal/types"
)

const evaluationType = "safe-spending"

type evidenceInput struct {
	settings   *types.SafeSpendingSettings
	start, end string
	factualCut int64
}

type evidenceResult types.SafeSpendingSummary

func (r evidenceResult) ToJSON() types.JsonValue { return types.SafeSpendingSummary(r) }

// Safe Spending runs on demand and has no configured instance or stored result.
// Register it here because the evidence calculation uses domain primitives.
var evidenceEvaluations = func() *domain.EvaluationRegistry {
	registry := domain.NewEvaluationRegistry()
	requiresProjection := false
	registry.Register(&domain.ReaderDefinition{Evaluator: domain.Evaluator{
		Type:                   evaluationType,
		Name:                   "Safe Spending",
		RequiresProjectionPath: &requiresProjection,
		Dependents:             func(*domain.EvaluationContext, any) *domain.EvaluationDependents { return domain.DependsOnEverything() },
		EvaluatePath: func(ctx *domain.EvaluationContext, input any) (domain.PathResult, error) {
			request, ok := input.(evidenceInput)
			if !ok {
				return nil, fmt.Errorf("invalid Safe Spending evidence input")
			}
			return evidenceResult(BuildAtCut(ctx.Model, request.settings, request.start, request.end, request.factualCut)), nil
		},
	}})
	return registry
}()

// Evaluate runs the requested evidence cut and returns the existing summary.
func Evaluate(model *types.FinancialModel, settings *types.SafeSpendingSettings, start, end string, factualCut int64) (types.SafeSpendingSummary, error) {
	result, err := evidenceEvaluations.EvaluateEvidence(evaluationType, model, evidenceInput{
		settings: settings, start: start, end: end, factualCut: factualCut,
	})
	if err != nil {
		return types.SafeSpendingSummary{}, err
	}
	summary, ok := result.(evidenceResult)
	if !ok {
		return types.SafeSpendingSummary{}, fmt.Errorf("invalid Safe Spending evidence result")
	}
	return types.SafeSpendingSummary(summary), nil
}
