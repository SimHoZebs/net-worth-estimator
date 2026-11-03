package domain

import (
	"github.com/simhozebs/net-worth-estimator/backend/internal/types"
)

// RuleBehavior marks one recurrence rule deterministic or stochastic.
// Deterministic uses a fixed or calculated amount. Stochastic samples a
// variable amount through the stochastic model.
type RuleBehavior string

const (
	RuleBehaviorDeterministic RuleBehavior = "deterministic"
	RuleBehaviorStochastic    RuleBehavior = "stochastic"
)

// RecurrencePreprocessorResult groups rule IDs by behavior.
type RecurrencePreprocessorResult struct {
	Deterministic []string
	Stochastic    []string
	ByRule        map[string]RuleBehavior
}

// RecurrencePreprocessor classifies rules without executing them.
// A rule is stochastic when any amount input binds provider
// occurrence-rate with volatility above zero. All other rules are
// deterministic, including fixed amounts and calculated amounts.
func RecurrencePreprocessor(model *types.FinancialModel) RecurrencePreprocessorResult {
	out := RecurrencePreprocessorResult{ByRule: map[string]RuleBehavior{}}
	if model == nil {
		return out
	}
	for _, rule := range model.RecurrenceRules {
		behavior := RuleBehaviorDeterministic
		if _, found := VolatileRateInputOf(rule.Amount); found {
			behavior = RuleBehaviorStochastic
		}
		out.ByRule[rule.ID] = behavior
		if behavior == RuleBehaviorStochastic {
			out.Stochastic = append(out.Stochastic, rule.ID)
		} else {
			out.Deterministic = append(out.Deterministic, rule.ID)
		}
	}
	return out
}
