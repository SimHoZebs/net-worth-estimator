package judgment

import (
	"context"
	"errors"

	"github.com/simhozebs/net-worth-estimator/backend/internal/types"
)

// Assess validates a complete response before applying any provider decisions.
// Unavailable responses preserve deterministic feature behavior; pending is a
// first-class, retryable result, not a blocked worker or a fabricated answer.
func Assess(ctx context.Context, evaluator Evaluator, requests []types.AnalysisJudgmentInput) ([]types.AnalysisJudgment, error) {
	decisions, err := evaluator.Evaluate(ctx, requests)
	if err != nil {
		return unavailableFallback(requests), ErrUnavailable
	}
	return ValidateResponse(requests, decisions)
}

// ValidateResponse validates provider decisions against the exact request batch
// and returns them in request order. Invalid responses fall back to unavailable
// decisions for every request. Valid pending and unavailable decisions remain
// intact and contribute the batch's deferred error.
func ValidateResponse(requests []types.AnalysisJudgmentInput, decisions []types.AnalysisJudgment) ([]types.AnalysisJudgment, error) {
	fallback := unavailableFallback(requests)
	if len(decisions) != len(requests) {
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
			if decision.Decision != "supported" && decision.Decision != "unsupported" && decision.Decision != "uncertain" {
				return fallback, ErrUnavailable
			}
			if decision.Strength != "strong" && decision.Strength != "moderate" {
				return fallback, ErrUnavailable
			}
		case "pending", "unavailable":
			if decision.Strength != "" || decision.Decision != "" {
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
	result := make([]types.AnalysisJudgment, 0, len(requests))
	statuses := make([]string, 0, len(requests))
	for _, request := range requests {
		decision := byID[request.ID]
		result = append(result, decision)
		statuses = append(statuses, decision.Status)
	}
	return result, DeferredError(statuses)
}

func unavailableFallback(requests []types.AnalysisJudgmentInput) []types.AnalysisJudgment {
	fallback := make([]types.AnalysisJudgment, 0, len(requests))
	for _, request := range requests {
		fallback = append(fallback, types.AnalysisJudgment{RequestID: request.ID, Status: "unavailable"})
	}
	return fallback
}

// DeferredError maps judgment statuses to one run-level error. Unavailable
// outranks pending; ready and unknown statuses do not contribute an error.
func DeferredError(statuses []string) error {
	pending := false
	for _, status := range statuses {
		switch status {
		case "unavailable":
			return ErrUnavailable
		case "pending":
			pending = true
		}
	}
	if pending {
		return ErrPending
	}
	return nil
}

// AggregateDeferredErrors combines per-batch errors with the same precedence as
// DeferredError. The first non-nil error stands unless a later unavailable error
// outranks it.
func AggregateDeferredErrors(errs ...error) error {
	var deferred error
	for _, err := range errs {
		if err == nil {
			continue
		}
		if errors.Is(err, ErrUnavailable) {
			return ErrUnavailable
		}
		if deferred == nil {
			deferred = err
		}
	}
	return deferred
}
