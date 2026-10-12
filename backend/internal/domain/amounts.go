package domain

import (
	"fmt"
	"math"
	"sort"
	"strings"

	"github.com/simhozebs/net-worth-estimator/backend/internal/types"
)

// Amount resolution for posting and income configurations.

// AmountResolutionError reports amount-resolution failures.
type AmountResolutionError struct{ Message string }

func (e *AmountResolutionError) Error() string { return e.Message }

func amtErrf(format string, args ...any) *AmountResolutionError {
	return &AmountResolutionError{Message: fmt.Sprintf(format, args...)}
}

// AmountProviderContext supplies concrete values to providers.
type AmountProviderContext struct {
	Balances                     map[string]float64
	LatestRealizedPostingAmounts map[string]float64
	LatestRealizedPostingDates   map[string]string
	RealizedPostingAmountsByYear map[string]map[string]float64
	PaymentTerms                 map[string]types.PaymentTerms
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

// Design: accounts stay dumb, movements carry behavior. Accounts expose
// only floor/ceiling/withdrawable/headroom (see accounts.go). Fees and
// minimums live in PaymentTerms plus the providers below, and a posting or
// rule reads them to move money. Terms declare what is owed; an enabled
// movement behind them moves it.
//
// Live plan uses: model-value, account-balance, occurrence-rate with the
// expression resolver. Debt feature (tested, unused in seed CSVs): terms-minimum,
// late-fee, balance-fee. Income pipeline in income.go has its own
// percentage/progressive-bracket steps; there are no other generic resolvers.
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
	// terms-minimum resolves a payment-terms minimum for one account: the
	// fixed minimum, or the percent share of the balance magnitude when set,
	// whichever is larger. Terms stay the single source for minimums; the
	// payment posting carries schedule and destinations only.
	"terms-minimum": {
		resolve: func(args map[string]types.JsonValue, ctx *AmountProviderContext) (float64, error) {
			id, err := validateIDArgument(args)
			if err != nil {
				return 0, err
			}
			terms, ok := ctx.PaymentTerms[id]
			if !ok {
				return 0, amtErrf("Account '%s' has no payment terms.", id)
			}
			return termsMinimum(terms, ctx.Balances[id]), nil
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
	// late-fee resolves a flat fee when the referenced payment posting fell
	// short of its terms minimum in the fee's calendar month, and zero
	// otherwise. The same-month guard keeps pre-history occurrences and
	// disabled shells from charging stale shortfalls: no payment execution
	// this month means no fee. Monthly dues assumed.
	"late-fee": {
		resolve: func(args map[string]types.JsonValue, ctx *AmountProviderContext) (float64, error) {
			paymentID, ok := args["payment"].(string)
			if !ok || strings.TrimSpace(paymentID) == "" {
				return 0, amtErrf("Late fee 'payment' must be a non-empty posting ID.")
			}
			accountID, ok := args["account"].(string)
			if !ok || strings.TrimSpace(accountID) == "" {
				return 0, amtErrf("Late fee 'account' must be a non-empty account ID.")
			}
			fee, ok := args["fee"].(float64)
			if !ok || math.IsNaN(fee) || math.IsInf(fee, 0) || fee < 0 {
				return 0, amtErrf("Late fee 'fee' must be a finite number at or above zero.")
			}
			terms, ok := ctx.PaymentTerms[accountID]
			if !ok {
				return 0, amtErrf("Account '%s' has no payment terms.", accountID)
			}
			lastDate, ok := ctx.LatestRealizedPostingDates[paymentID]
			if !ok || len(lastDate) < 7 || len(ctx.Date) < 7 || lastDate[:7] != ctx.Date[:7] {
				return 0, nil
			}
			paid := ctx.LatestRealizedPostingAmounts[paymentID]
			if math.Max(0, termsMinimum(terms, ctx.Balances[accountID])-paid) > 0 {
				return fee, nil
			}
			return 0, nil
		},
		validateReferences: func(args map[string]types.JsonValue, refs *AmountReferenceContext) error {
			paymentID, ok := args["payment"].(string)
			if !ok || strings.TrimSpace(paymentID) == "" {
				return amtErrf("Late fee 'payment' must be a non-empty posting ID.")
			}
			if !refs.PostingIDs[paymentID] {
				return amtErrf("Posting '%s' does not exist.", paymentID)
			}
			accountID, ok := args["account"].(string)
			if !ok || strings.TrimSpace(accountID) == "" {
				return amtErrf("Late fee 'account' must be a non-empty account ID.")
			}
			if !refs.AccountIDs[accountID] {
				return amtErrf("Account '%s' does not exist.", accountID)
			}
			fee, ok := args["fee"].(float64)
			if !ok || math.IsNaN(fee) || math.IsInf(fee, 0) || fee < 0 {
				return amtErrf("Late fee 'fee' must be a finite number at or above zero.")
			}
			return nil
		},
		postingDependencies: func(args map[string]types.JsonValue) []string {
			if id, ok := args["payment"].(string); ok {
				return []string{id}
			}
			return nil
		},
	},
	// balance-fee resolves a flat fee when an account's live balance sits
	// below a threshold at the occurrence date, and zero otherwise. The
	// balance read is live, so unlike ledger conditions there is no
	// staleness guard to maintain: each monthly assessment sees the current
	// balance. At exactly the threshold no fee applies.
	"balance-fee": {
		resolve: func(args map[string]types.JsonValue, ctx *AmountProviderContext) (float64, error) {
			accountID, ok := args["account"].(string)
			if !ok || strings.TrimSpace(accountID) == "" {
				return 0, amtErrf("Balance fee 'account' must be a non-empty account ID.")
			}
			threshold, ok := args["threshold"].(float64)
			if !ok || math.IsNaN(threshold) || math.IsInf(threshold, 0) {
				return 0, amtErrf("Balance fee 'threshold' must be a finite number.")
			}
			fee, ok := args["fee"].(float64)
			if !ok || math.IsNaN(fee) || math.IsInf(fee, 0) || fee < 0 {
				return 0, amtErrf("Balance fee 'fee' must be a finite number at or above zero.")
			}
			if ctx.Balances[accountID] < threshold {
				return fee, nil
			}
			return 0, nil
		},
		validateReferences: func(args map[string]types.JsonValue, refs *AmountReferenceContext) error {
			accountID, ok := args["account"].(string)
			if !ok || strings.TrimSpace(accountID) == "" {
				return amtErrf("Balance fee 'account' must be a non-empty account ID.")
			}
			if !refs.AccountIDs[accountID] {
				return amtErrf("Account '%s' does not exist.", accountID)
			}
			threshold, ok := args["threshold"].(float64)
			if !ok || math.IsNaN(threshold) || math.IsInf(threshold, 0) {
				return amtErrf("Balance fee 'threshold' must be a finite number.")
			}
			fee, ok := args["fee"].(float64)
			if !ok || math.IsNaN(fee) || math.IsInf(fee, 0) || fee < 0 {
				return amtErrf("Balance fee 'fee' must be a finite number at or above zero.")
			}
			return nil
		},
	},
}

// termsMinimum is the effective minimum for a terms row against a balance:
// the fixed minimum, or the percent share of the balance magnitude when set,
// whichever is larger. Percent is a ratio in [0,1].
func termsMinimum(terms types.PaymentTerms, balance float64) float64 {
	minimum := math.Max(0, terms.MinimumFixed)
	if terms.MinimumPercent != nil {
		percent := math.Min(1, math.Max(0, *terms.MinimumPercent))
		minimum = math.Max(minimum, percent*math.Abs(balance))
	}
	return minimum
}

type resolverDefinition struct {
	requiredInputs func(config map[string]types.JsonValue) ([]string, error)
	resolve        func(config map[string]types.JsonValue, inputs map[string]float64) (float64, error)
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
			missingText = strings.Join(missing, ", ")
		}
		extraText := "none"
		if len(extra) > 0 {
			extraText = strings.Join(extra, ", ")
		}
		return amtErrf("Amount inputs do not match requirements. Missing: %s. Extra: %s.", missingText, extraText)
	}
	return nil
}

// ValidateAmountDescriptor validates an amount descriptor and returns posting
// dependencies for cycle detection.
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
