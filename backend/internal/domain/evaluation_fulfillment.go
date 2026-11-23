package domain

import (
	"math"

	"github.com/simhozebs/net-worth-estimator/backend/internal/types"
)

// Transaction fulfillment evaluation.

// TransactionFulfillmentPathResult is the deterministic result shape.
type TransactionFulfillmentPathResult struct {
	RequestedAmount          float64  `json:"requestedAmount"`
	RealizedAmount           float64  `json:"realizedAmount"`
	DestinationLimitedAmount float64  `json:"destinationLimitedAmount"`
	UnfulfilledAmount        float64  `json:"unfulfilledAmount"`
	CompletionRate           float64  `json:"completionRate"`
	FirstUnderfulfilledDate  *IsoDate `json:"firstUnderfulfilledDate"`
}

func (r *TransactionFulfillmentPathResult) ToJSON() types.JsonValue {
	return map[string]any{
		"requestedAmount":          r.RequestedAmount,
		"realizedAmount":           r.RealizedAmount,
		"destinationLimitedAmount": r.DestinationLimitedAmount,
		"unfulfilledAmount":        r.UnfulfilledAmount,
		"completionRate":           r.CompletionRate,
		"firstUnderfulfilledDate":  r.FirstUnderfulfilledDate,
	}
}

// roundAmount is kept as an alias so fulfillment and cycle results use one
// currency rounding owner with path.go. mathRound stays separate: it rounds
// halves toward +Infinity for percentile buffers and differs on negative .5.
func roundAmount(value float64) float64 { return roundCurrency(value) }

// EvaluateTransactionFulfillment evaluates fulfillment over the selected transactions.
func EvaluateTransactionFulfillment(path *types.ProjectionPath, config types.TransactionFulfillmentConfig) *TransactionFulfillmentPathResult {
	return EvaluateTransactionFulfillmentTimeline(types.TimelineFromPath(path), config)
}

func EvaluateTransactionFulfillmentTimeline(timeline *types.EvaluationTimeline, config types.TransactionFulfillmentConfig) *TransactionFulfillmentPathResult {
	if timeline == nil {
		return &TransactionFulfillmentPathResult{}
	}
	var selectedIDs map[string]bool
	if config.TransactionIDs != nil {
		selectedIDs = map[string]bool{}
		for _, id := range config.TransactionIDs {
			selectedIDs[id] = true
		}
	}
	evaluatedEvents := evaluateTransactionEventsTimeline(timeline)
	result := &TransactionFulfillmentPathResult{}
	var requestedAmount, realizedAmount, destinationLimitedAmount, unfulfilledAmount float64
	var firstUnderfulfilledDate *IsoDate

	for _, evaluated := range evaluatedEvents {
		event := evaluated.event
		if selectedIDs != nil && !selectedIDs[event.Origin.TransactionID] {
			continue
		}
		requestedAmount += event.RequestedAmount
		realizedAmount += event.RealizedAmount
		destinationLimitedAmount += evaluated.destinationLimited
		unfulfilledAmount += evaluated.unfulfilled
		if firstUnderfulfilledDate == nil && evaluated.unfulfilled > 0 {
			date := event.Date
			firstUnderfulfilledDate = &date
		}
	}

	completionRate := 1.0
	if requestedAmount > 0 {
		completionRate = math.Max(0, 1-unfulfilledAmount/requestedAmount)
	}
	result.RequestedAmount = roundAmount(requestedAmount)
	result.RealizedAmount = roundAmount(realizedAmount)
	result.DestinationLimitedAmount = roundAmount(destinationLimitedAmount)
	result.UnfulfilledAmount = roundAmount(unfulfilledAmount)
	result.CompletionRate = completionRate
	result.FirstUnderfulfilledDate = firstUnderfulfilledDate
	return result
}

func diagnoseFulfillmentConfig(path *types.ProjectionPath, config types.TransactionFulfillmentConfig) []types.EvaluationDiagnostic {
	return diagnoseFulfillmentConfigTimeline(types.TimelineFromPath(path), config)
}

func diagnoseFulfillmentConfigTimeline(timeline *types.EvaluationTimeline, config types.TransactionFulfillmentConfig) []types.EvaluationDiagnostic {
	if config.TransactionIDs == nil {
		return nil
	}
	if timeline == nil {
		return nil
	}
	transactionIDs := TransactionIDs(&timeline.EffectiveModel)
	diagnostics := []types.EvaluationDiagnostic{}
	for _, transactionID := range config.TransactionIDs {
		if !transactionIDs[transactionID] {
			diagnostics = append(diagnostics, types.EvaluationDiagnostic{
				Code:                  "transaction-fulfillment.transaction.missing",
				Severity:              "warning",
				Message:               "Transaction '" + transactionID + "' does not exist.",
				RelatedTransactionIDs: []string{transactionID},
			})
		}
	}
	return diagnostics
}

type fulfillmentAccumulator struct {
	runCount           int
	fulfilledRunCount  int
	unfulfilledAmounts []float64
}

var transactionFulfillmentDefinition = &ReaderDefinition{Evaluator: Evaluator{
	Type: types.EvaluationTypeTransactionFulfillment,
	Name: "Transaction fulfillment",

	// Reader: answers from the cached path's transaction events only.

	ValidateConfig: ValidateFulfillmentConfig,
	ParseConfig: func(config any) (any, error) {
		parsed, err := ParseFulfillmentConfig(config)
		if err != nil {
			return nil, err
		}
		return parsed, nil
	},
	Dependents: func(ctx *EvaluationContext, config any) *EvaluationDependents { return DependsOnEverything() },

	EvaluatePath: func(ctx *EvaluationContext, config any) (PathResult, error) {
		typed := config.(types.TransactionFulfillmentConfig)
		// Scalar fulfillment evidence only. Full per-event evidence travels
		// once on the public transactionEvents timeline.
		return EvaluateTransactionFulfillmentTimeline(ctx.GetTimeline(), typed), nil
	},
	DiagnoseConfig: func(ctx *EvaluationContext, config any) []types.EvaluationDiagnostic {
		return diagnoseFulfillmentConfigTimeline(ctx.GetTimeline(), config.(types.TransactionFulfillmentConfig))
	},

	CreateAccumulator: func(config any, deterministic PathResult) (Accumulator, error) {
		return &fulfillmentAccumulator{unfulfilledAmounts: []float64{}}, nil
	},
	Accumulate: func(accumulator Accumulator, pathResult PathResult) error {
		acc := accumulator.(*fulfillmentAccumulator)
		result := pathResult.(*TransactionFulfillmentPathResult)
		acc.runCount++
		if result.FirstUnderfulfilledDate == nil {
			acc.fulfilledRunCount++
		}
		acc.unfulfilledAmounts = append(acc.unfulfilledAmounts, result.UnfulfilledAmount)
		return nil
	},
	Finalize: func(accumulator Accumulator, ctx *EvaluationFinalizeContext) (types.JsonValue, error) {
		acc := accumulator.(*fulfillmentAccumulator)
		probability := 0.0
		if acc.runCount > 0 {
			probability = float64(acc.fulfilledRunCount) / float64(acc.runCount)
		}
		percentiles := ComputePercentiles(acc.unfulfilledAmounts)
		return map[string]any{
			"runCount":                     acc.runCount,
			"fulfilledRunCount":            acc.fulfilledRunCount,
			"fullFulfillmentProbability":   probability,
			"unfulfilledAmountPercentiles": percentilesToJSON(percentiles),
		}, nil
	},
	Status: func(deterministic PathResult, probabilistic types.JsonValue) types.EvaluationResultStatus {
		if probabilistic != nil {
			payload, ok := probabilistic.(map[string]any)
			if !ok {
				return types.StatusNotSatisfied
			}
			probability, _ := payload["fullFulfillmentProbability"].(float64)
			if probability == 1 {
				return types.StatusSatisfied
			}
			return types.StatusNotSatisfied
		}
		if deterministic != nil {
			result, ok := deterministic.(*TransactionFulfillmentPathResult)
			if ok && result.FirstUnderfulfilledDate == nil {
				return types.StatusSatisfied
			}
		}
		return types.StatusNotSatisfied
	},
}}
