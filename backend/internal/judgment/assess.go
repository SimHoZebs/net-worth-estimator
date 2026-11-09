package judgment

import (
	"context"

	"github.com/simhozebs/net-worth-estimator/backend/internal/types"
)

// Assess validates a complete response before applying any provider decisions.
// Unavailable responses preserve deterministic feature behavior; pending is a
// first-class, retryable result, not a blocked worker or a fabricated answer.
func Assess(ctx context.Context, evaluator Evaluator, requests []types.AnalysisJudgmentInput) ([]types.AnalysisJudgment, error) {
	fallback := make([]types.AnalysisJudgment, 0, len(requests))
	for _, request := range requests {
		fallback = append(fallback, types.AnalysisJudgment{RequestID: request.ID, Status: "unavailable"})
	}
	decisions, err := evaluator.Evaluate(ctx, requests)
	if err != nil || len(decisions) != len(requests) {
		return fallback, ErrUnavailable
	}
	byID := map[string]types.AnalysisJudgment{}
	for _, decision := range decisions {
		if len(decision.Reason) > 2000 {
			return fallback, ErrUnavailable
		}
		if _, duplicate := byID[decision.RequestID]; duplicate {
			return fallback, ErrUnavailable
		}
		switch decision.Status {
		case "ready":
			if decision.Strength != "strong" && decision.Strength != "moderate" {
				return fallback, ErrUnavailable
			}
		case "pending", "unavailable":
			if decision.Strength != "" {
				return fallback, ErrUnavailable
			}
		default:
			return fallback, ErrUnavailable
		}
		byID[decision.RequestID] = decision
	}
	for _, request := range requests {
		if _, ok := byID[request.ID]; !ok {
			return fallback, ErrUnavailable
		}
	}
	var deferred error
	result := make([]types.AnalysisJudgment, 0, len(requests))
	for _, request := range requests {
		decision := byID[request.ID]
		result = append(result, decision)
		if decision.Status == "unavailable" {
			deferred = ErrUnavailable
		} else if decision.Status == "pending" && deferred == nil {
			deferred = ErrPending
		}
	}
	return result, deferred
}
