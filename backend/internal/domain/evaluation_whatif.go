package domain

import (
	"encoding/json"
	"fmt"

	"github.com/simhozebs/net-worth-estimator/backend/internal/types"
)

// What-if simulator: branch simulation over saved state plus hypothetical
// additions, disables, and modified copies. Canonical path stays untouched.

var whatIfAllowedKeys = map[string]bool{
	"addedAccounts": true, "addedPostings": true, "addedRules": true,
	"disabledAccountIds": true, "disabledPostingIds": true, "disabledRuleIds": true,
}

func validateWhatIfConfig(config any) error {
	object, ok := config.(map[string]any)
	if !ok {
		return fmt.Errorf("What-if config must be an object.")
	}
	for key, value := range object {
		if !whatIfAllowedKeys[key] {
			return fmt.Errorf("What-if field %q is not supported.", key)
		}
		if value == nil {
			continue
		}
		list, ok := value.([]any)
		if !ok {
			return fmt.Errorf("What-if field %q must be an array.", key)
		}
		switch key {
		case "disabledAccountIds", "disabledPostingIds", "disabledRuleIds":
			for _, item := range list {
				s, ok := item.(string)
				if !ok || s == "" {
					return fmt.Errorf("What-if field %q must be an array of non-empty IDs.", key)
				}
			}
		case "addedAccounts", "addedPostings", "addedRules":
			for _, item := range list {
				object, ok := item.(map[string]any)
				if !ok {
					return fmt.Errorf("What-if field %q must be an array of objects.", key)
				}
				id, ok := object["id"]
				if !ok {
					return fmt.Errorf("What-if field %q items must include an id.", key)
				}
				idString, ok := id.(string)
				if !ok || idString == "" {
					return fmt.Errorf("What-if field %q items must include a non-empty id.", key)
				}
			}
		}
	}
	return nil
}

func parseWhatIfConfig(config any) (any, error) {
	if err := validateWhatIfConfig(config); err != nil {
		return nil, err
	}
	raw, err := json.Marshal(config)
	if err != nil {
		return nil, fmt.Errorf("What-if config must be JSON-serializable.")
	}
	var parsed types.WhatIfConfig
	if err := json.Unmarshal(raw, &parsed); err != nil {
		return nil, fmt.Errorf("What-if config has invalid row shapes: %v.", err)
	}
	return &parsed, nil
}

type WhatIfPathResult struct {
	FinalNetWorth        float64 `json:"finalNetWorth"`
	TransactionCount     int     `json:"transactionCount"`
	FirstUnfulfilledDate *string `json:"firstUnfulfilledDate"`
	AllFunded            bool    `json:"allFunded"`
}

func (r *WhatIfPathResult) ToJSON() types.JsonValue {
	return map[string]any{
		"finalNetWorth": r.FinalNetWorth, "transactionCount": r.TransactionCount,
		"firstUnfulfilledDate": r.FirstUnfulfilledDate, "allFunded": r.AllFunded,
	}
}

func whatIfOverridesFromParsed(config any) types.ModelOverrides {
	overrides := types.EmptyModelOverrides()
	parsed, ok := config.(*types.WhatIfConfig)
	if !ok {
		return overrides
	}
	overrides.AddedAccounts = append(overrides.AddedAccounts, parsed.AddedAccounts...)
	overrides.AddedPostings = append(overrides.AddedPostings, parsed.AddedPostings...)
	overrides.AddedRules = append(overrides.AddedRules, parsed.AddedRules...)
	overrides.DisabledAccountIDs = append(overrides.DisabledAccountIDs, parsed.DisabledAccountIDs...)
	overrides.DisabledPostingIDs = append(overrides.DisabledPostingIDs, parsed.DisabledPostingIDs...)
	overrides.DisabledRuleIDs = append(overrides.DisabledRuleIDs, parsed.DisabledRuleIDs...)
	return overrides
}

func evaluateWhatIf(ctx *EvaluationContext, config any) (PathResult, error) {
	base := ctx.Path.EffectiveDocument
	overrides := whatIfOverridesFromParsed(config)
	effective := types.ApplyModelOverrides(base, overrides)
	// Reuse the shared candidate builder against the overlaid document.
	// History rows and the projection window come from the base path; only
	// the effective document is swapped.
	branched := *ctx.Path
	branched.EffectiveDocument = effective
	request := purchasesCandidateRequest(&branched, ctx.MonteCarloSample)
	run, err := Simulate(request)
	if err != nil {
		return nil, err
	}
	result := &WhatIfPathResult{AllFunded: true}
	if len(run.Snapshots) > 0 {
		last := run.Snapshots[len(run.Snapshots)-1]
		total := 0.0
		for _, balance := range last.Balances {
			total += balance
		}
		result.FinalNetWorth = total
	}
	result.TransactionCount = len(run.TransactionAttempts)
	for _, event := range run.TransactionAttempts {
		if event.Fulfillment != nil && event.Fulfillment.UnfulfilledAmount > 0 {
			date := event.Date
			if result.FirstUnfulfilledDate == nil {
				result.FirstUnfulfilledDate = &date
			}
			result.AllFunded = false
			break
		}
	}
	return result, nil
}

type whatIfAccumulator struct {
	funded int
	total  int
}

func createWhatIfAccumulator(_ any, _ PathResult) (Accumulator, error) {
	return &whatIfAccumulator{}, nil
}

func accumulateWhatIf(accumulator Accumulator, pathResult PathResult) error {
	acc, ok := accumulator.(*whatIfAccumulator)
	if !ok {
		return fmt.Errorf("What-if accumulator has unexpected type.")
	}
	result, ok := pathResult.(*WhatIfPathResult)
	if !ok {
		return fmt.Errorf("What-if result has unexpected type.")
	}
	acc.total++
	if result.AllFunded {
		acc.funded++
	}
	return nil
}

func finalizeWhatIf(accumulator Accumulator, _ *EvaluationFinalizeContext) (types.JsonValue, error) {
	acc, ok := accumulator.(*whatIfAccumulator)
	if !ok {
		return nil, fmt.Errorf("What-if accumulator has unexpected type.")
	}
	probability := 0.0
	if acc.total > 0 {
		probability = float64(acc.funded) / float64(acc.total)
	}
	return map[string]any{
		"fullFundingProbability": probability,
		"sampleCount":            acc.total,
	}, nil
}

func whatIfStatus(deterministic PathResult, probabilistic types.JsonValue) types.EvaluationResultStatus {
	if object, ok := probabilistic.(map[string]any); ok {
		if raw, exists := object["fullFundingProbability"]; exists {
			if probability, ok := raw.(float64); ok {
				if probability >= 0.5 {
					return types.StatusSatisfied
				}
				return types.StatusNotSatisfied
			}
		}
	}
	if result, ok := deterministic.(*WhatIfPathResult); ok && result.AllFunded {
		return types.StatusSatisfied
	}
	return types.StatusNotSatisfied
}

var whatIfDefinition = &EvaluationDefinition{
	Type:              types.EvaluationTypeWhatIf,
	Name:              "What-if",
	Kind:              EvaluationKindSimulator,
	AllowSimulation:   true,
	ValidateConfig:    validateWhatIfConfig,
	ParseConfig:       parseWhatIfConfig,
	EvaluatePath:      evaluateWhatIf,
	CreateAccumulator: createWhatIfAccumulator,
	Accumulate:        accumulateWhatIf,
	Finalize:          finalizeWhatIf,
	Status:            whatIfStatus,
	DescribeStochasticWork: func(_ *EvaluationContext, _ any) *EvaluationWorkloadPlan {
		return &EvaluationWorkloadPlan{
			UnitsPerRun: 1, UnitLabel: "what-if branch", UnitAction: "simulated",
			Description: "What-if branch simulations",
		}
	},
	MeasureStochasticWork: func(accumulator Accumulator) *EvaluationWorkloadMeasurement {
		if acc, ok := accumulator.(*whatIfAccumulator); ok {
			return &EvaluationWorkloadMeasurement{UnitsCompleted: acc.total}
		}
		return &EvaluationWorkloadMeasurement{}
	},
}
