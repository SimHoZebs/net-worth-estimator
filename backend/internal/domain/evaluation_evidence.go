package domain

import (
	"fmt"

	"github.com/simhozebs/net-worth-estimator/backend/internal/types"
)

// EvaluateEvidence runs a registered reader against model evidence only.
// Its input and result belong to the requesting read, not the configured
// evaluation tables or their projection and stochastic lifecycle.
func (r *EvaluationRegistry) EvaluateEvidence(evaluationType string, model *types.FinancialModel, input any) (PathResult, error) {
	definition, ok := r.Get(evaluationType)
	if !ok {
		return nil, fmt.Errorf("no evaluator is registered for %q", evaluationType)
	}
	if definition.IsSimulator() || definition.NeedsProjectionPath() {
		return nil, fmt.Errorf("evaluator %q is not a projection-free reader", evaluationType)
	}
	return evaluateDefinitionPath(definition, &EvaluationContext{Model: model}, input)
}
