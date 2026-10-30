package domain

import (
	"math"

	"github.com/simhozebs/net-worth-estimator/backend/internal/types"
)

// Progressive-bracket resolver: generic tax liability on computed inputs.
//
// Amount: {resolver: "progressive-bracket",
//
//	config: {deduction?, brackets: [{upTo?, rate}]},
//	inputs: {gross: <provider>, pretax: <provider>}}
//
// Liability applies over max(0, gross - pretax - deduction) through the
// bracket table. Inputs compose through the standard input mechanism, so
// gross and pretax are model-value bindings (or literals — bind pretax to
// literal 0 when there is no pre-tax slice). All figures are per-occurrence,
// like every other transaction amount: scale annual tables to the rule's
// frequency when authoring. Annual caps come from the rule, not the resolver.
func init() {
	RegisterAmountResolver(
		"progressive-bracket",
		"Progressive tax liability on (gross - pretax - deduction).",
		resolverDefinition{
			requiredInputs: func(config map[string]types.JsonValue) ([]string, error) {
				if err := validateBracketTable(config); err != nil {
					return nil, err
				}
				return []string{"gross", "pretax"}, nil
			},
			resolve: func(config map[string]types.JsonValue, inputs map[string]float64) (float64, error) {
				if err := validateBracketTable(config); err != nil {
					return 0, err
				}
				deduction, _ := config["deduction"].(float64)
				rawBrackets, _ := config["brackets"].([]any)
				brackets := make([]inlineBracket, 0, len(rawBrackets))
				for _, raw := range rawBrackets {
					bracket, err := parseInlineBracket(raw)
					if err != nil {
						return 0, err
					}
					brackets = append(brackets, bracket)
				}
				gross, ok := inputs["gross"]
				if !ok || math.IsNaN(gross) || math.IsInf(gross, 0) {
					return 0, amtErrf("Progressive-bracket input 'gross' must resolve to a finite number.")
				}
				pretax, ok := inputs["pretax"]
				if !ok || math.IsNaN(pretax) || math.IsInf(pretax, 0) {
					return 0, amtErrf("Progressive-bracket input 'pretax' must resolve to a finite number.")
				}
				return inlineBracketLiability(gross-pretax, deduction, brackets), nil
			},
		},
	)
}

// validateBracketTable checks the resolver config shape: optional
// non-negative deduction plus a non-empty bracket table.
func validateBracketTable(config map[string]types.JsonValue) error {
	if deductionRaw, present := config["deduction"]; present && deductionRaw != nil {
		deduction, ok := deductionRaw.(float64)
		if !ok || math.IsNaN(deduction) || math.IsInf(deduction, 0) || deduction < 0 {
			return amtErrf("Progressive-bracket deduction must be a non-negative number.")
		}
	}
	rawBrackets, ok := config["brackets"].([]any)
	if !ok || len(rawBrackets) == 0 {
		return amtErrf("Progressive-bracket brackets must be a non-empty array.")
	}
	for _, raw := range rawBrackets {
		if _, err := parseInlineBracket(raw); err != nil {
			return err
		}
	}
	return nil
}

// inlineBracket is one progressive table row: rate applies above the
// previous limit up to upTo (nil = open-ended).
type inlineBracket struct {
	upTo *float64
	rate float64
}

func parseInlineBracket(raw any) (inlineBracket, error) {
	var bracket inlineBracket
	stepMap, ok := raw.(map[string]any)
	if !ok {
		return bracket, amtErrf("Invalid bracket: must be an object")
	}
	rateRaw, ok := stepMap["rate"]
	if !ok {
		return bracket, amtErrf("Invalid bracket: rate required")
	}
	rate, ok := rateRaw.(float64)
	if !ok || math.IsNaN(rate) || rate < 0 || rate > 1 {
		return bracket, amtErrf("Invalid bracket: rate must be a number in [0,1]")
	}
	bracket.rate = rate
	if upToRaw, present := stepMap["upTo"]; present && upToRaw != nil {
		upTo, ok := upToRaw.(float64)
		if !ok || math.IsNaN(upTo) || upTo <= 0 {
			return bracket, amtErrf("Invalid bracket: upTo must be a positive number or null")
		}
		bracket.upTo = &upTo
	}
	return bracket, nil
}

func inlineBracketLiability(taxableAmount float64, deduction float64, brackets []inlineBracket) float64 {
	remaining := math.Max(0, taxableAmount-deduction)
	previousLimit := 0.0
	liability := 0.0
	for _, bracket := range brackets {
		upper := remaining
		if bracket.upTo != nil {
			upper = *bracket.upTo
		}
		width := math.Max(0, math.Min(remaining, upper)-previousLimit)
		liability += width * bracket.rate
		if remaining <= upper {
			break
		}
		previousLimit = upper
	}
	return liability
}
