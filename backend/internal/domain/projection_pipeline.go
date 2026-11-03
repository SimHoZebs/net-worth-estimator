package domain

import (
	"context"

	"github.com/simhozebs/net-worth-estimator/backend/internal/types"
)

// BaselineEngine runs the deterministic baseline path without evaluations.
// It wraps the cached base path so eval-only changes never rerun the base.
func BaselineEngine(model *types.FinancialModel, settings *types.ProjectionRuntimeSettings, overrides types.ModelOverrides) (*types.ProjectionPath, *types.ProjectionResult, error) {
	_, path, result, err := projectBaseWithCache(model, settings, overrides, nil)
	if err != nil {
		return nil, nil, err
	}
	return path, result, nil
}

// MonteCarloRunner runs the stochastic trials for sampled rules.
// It delegates to StochasticProjection and preserves run order.
func MonteCarloRunner(ctx context.Context, model *types.FinancialModel, settings *types.ProjectionRuntimeSettings, overrides types.ModelOverrides, config types.StochasticConfig, onProgress StochasticProgressCallback) (*types.StochasticProjectionResult, error) {
	return StochasticProjection(ctx, model, settings, overrides, config, onProgress)
}
