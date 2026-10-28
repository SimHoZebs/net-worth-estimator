package domain

import (
	"math"
	"sort"

	"github.com/simhozebs/net-worth-estimator/backend/internal/types"
)

// Net worth threshold evaluation.

// NetWorthThresholdPathResult is the deterministic result shape.
type NetWorthThresholdPathResult struct {
	Reached          bool    `json:"reached"`
	FirstReachedDate *string `json:"firstReachedDate"`
}

func (r *NetWorthThresholdPathResult) ToJSON() types.JsonValue {
	return map[string]any{
		"reached":          r.Reached,
		"firstReachedDate": r.FirstReachedDate,
	}
}

// NetWorthThresholdProbabilisticResult is the stochastic result shape.
type NetWorthThresholdProbabilisticResult struct {
	Probability       float64 `json:"probability"`
	P10ReachedDate    *string `json:"p10ReachedDate"`
	MedianReachedDate *string `json:"medianReachedDate"`
	P90ReachedDate    *string `json:"p90ReachedDate"`
}

type thresholdAccumulator struct {
	reachedDates []string
	totalRuns    int
}

// reachedDateResult is shared by every evaluation whose outcome is "the first
// date this measure crossed a target". It keeps the stochastic aggregation in
// one place instead of per evaluation type.
type reachedDateResult interface {
	firstReached() *string
}

// NewReachedDateReader builds the Reader plugin: a reader definition
// for evaluations whose outcome is "the first date a measure crossed a
// target". This is the entire plugin contract for this family — type, name,
// config validation, path evaluation, and the deterministic satisfied
// predicate. Accumulation, finalization, stochastic status, and the no-resim
// Kind come from the shared wiring. Simulator evaluations (FI, purchases simulations)
// keep the full EvaluationDefinition struct instead.

func (r *NetWorthThresholdPathResult) firstReached() *string { return r.FirstReachedDate }

func NewReachedDateReader(
	evalType, name string,
	validate func(config any) error,
	parse func(config any) (any, error),
	evaluate func(ctx *EvaluationContext, config any) (PathResult, error),
	satisfied func(deterministic PathResult) bool,
) *EvaluationDefinition {
	return newReachedDateDefinition(evalType, name, EvaluationKindReader, false, validate, parse, evaluate, satisfied)
}

// NewReachedDateSimulator is the simulator variant of NewReachedDateReader for
// evaluations that share the reached-date shape but run simulations against
// shared base path state (purchases). Same wiring, explicit simulator opt-in.
func NewReachedDateSimulator(
	evalType, name string,
	validate func(config any) error,
	parse func(config any) (any, error),
	evaluate func(ctx *EvaluationContext, config any) (PathResult, error),
	satisfied func(deterministic PathResult) bool,
) *EvaluationDefinition {
	return newReachedDateDefinition(evalType, name, EvaluationKindSimulator, true, validate, parse, evaluate, satisfied)
}

func newReachedDateDefinition(
	evalType, name string,
	kind EvaluationKind,
	allowSimulator bool,
	validate func(config any) error,
	parse func(config any) (any, error),
	evaluate func(ctx *EvaluationContext, config any) (PathResult, error),
	satisfied func(deterministic PathResult) bool,
) *EvaluationDefinition {
	return &EvaluationDefinition{
		Type: evalType,
		Name: name,

		Kind:            kind,
		AllowSimulation: allowSimulator,

		ValidateConfig: validate,
		ParseConfig:    parse,
		EvaluatePath:   evaluate,

		CreateAccumulator: func(config any, deterministic PathResult) (Accumulator, error) {
			return &thresholdAccumulator{reachedDates: []string{}}, nil
		},
		Accumulate: accumulateReachedDate,
		Finalize: func(accumulator Accumulator, ctx *EvaluationFinalizeContext) (types.JsonValue, error) {
			return finalizeReachedDates(accumulator.(*thresholdAccumulator)), nil
		},
		Status: func(deterministic PathResult, probabilistic types.JsonValue) types.EvaluationResultStatus {
			if probabilistic != nil {
				probability, _ := probabilistic.(map[string]any)["probability"].(float64)
				if probability >= 0.5 {
					return types.StatusSatisfied
				}
				return types.StatusNotSatisfied
			}
			if deterministic != nil && satisfied(deterministic) {
				return types.StatusSatisfied
			}
			return types.StatusNotSatisfied
		},
	}
}

// accumulateReachedDate folds one run's result into the shared accumulator.
func accumulateReachedDate(accumulator Accumulator, pathResult PathResult) error {
	acc := accumulator.(*thresholdAccumulator)
	acc.totalRuns++
	if reached, ok := pathResult.(reachedDateResult); ok {
		if date := reached.firstReached(); date != nil {
			acc.reachedDates = append(acc.reachedDates, *date)
		}
	}
	return nil
}

// finalizeReachedDates aggregates accumulated reached dates into the shared
// probabilistic result shape.
func finalizeReachedDates(acc *thresholdAccumulator) types.JsonValue {
	dates := make([]string, len(acc.reachedDates))
	copy(dates, acc.reachedDates)
	sort.Strings(dates)
	probability := 0.0
	if acc.totalRuns > 0 {
		probability = float64(len(dates)) / float64(acc.totalRuns)
	}
	result := NetWorthThresholdProbabilisticResult{
		Probability:       probability,
		P10ReachedDate:    datePercentile(dates, 0.1),
		MedianReachedDate: datePercentile(dates, 0.5),
		P90ReachedDate:    datePercentile(dates, 0.9),
	}
	return map[string]any{
		"probability":       result.Probability,
		"p10ReachedDate":    result.P10ReachedDate,
		"medianReachedDate": result.MedianReachedDate,
		"p90ReachedDate":    result.P90ReachedDate,
	}
}

// EvaluateNetWorthThreshold finds the first projected date at/above target.
func EvaluateNetWorthThreshold(path *types.ProjectionPath, target float64) NetWorthThresholdPathResult {
	firstReachedDate := (*string)(nil)
	for index := range path.Rows {
		row := &path.Rows[index]
		if !row.IsHistorical && row.NetWorth >= target {
			date := row.Date
			firstReachedDate = &date
			break
		}
	}
	return NetWorthThresholdPathResult{
		Reached:          firstReachedDate != nil,
		FirstReachedDate: firstReachedDate,
	}
}

func datePercentile(sortedDates []string, percentile float64) *string {
	if len(sortedDates) == 0 {
		return nil
	}
	index := int(math.Round(float64(len(sortedDates)-1) * percentile))
	if index < 0 || index >= len(sortedDates) {
		return nil
	}
	return &sortedDates[index]
}

var netWorthThresholdDefinition = NewReachedDateReader(
	types.EvaluationTypeNetWorthThreshold,
	"Net worth threshold",
	ValidateThresholdConfig,
	func(config any) (any, error) {
		parsed, err := ParseThresholdConfig(config)
		if err != nil {
			return nil, err
		}
		return parsed, nil
	},
	func(ctx *EvaluationContext, config any) (PathResult, error) {
		typed := config.(types.NetWorthThresholdConfig)
		result := EvaluateNetWorthThreshold(ctx.Path, typed.Target)
		return &result, nil
	},
	func(deterministic PathResult) bool {
		return deterministic.(*NetWorthThresholdPathResult).Reached
	},
)
