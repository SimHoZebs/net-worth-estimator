package domain

import (
	"context"

	"github.com/simhozebs/net-worth-estimator/backend/internal/types"
)

// BaselineEngine runs the deterministic baseline path without evaluations.
// Every call prepares and simulates directly. No hashes, no caches.
func BaselineEngine(model *types.FinancialModel, settings *types.ProjectionRuntimeSettings, overrides types.ModelOverrides) (*types.ProjectionPath, *types.ProjectionResult, error) {
	prepared, err := orchestratedPrepare(model, settings, overrides, nil)
	if err != nil {
		return nil, nil, err
	}
	run, err := orchestratedSimulate(prepared.Request)
	if err != nil {
		return nil, nil, err
	}
	path, result := AdaptSimulationRun(prepared, &run)
	return path, result, nil
}

// MonteCarloRunner runs the stochastic trials for sampled rules.
// It delegates to StochasticProjection and preserves run order.
func MonteCarloRunner(ctx context.Context, model *types.FinancialModel, settings *types.ProjectionRuntimeSettings, overrides types.ModelOverrides, config types.StochasticConfig, onProgress StochasticProgressCallback) (*types.StochasticProjectionResult, error) {
	return StochasticProjection(ctx, model, settings, overrides, config, onProgress)
}
