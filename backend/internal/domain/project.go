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
}

// EvaluateProjectionPath runs configured deterministic evaluations over a path.
// Reader and simulator runtimes evaluate separately so each system keeps its
// own caching policy; the merged collection preserves canonical table order.
func EvaluateProjectionPath(path *types.ProjectionPath, evaluations *types.EvaluationTables, monteCarloSample *types.MonteCarloSample, detailLevel string) *types.EvaluationResultCollection {
	if detailLevel == "" {
		detailLevel = "detailed"
	}
	set := NewEvaluationRuntimeSet(evaluations, evaluationRegistryInstance)
	readers, simulators := set.PartitionByKind()
	readers.EvaluateDeterministic(&EvaluationContext{
		Path:             path,
		Document:         &path.EffectiveDocument,
		MonteCarloSample: monteCarloSample,
		DetailLevel:      detailLevel,
	})
	simulators.EvaluateDeterministic(&EvaluationContext{
		Path:             path,
		Document:         &path.EffectiveDocument,
		MonteCarloSample: monteCarloSample,
		DetailLevel:      detailLevel,
	})
	readerCollection := readers.Result()
	simulatorCollection := simulators.Result()
	return MergeEvaluationResultCollections(set, &readerCollection, &simulatorCollection)
}

// ProjectFinancialModelDocument produces the full public projection result.
// The base path comes from the base-path cache (keyed without evaluations);
// evaluations run separately against the cached path, so eval-only changes
// never rerun the base simulation.
func ProjectFinancialModelDocument(document *types.FinancialModelDocument, settings *types.ProjectionRuntimeSettings, overrides types.ModelOverrides, monteCarloSample *types.MonteCarloSample) (*types.ProjectionResult, error) {
	_, path, baseResult, err := projectBaseWithCache(document, settings, overrides, monteCarloSample)
	if err != nil {
		return nil, err
	}
	// Reader and simulator results change only when the base content or the
	// eval configuration changes: serve each stored system to every later
	// identical request instead of recomputing per request. Detail stays in
	// the simulator key because simulators honor it; readers ignore it.
	baseHash := BaseDocumentHash(document, overrides, settings, monteCarloSample)
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
