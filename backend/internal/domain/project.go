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
	evaluationRegistryInstance.Register(postingFulfillmentDefinition)
	evaluationRegistryInstance.Register(cycleFulfillmentDefinition)
	evaluationRegistryInstance.Register(plannedPurchasesDefinition)
	evaluationRegistryInstance.Register(whatIfDefinition)
}

// ProjectFinancialModel produces the full public projection result.
// The base path comes from the base-path cache (keyed without evaluations);
// evaluations run separately against the cached path, so eval-only changes
// never rerun the base simulation.
func ProjectFinancialModel(model *types.FinancialModel, settings *types.ProjectionRuntimeSettings, overrides types.ModelOverrides, monteCarloSample *types.MonteCarloSample) (*types.ProjectionResult, error) {
	_, path, baseResult, err := projectBaseWithCache(model, settings, overrides, monteCarloSample)
	if err != nil {
		return nil, err
	}
	// Reader and simulator results change only when the base content or the
	// eval configuration changes: serve each stored system to every later
	// identical request instead of recomputing per request. Detail stays in
	// the simulator key because simulators honor it; readers ignore it.
	baseHash := BaseModelHash(model, overrides, settings, monteCarloSample)
	set := NewEvaluationRuntimeSet(&settings.Evaluations, evaluationRegistryInstance)
	readers, simulators := set.PartitionByKind()
	readerCollection := projectReaderEvaluationsWithCache(path, baseHash, readers)
	simulatorCollection := projectSimulatorEvaluationsWithCache(path, baseHash, simulators, monteCarloSample, "detailed")
	collection := MergeEvaluationResultCollections(set, readerCollection, simulatorCollection)
	// Copy the shell: the cached base result stays evaluation-free for the
	// next caller with different eval config.
	result := *baseResult
	result.Evaluations = collection.Evaluations
	return &result, nil
}
