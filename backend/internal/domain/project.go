package domain

import (
	"github.com/simhozebs/net-worth-estimator/backend/internal/types"
)

// Deterministic orchestration and evaluator registry. Go is the owner.

// EvaluationRegistry is the process-wide definition registry.
var evaluationRegistryInstance = NewEvaluationRegistry()

func init() {
	evaluationRegistryInstance.Register(financialIndependenceDefinition)
	evaluationRegistryInstance.Register(netWorthThresholdDefinition)
	evaluationRegistryInstance.Register(accountBalanceDefinition)
	evaluationRegistryInstance.Register(transactionFulfillmentDefinition)
	evaluationRegistryInstance.Register(cycleFulfillmentDefinition)
	evaluationRegistryInstance.Register(plannedPurchasesDefinition)
	evaluationRegistryInstance.Register(whatIfDefinition)
}

// ProjectFinancialModel produces the full public projection result.
// Every call prepares, simulates, and evaluates directly. No content
// hashes and no cross-request caches exist: repeat requests recompute.
// Suffix reuse across requests arrives with slice persistence.
func ProjectFinancialModel(model *types.FinancialModel, settings *types.ProjectionRuntimeSettings, overrides types.ModelOverrides, monteCarloSample *types.MonteCarloSample) (*types.ProjectionResult, error) {
	_, result, err := ProjectWithPath(model, settings, overrides, monteCarloSample)
	return result, err
}

// ProjectWithPath produces the evaluator-facing path plus the full public
// result. The unified builder persists both; readers reassemble results
// without recomputing.
func ProjectWithPath(model *types.FinancialModel, settings *types.ProjectionRuntimeSettings, overrides types.ModelOverrides, monteCarloSample *types.MonteCarloSample) (*types.ProjectionPath, *types.ProjectionResult, error) {
	prepared, err := orchestratedPrepare(model, settings, overrides, monteCarloSample)
	if err != nil {
		return nil, nil, err
	}
	run, err := orchestratedSimulate(prepared.Request)
	if err != nil {
		return nil, nil, err
	}
	path, baseResult := AdaptSimulationRun(prepared, &run)
	result := *baseResult
	result.Evaluations = EvaluateProjectionPath(path, settings, monteCarloSample)
	return path, &result, nil
}

// EvaluateProjectionPathOptional runs evaluations with an optional path.
// When path is nil, evaluators that need a projection emit a
// projection-unavailable diagnostic and stay indeterminate, while
// projection-free evaluators run with the supplied model alone.
func EvaluateProjectionPathOptional(path *types.ProjectionPath, model *types.FinancialModel, settings *types.ProjectionRuntimeSettings, monteCarloSample *types.MonteCarloSample) types.EvaluationResultTables {
	effectiveModel := model
	if path != nil {
		// Prefer path-carried model; fall back to explicit model when nil.
		if effectiveModel == nil {
			effectiveModel = &path.EffectiveModel
		}
	}
	if effectiveModel == nil {
		empty := types.FinancialModel{Evaluations: types.EmptyEvaluationTables()}
		effectiveModel = &empty
	}
	set := NewEvaluationRuntimeSet(&settings.Evaluations, evaluationRegistryInstance)
	timeline := types.TimelineFromPath(path)
	set.EvaluateDeterministic(&EvaluationContext{
		Path:             path,
		Timeline:         timeline,
		Model:            effectiveModel,
		MonteCarloSample: monteCarloSample,
		DetailLevel:      "detailed",
	})
	collection := set.Result()
	return collection.Evaluations
}

// EvaluateProjectionPath runs every evaluator against a built path. The
// projection entry points share it so stored and computed results attach
// identical evaluation tables.
func EvaluateProjectionPath(path *types.ProjectionPath, settings *types.ProjectionRuntimeSettings, monteCarloSample *types.MonteCarloSample) types.EvaluationResultTables {
	if path == nil {
		return EvaluateProjectionPathOptional(nil, nil, settings, monteCarloSample)
	}
	return EvaluateProjectionPathOptional(path, &path.EffectiveModel, settings, monteCarloSample)
}
