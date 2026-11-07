package domain

import (
	"context"

	"github.com/simhozebs/net-worth-estimator/backend/internal/types"
)

// MonteCarloRunner runs the stochastic trials for sampled rules.
// It delegates to StochasticProjection and preserves run order.
func MonteCarloRunner(ctx context.Context, model *types.FinancialModel, settings *types.ProjectionRuntimeSettings, overrides types.ModelOverrides, config types.StochasticConfig, onProgress StochasticProgressCallback) (*types.StochasticProjectionResult, error) {
	return StochasticProjection(ctx, model, settings, overrides, config, onProgress)
}
