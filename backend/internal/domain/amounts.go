package domain

import (
	"fmt"
	"math"
	"sort"

	"github.com/simhozebs/net-worth-estimator/backend/internal/types"
)

// Amount resolution ported from simulation/amountResolution.ts and
// simulation/incomeConfig.ts.

// AmountResolutionError mirrors AmountResolutionError / IncomeResolutionError.
type AmountResolutionError struct{ Message string }

func (e *AmountResolutionError) Error() string { return e.Message }

func amtErrf(format string, args ...any) *AmountResolutionError {
	return &AmountResolutionError{Message: fmt.Sprintf(format, args...)}
}

// AmountProviderContext supplies concrete values to providers.
type AmountProviderContext struct {
	Balances                     map[string]float64
	LatestRealizedPostingAmounts map[string]float64
	RealizedPostingAmountsByYear map[string]map[string]float64
	Date                         string
	OccurrenceRate               float64
}

// AmountReferenceContext validates ID references during validation.
type AmountReferenceContext struct {
	AccountIDs      map[string]bool
	PostingIDs      map[string]bool
	IncomeSourceIDs map[string]bool // nil = skip check
	TaxProfileIDs   map[string]bool // nil = skip check
}

type providerDefinition struct {
	resolve             func(args map[string]types.JsonValue, ctx *AmountProviderContext) (float64, error)
	validateReferences  func(args map[string]types.JsonValue, refs *AmountReferenceContext) error
	postingDependencies func(args map[string]types.JsonValue) []string
}

func argString(args map[string]types.JsonValue, key string) (string, bool) {
	v, ok := args[key]
	if !ok {
		return "", false
	}
	s, ok := v.(string)
	return s, ok && s != ""
}

func validateIDArgument(args map[string]types.JsonValue) (string, error) {
	id, ok := argString(args, "id")
	if !ok {
		return "", amtErrf("String must contain at least 1 character(s)")
	}
	return id, nil
}

var amountProviders = map[string]providerDefinition{
	"model-value": {
		resolve: func(args map[string]types.JsonValue, ctx *AmountProviderContext) (float64, error) {
			id := args["id"].(string)
			if v, ok := ctx.LatestRealizedPostingAmounts[id]; ok {
				return v, nil
			}
			if v, ok := ctx.Balances[id]; ok {
				return v, nil
			}
			return 0, nil
		},
		validateReferences: func(args map[string]types.JsonValue, refs *AmountReferenceContext) error {
			id, err := validateIDArgument(args)
			if err != nil {
				return err
			}
			if !refs.PostingIDs[id] && !refs.AccountIDs[id] {
				return amtErrf("Model value '%s' is not a posting or account ID.", id)
			}
			return nil
		},
		postingDependencies: func(args map[string]types.JsonValue) []string {
			if id, ok := args["id"].(string); ok {
				return []string{id}
			}
			return nil
		},
	},
	"posting-latest": {
		resolve: func(args map[string]types.JsonValue, ctx *AmountProviderContext) (float64, error) {
			return ctx.LatestRealizedPostingAmounts[args["id"].(string)], nil
		},
		validateReferences: func(args map[string]types.JsonValue, refs *AmountReferenceContext) error {
			id, err := validateIDArgument(args)
			if err != nil {
				return err
			}
			if !refs.PostingIDs[id] {
				return amtErrf("Posting '%s' does not exist.", id)
			}
			return nil
		},
		postingDependencies: func(args map[string]types.JsonValue) []string {
			if id, ok := args["id"].(string); ok {
				return []string{id}
			}
			return nil
		},
	},
	"posting-year-to-date": {
		resolve: func(args map[string]types.JsonValue, ctx *AmountProviderContext) (float64, error) {
			id := args["id"].(string)
			year := ctx.Date[:4]
			if byYear, ok := ctx.RealizedPostingAmountsByYear[id]; ok {
				return byYear[year], nil
			}
			return 0, nil
		},
		validateReferences: func(args map[string]types.JsonValue, refs *AmountReferenceContext) error {
			id, err := validateIDArgument(args)
			if err != nil {
				return err
			}
			if !refs.PostingIDs[id] {
				return amtErrf("Posting '%s' does not exist.", id)
			}
			return nil
		},
	},
	"posting-prior-year-to-date": {
		resolve: func(args map[string]types.JsonValue, ctx *AmountProviderContext) (float64, error) {
			id := args["id"].(string)
			year := ctx.Date[:4]
			var ytd float64
			if byYear, ok := ctx.RealizedPostingAmountsByYear[id]; ok {
				ytd = byYear[year]
			}
			latest := ctx.LatestRealizedPostingAmounts[id]
			return math.Max(0, ytd-latest), nil
		},
		validateReferences: func(args map[string]types.JsonValue, refs *AmountReferenceContext) error {
			id, err := validateIDArgument(args)
			if err != nil {
				return err
			}
			if !refs.PostingIDs[id] {
				return amtErrf("Posting '%s' does not exist.", id)
			}
			return nil
		},
	},
	"account-balance": {
		resolve: func(args map[string]types.JsonValue, ctx *AmountProviderContext) (float64, error) {
			return ctx.Balances[args["id"].(string)], nil
		},
		validateReferences: func(args map[string]types.JsonValue, refs *AmountReferenceContext) error {
			id, err := validateIDArgument(args)
			if err != nil {
				return err
			}
			if !refs.AccountIDs[id] {
				return amtErrf("Account '%s' does not exist.", id)
			}
			return nil
		},
	},
	"occurrence-rate": {
		resolve: func(_ map[string]types.JsonValue, ctx *AmountProviderContext) (float64, error) {
			return ctx.OccurrenceRate, nil
		},
	},
}

type resolverDefinition struct {
	requiredInputs func(config map[string]types.JsonValue) ([]string, error)
	resolve        func(config map[string]types.JsonValue, inputs map[string]float64) (float64, error)
}

// progressiveLiability computes tax over ascending brackets; final bracket's
// UpTo may be nil (open-ended).
func progressiveLiability(taxableAmount float64, brackets []struct {
	UpTo *float64
	Rate float64
}) float64 {
	previousLimit := 0.0
	liability := 0.0
	for _, bracket := range brackets {
		upper := taxableAmount
		if bracket.UpTo != nil {
			upper = *bracket.UpTo
		}
		width := math.Max(0, math.Min(taxableAmount, upper)-previousLimit)
		liability += width * bracket.Rate
		if taxableAmount <= upper {
			break
		}
		previousLimit = upper
	}
	return liability
}

type simpleBracket struct {
	UpTo *float64
	Rate float64
}

func liabilityFor(taxable float64, brackets []simpleBracket) float64 {
	previousLimit := 0.0
	liability := 0.0
	for _, b := range brackets {
		upper := taxable
		if b.UpTo != nil {
			upper = *b.UpTo
		}
		width := math.Max(0, math.Min(taxable, upper)-previousLimit)
		liability += width * b.Rate
		if taxable <= upper {
			break
		}
		previousLimit = upper
	}
	return liability
}

func numberConfig(config map[string]types.JsonValue, keys ...string) ([]float64, error) {
	values := make([]float64, len(keys))
	for i, key := range keys {
		v, ok := config[key]
		if !ok {
			return nil, amtErrf("Invalid input: expected number at %q", key)
		}
		n, ok := v.(float64)
		if !ok || math.IsNaN(n) || math.IsInf(n, 0) {
			return nil, amtErrf("Invalid input: expected finite number at %q", key)
		}
		values[i] = n
	}
	return values, nil
}

func validateProgressiveBrackets(config map[string]types.JsonValue) ([]simpleBracket, error) {
	raw, ok := config["brackets"]
	if !ok {
		return nil, amtErrf("Invalid 'progressive-bracket' config: Required")
	}
	list, ok := raw.([]any)
	if !ok {
		return nil, amtErrf("Invalid 'progressive-bracket' config: Expected array")
	}
	deductionRaw, ok := config["deduction"]
	if !ok {
		return nil, amtErrf("Invalid 'progressive-bracket' config: deduction required")
	}
	deduction, ok := deductionRaw.(float64)
	if !ok || deduction < 0 || math.IsNaN(deduction) {
		return nil, amtErrf("Invalid 'progressive-bracket' config: deduction must be a non-negative number")
	}
	brackets := make([]simpleBracket, 0, len(list))
	for _, item := range list {
		entry, ok := item.(map[string]any)
		if !ok {
			return nil, amtErrf("Invalid 'progressive-bracket' config: bracket must be an object")
		}
		rate, ok := entry["rate"].(float64)
		if !ok || rate < 0 || rate > 1 {
			return nil, amtErrf("Invalid 'progressive-bracket' config: rate out of range")
		}
		bracket := simpleBracket{Rate: rate}
		switch upTo := entry["upTo"].(type) {
		case nil:
			bracket.UpTo = nil
		case float64:
			if math.IsNaN(upTo) || math.IsInf(upTo, 0) {
				return nil, amtErrf("Invalid 'progressive-bracket' config: upTo must be finite or null")
			}
			bracket.UpTo = &upTo
		default:
			return nil, amtErrf("Invalid 'progressive-bracket' config: upTo must be a number or null")
		}
		brackets = append(brackets, bracket)
	}
	if len(brackets) == 0 || brackets[len(brackets)-1].UpTo != nil {
		return nil, amtErrf("The final bracket must have upTo null.")
	}
	previous := 0.0
	for i, bracket := range brackets {
		if bracket.UpTo == nil {
			if i != len(brackets)-1 {
				return nil, amtErrf("Only the final bracket may have upTo null.")
			}
			continue
		}
		if *bracket.UpTo <= previous {
			return nil, amtErrf("Bracket limits must be strictly ascending.")
		}
		previous = *bracket.UpTo
	}
	return brackets, nil
}

var amountResolvers = map[string]resolverDefinition{
	"expression": {
		requiredInputs: func(config map[string]types.JsonValue) ([]string, error) {
			expression, _ := config["expression"].(string)
			reqs, err := ArithmeticRequirements(expression)
			if err != nil {
				return nil, err
			}
			return reqs, nil
		},
		resolve: func(config map[string]types.JsonValue, inputs map[string]float64) (float64, error) {
			expression, _ := config["expression"].(string)
			return EvaluateArithmetic(expression, inputs)
		},
	},
	"percentage": {
		requiredInputs: func(map[string]types.JsonValue) ([]string, error) {
			return []string{"amount"}, nil
		},
		resolve: func(config map[string]types.JsonValue, inputs map[string]float64) (float64, error) {
			vals, err := numberConfig(config, "rate")
			if err != nil {
				return 0, err
			}
			return math.Max(0, inputs["amount"]) * vals[0], nil
		},
	},
	"progressive-bracket": {
		requiredInputs: func(map[string]types.JsonValue) ([]string, error) {
			return []string{"currentAmount", "yearToDateAmount", "yearToDateResolvedAmount"}, nil
		},
		resolve: func(config map[string]types.JsonValue, inputs map[string]float64) (float64, error) {
			brackets, err := validateProgressiveBrackets(config)
			if err != nil {
				return 0, err
			}
			taxable := math.Max(0, inputs["yearToDateAmount"]+inputs["currentAmount"]-config["deduction"].(float64))
			resolved := math.Max(0, inputs["yearToDateResolvedAmount"])
			return math.Max(0, liabilityFor(taxable, brackets)-resolved), nil
		},
	},
	"capped-percentage": {
		requiredInputs: func(map[string]types.JsonValue) ([]string, error) {
			return []string{"currentAmount", "yearToDateAmount"}, nil
		},
		resolve: func(config map[string]types.JsonValue, inputs map[string]float64) (float64, error) {
			vals, err := numberConfig(config, "rate", "cap")
			if err != nil {
				return 0, err
			}
			rate, capValue := vals[0], vals[1]
			return math.Min(
				math.Max(0, inputs["currentAmount"]),
				math.Max(0, capValue-math.Max(0, inputs["yearToDateAmount"])),
			) * rate, nil
		},
	},
	"threshold-percentage": {
		requiredInputs: func(map[string]types.JsonValue) ([]string, error) {
			return []string{"currentAmount", "yearToDateAmount"}, nil
		},
		resolve: func(config map[string]types.JsonValue, inputs map[string]float64) (float64, error) {
			vals, err := numberConfig(config, "rate", "threshold")
			if err != nil {
				return 0, err
			}
			rate, threshold := vals[0], vals[1]
			return (math.Max(0, inputs["yearToDateAmount"]+inputs["currentAmount"]-threshold) -
				math.Max(0, inputs["yearToDateAmount"]-threshold)) * rate, nil
		},
	},
}

func validateExactKeys(actual map[string]types.AmountInputBinding, required []string) error {
	expected := make(map[string]bool, len(required))
	for _, key := range required {
		expected[key] = true
	}
	sortedKeys := make([]string, 0, len(actual))
	for key := range actual {
		sortedKeys = append(sortedKeys, key)
	}
	sort.Strings(sortedKeys)
	var missing, extra []string
	for _, key := range required {
		if _, ok := actual[key]; !ok {
			missing = append(missing, key)
		}
	}
	for _, key := range sortedKeys {
		if !expected[key] {
			extra = append(extra, key)
		}
	}
	if len(missing) > 0 || len(extra) > 0 {
		missingText := "none"
		if len(missing) > 0 {
			missingText = joinStrings(missing, ", ")
		}
		extraText := "none"
		if len(extra) > 0 {
			extraText = joinStrings(extra, ", ")
		}
		return amtErrf("Amount inputs do not match requirements. Missing: %s. Extra: %s.", missingText, extraText)
	}
	return nil
}

func joinStrings(items []string, sep string) string {
	out := ""
	for i, item := range items {
		if i > 0 {
			out += sep
		}
		out += item
	}
	return out
}

// ValidateAmountDescriptor validates an amount descriptor and returns posting
// dependencies for cycle detection. Port of validateAmountDescriptor.
func ValidateAmountDescriptor(amount types.PostingAmountResolution, references *AmountReferenceContext) ([]string, error) {
	if amount.Resolver == "income" {
		if len(amount.Inputs) > 0 {
			return nil, amtErrf("Income amount descriptors cannot define generic inputs.")
		}
		if err := ValidateIncomeAmountConfig(amount.Config, references); err != nil {
			if resErr, ok := err.(*IncomeResolutionError); ok {
				return nil, amtErrf("%s", resErr.Message)
			}
			return nil, amtErrf("%s", err.Error())
		}
		return []string{}, nil
	}
	resolver, ok := amountResolvers[amount.Resolver]
	if !ok {
		return nil, amtErrf("Unknown amount resolver '%s'.", amount.Resolver)
	}
	config, err := resolver.requiredInputs(amount.Config)
	if err != nil {
		return nil, err
	}
	if err := validateExactKeys(amount.Inputs, config); err != nil {
		return nil, err
	}
	dependencies := []string{}
	names := make([]string, 0, len(amount.Inputs))
	for name := range amount.Inputs {
		names = append(names, name)
	}
	sort.Strings(names)
	for _, name := range names {
		binding := amount.Inputs[name]
		if binding.Source == "literal" {
			value, ok := binding.Value.(float64)
			if !ok || math.IsNaN(value) || math.IsInf(value, 0) {
				return nil, amtErrf("Literal amount input '%s' must be a finite number.", name)
			}
			continue
		}
		provider, ok := amountProviders[binding.Provider]
		if !ok {
			return nil, amtErrf("Unknown amount provider '%s' for input '%s'.", binding.Provider, name)
		}
		if references != nil && provider.validateReferences != nil {
			if err := provider.validateReferences(binding.Arguments, references); err != nil {
				return nil, err
			}
		}
		if references != nil && provider.postingDependencies != nil {
			for _, id := range provider.postingDependencies(binding.Arguments) {
				if references.PostingIDs[id] {
					dependencies = append(dependencies, id)
				}
			}
		}
	}
	return dependencies, nil
}

// ResolvePostingAmountDescriptor resolves a non-income posting amount.
func ResolvePostingAmountDescriptor(amount types.PostingAmountResolution, ctx *AmountProviderContext) (float64, error) {
	if amount.Resolver == "income" {
		return 0, amtErrf("Income amounts must be resolved by the income transition.")
	}
	resolver, ok := amountResolvers[amount.Resolver]
	if !ok {
		return 0, amtErrf("Unknown amount resolver '%s'.", amount.Resolver)
	}
	required, err := resolver.requiredInputs(amount.Config)
	if err != nil {
		return 0, err
	}
	if err := validateExactKeys(amount.Inputs, required); err != nil {
		return 0, err
	}
	concreteInputs := make(map[string]float64, len(amount.Inputs))
	for name, binding := range amount.Inputs {
		var value float64
		if binding.Source == "literal" {
			literal, ok := binding.Value.(float64)
			if !ok {
				return 0, amtErrf("Amount input '%s' must resolve to a finite number.", name)
			}
			value = literal
		} else {
			provider, ok := amountProviders[binding.Provider]
			if !ok {
				return 0, amtErrf("Unknown amount provider '%s'.", binding.Provider)
			}
			resolved, err := provider.resolve(binding.Arguments, ctx)
			if err != nil {
				return 0, err
			}
			value = resolved
		}
		if math.IsNaN(value) || math.IsInf(value, 0) {
			return 0, amtErrf("Amount input '%s' must resolve to a finite number.", name)
		}
		concreteInputs[name] = value
	}
	result, err := resolver.resolve(amount.Config, concreteInputs)
	if err != nil {
		return 0, err
	}
	if math.IsNaN(result) || math.IsInf(result, 0) {
		return 0, amtErrf("Amount resolver returned a nonfinite value.")
	}
	return result, nil
}
