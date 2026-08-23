package domain

import (
	"github.com/simhozebs/net-worth-estimator/backend/internal/types"
)

// Deterministic orchestration ported from analysis/projectFinancialModel.ts
// plus the evaluator registry from evaluation/registry.ts.

// EvaluationRegistry is the process-wide definition registry.
var evaluationRegistryInstance = NewEvaluationRegistry()

func init() {
	evaluationRegistryInstance.Register(financialIndependenceDefinition)
	evaluationRegistryInstance.Register(netWorthThresholdDefinition)
	evaluationRegistryInstance.Register(postingFulfillmentDefinition)
}

// EvaluateProjectionPath runs configured deterministic evaluations over a path.
func EvaluateProjectionPath(path *types.ProjectionPath, evaluations *types.EvaluationTables, monteCarloSample *types.MonteCarloSample, detailLevel string) *types.EvaluationResultCollection {
	runtimes := NewEvaluationRuntimeSet(evaluations, evaluationRegistryInstance)
	if detailLevel == "" {
		detailLevel = "detailed"
	}
	runtimes.EvaluateDeterministic(&EvaluationContext{
		Path:             path,
		Document:         &path.EffectiveDocument,
		MonteCarloSample: monteCarloSample,
		DetailLevel:      detailLevel,
	})
	collection := runtimes.Result()
	return &collection
}

// ProjectFinancialModelDocument produces the full public projection result.
func ProjectFinancialModelDocument(document *types.FinancialModelDocument, settings *types.ProjectionRuntimeSettings, overrides types.ModelOverrides, monteCarloSample *types.MonteCarloSample, incomeData *types.IncomeDataSnapshot) (*types.ProjectionResult, error) {
	path, result, err := ProjectRawFinancialModelDocument(document, settings, overrides, monteCarloSample, incomeData)
	if err != nil {
		return nil, err
	}
	collection := EvaluateProjectionPath(path, &settings.Evaluations, monteCarloSample, "detailed")
	result.Evaluations = collection.Evaluations
	return result, nil
}
