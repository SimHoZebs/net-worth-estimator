package domain

import (
	"fmt"
	"math"
	"sort"
	"strings"

	"github.com/simhozebs/net-worth-estimator/backend/internal/types"
)

// Amount resolution for posting and rule configurations.

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
	// FrequencyDivisor converts an annual rate to a per-occurrence rate.
	// Rules carry their frequency divisor; manual postings use 1.
	FrequencyDivisor int
	// RuleStartDate is the owning rule's start date, or "" for manual
	// postings. It anchors the growth-factor provider.
	RuleStartDate string
	// SampledAnnualRate is the pre-sampled annual rate for this movement
	// in this projection year, or nil when the movement is not sampled
	// (deterministic runs and non-volatile amounts). Sampling stays
	// coordinator-owned; providers only look the value up.
	SampledAnnualRate *float64
}

// AmountReferenceContext validates ID references during validation.
type AmountReferenceContext struct {
	AccountIDs map[string]bool
	PostingIDs map[string]bool
}

type providerDefinition struct {
	// Name is the provider key used in AmountInputBinding.Provider.
	// Registered once via RegisterAmountProvider; duplicates panic.
	name string
	// Description is human-readable help surfaced by the discovery endpoint.
	description         string
	resolve             func(args map[string]types.JsonValue, ctx *AmountProviderContext) (float64, error)
	validateReferences  func(args map[string]types.JsonValue, refs *AmountReferenceContext) error
	postingDependencies func(args map[string]types.JsonValue) []string
	// volatileParams reports stochastic sampling parameters when the
	// provider carries rate behavior. Nil means never volatile.
	// occurrence-rate is the only built-in volatile provider; custom
	// plugins opt in by setting this hook.
	volatileParams func(args map[string]types.JsonValue) (annualRate, volatility float64, volatile bool)
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

// argFloat reads a finite-number argument. Required arguments must be
// present; optional ones fall back to fallback when absent.
func argFloat(args map[string]types.JsonValue, key string, required bool, fallback float64) (float64, error) {
	raw, ok := args[key]
	if !ok {
		if required {
			return 0, amtErrf("Amount provider argument '%s' must be a finite number.", key)
		}
		return fallback, nil
	}
	value, ok := raw.(float64)
	if !ok || math.IsNaN(value) || math.IsInf(value, 0) {
		return 0, amtErrf("Amount provider argument '%s' must be a finite number.", key)
	}
	return value, nil
}

// validateRateArgs checks the shared occurrence-rate argument shape:
// a finite annualRate plus a finite volatility at or above zero.
func validateRateArgs(args map[string]types.JsonValue) (float64, float64, error) {
	annualRate, err := argFloat(args, "annualRate", true, 0)
	if err != nil {
		return 0, 0, err
	}
	volatility, err := argFloat(args, "volatility", false, 0)
	if err != nil {
		return 0, 0, err
	}
	if volatility < 0 {
		return 0, 0, amtErrf("Amount provider argument 'volatility' must be at or above zero.")
	}
	return annualRate, volatility, nil
}

// RegisterAmountProvider adds a named amount provider. It panics on empty
// names, nil resolve funcs, or duplicate registration so miswiring fails
// fast at init time instead of surfacing as a mid-simulation unknown.
func RegisterAmountProvider(name, description string, def providerDefinition) {
	if name == "" {
		panic("RegisterAmountProvider: empty provider name")
	}
	if def.resolve == nil {
		panic("RegisterAmountProvider: nil resolve for '" + name + "'")
	}
	if _, exists := amountProviders[name]; exists {
		panic("RegisterAmountProvider: duplicate provider '" + name + "'")
	}
	def.name = name
	def.description = description
	amountProviders[name] = def
}

// LookupAmountProvider returns the provider and true when registered.
func LookupAmountProvider(name string) (providerDefinition, bool) {
	def, ok := amountProviders[name]
	return def, ok
}

// ListAmountProviders returns registered provider names in sorted order.
// The order is part of no contract; VolatileRateInputOf sorts input names
// instead so seeded sampling stays stable.
func ListAmountProviders() []AmountProviderInfo {
	out := make([]AmountProviderInfo, 0, len(amountProviders))
	for name, def := range amountProviders {
		out = append(out, AmountProviderInfo{Name: name, Description: def.description})
	}
	sort.Slice(out, func(i, j int) bool { return out[i].Name < out[j].Name })
	return out
}

// AmountProviderInfo describes one registered provider for discovery.
// Only wiring: name, technical description, volatility behavior, and
// required argument keys. Human words live in the frontend.
type AmountProviderInfo struct {
	Name        string            `json:"name"`
	Description string            `json:"description"`
	Volatile    bool              `json:"volatile,omitempty"`
	ArgFields   []AmountFieldSpec `json:"argFields,omitempty"`
}

// Design: accounts stay dumb, movements carry behavior. Accounts expose
// only floor/ceiling/withdrawable/headroom (see accounts.go). Fees and
// minimums live in PaymentTerms plus the providers below, and a posting or
// rule reads them to move money. Terms declare what is owed; an enabled
// movement behind them moves it.
//
// Live plan uses: model-value, account-balance, occurrence-rate and
// growth-factor with the expression resolver. Payroll modeling (tested,
// seeded): chained expression rules with the progressive-bracket resolver
// for tax. Debt feature (tested, unused in seed CSVs): terms-minimum,
// late-fee, balance-fee. There are no other generic resolvers.
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
		// occurrence-rate carries a movement's rate behavior: the annual
		// rate plus the volatility sampled per projection year. The
		// divisor comes from context (rule frequency, 1 for manuals) and
		// the sampled annual rate arrives pre-sampled from the stochastic
		// coordinator; providers never draw RNG themselves.
		resolve: func(args map[string]types.JsonValue, ctx *AmountProviderContext) (float64, error) {
			annualRate, volatility, err := validateRateArgs(args)
			if err != nil {
				return 0, err
			}
			effective := annualRate
			if volatility > 0 && ctx.SampledAnnualRate != nil {
				effective = *ctx.SampledAnnualRate
			}
			divisor := ctx.FrequencyDivisor
			if divisor <= 0 {
				divisor = 1
			}
			return effective / float64(divisor), nil
		},
		validateReferences: func(args map[string]types.JsonValue, refs *AmountReferenceContext) error {
			_, _, err := validateRateArgs(args)
			return err
		},
		volatileParams: func(args map[string]types.JsonValue) (float64, float64, bool) {
			annualRate, volatility, err := validateRateArgs(args)
			if err != nil || volatility <= 0 {
				return 0, 0, false
			}
			return annualRate, volatility, true
		},
	},
	// growth-factor resolves the compounding factor for a movement's
	// annual growth rate over the days from the rule start date to the
	// occurrence date. Expressions multiply it explicitly, so one-time
	// and recurring movements resolve through the same path. Manual
	// postings have no start date and resolve 1.
	"growth-factor": {
		resolve: func(args map[string]types.JsonValue, ctx *AmountProviderContext) (float64, error) {
			annualGrowthRate, err := argFloat(args, "annualGrowthRate", true, 0)
			if err != nil {
				return 0, err
			}
			if annualGrowthRate == 0 || ctx.RuleStartDate == "" || ctx.Date == "" {
				return 1, nil
			}
			daysElapsed := DaysBetween(ctx.RuleStartDate, ctx.Date)
			if daysElapsed <= 0 {
				return 1, nil
			}
			return math.Pow(1+annualGrowthRate, float64(daysElapsed)/365), nil
		},
		validateReferences: func(args map[string]types.JsonValue, refs *AmountReferenceContext) error {
			_, err := argFloat(args, "annualGrowthRate", true, 0)
			return err
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

// VolatileRateParams is one movement's stochastic sampling configuration:
// the annual rate and volatility reported by its single volatile provider
// input. Movements carry at most one volatile input; every volatile input
// in a movement shares the movement's one pre-sampled annual rate.
type VolatileRateParams struct {
	AnnualRate float64
	Volatility float64
	// Provider names the volatile provider that reported the parameters.
	Provider string
}

// VolatileRateInputOf scans an amount descriptor for volatile provider
// inputs in sorted input-name order and returns the sampling parameters.
// Providers opt in via volatileParams; malformed arguments report
// found=false here while ValidateAmountDescriptor reports them.
func VolatileRateInputOf(amount types.PostingAmountResolution) (params VolatileRateParams, found bool) {
	names := make([]string, 0, len(amount.Inputs))
	for name := range amount.Inputs {
		names = append(names, name)
	}
	sort.Strings(names)
	for _, name := range names {
		binding := amount.Inputs[name]
		if binding.Source != "provider" {
			continue
		}
		def, ok := amountProviders[binding.Provider]
		if !ok || def.volatileParams == nil {
			continue
		}
		annualRate, volatility, volatile := def.volatileParams(binding.Arguments)
		if !volatile {
			continue
		}
		if found {
			// Multiple volatile inputs: validation reports it; discovery
			// keeps the first in sorted order for a stable error path.
			continue
		}
		params = VolatileRateParams{AnnualRate: annualRate, Volatility: volatility, Provider: binding.Provider}
		found = true
	}
	return params, found
}

// CountVolatileRateInputs reports how many provider inputs in an amount
// descriptor carry volatility. Validation rejects more than one: one
// movement shares one pre-sampled annual rate.
func CountVolatileRateInputs(amount types.PostingAmountResolution) int {
	count := 0
	for _, binding := range amount.Inputs {
		if binding.Source != "provider" {
			continue
		}
		def, ok := amountProviders[binding.Provider]
		if !ok || def.volatileParams == nil {
			continue
		}
		if _, _, volatile := def.volatileParams(binding.Arguments); volatile {
			count++
		}
	}
	return count
}

type resolverDefinition struct {
	name string
	// Description is human-readable help surfaced by the discovery endpoint.
	description    string
	requiredInputs func(config map[string]types.JsonValue) ([]string, error)
	resolve        func(config map[string]types.JsonValue, inputs map[string]float64) (float64, error)
}

var amountResolvers = map[string]resolverDefinition{
	"expression": {
		name:        "expression",
		description: "Arithmetic expression over named inputs (identifiers, rate, abs, + - * /).",
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

// RegisterAmountResolver adds a named amount resolver. It panics on empty
// names, nil funcs, or duplicate registration so miswiring fails fast.
func RegisterAmountResolver(name, description string, def resolverDefinition) {
	if name == "" {
		panic("RegisterAmountResolver: empty resolver name")
	}
	if def.requiredInputs == nil || def.resolve == nil {
		panic("RegisterAmountResolver: nil funcs for '" + name + "'")
	}
	if _, exists := amountResolvers[name]; exists {
		panic("RegisterAmountResolver: duplicate resolver '" + name + "'")
	}
	def.name = name
	def.description = description
	amountResolvers[name] = def
}

// LookupAmountResolver returns the resolver and true when registered.
func LookupAmountResolver(name string) (resolverDefinition, bool) {
	def, ok := amountResolvers[name]
	return def, ok
}

// AmountResolverInfo describes one registered resolver for discovery.
// Only wiring: name, technical description, and required config keys.
// Human words live in the frontend.
type AmountResolverInfo struct {
	Name         string            `json:"name"`
	Description  string            `json:"description"`
	ConfigFields []AmountFieldSpec `json:"configFields,omitempty"`
}

// ListAmountResolvers returns registered resolvers in sorted name order.
func ListAmountResolvers() []AmountResolverInfo {
	out := make([]AmountResolverInfo, 0, len(amountResolvers))
	for _, def := range amountResolvers {
		out = append(out, AmountResolverInfo{Name: def.name, Description: def.description})
	}
	sort.Slice(out, func(i, j int) bool { return out[i].Name < out[j].Name })
	return out
}

func init() {
	describe := func(name, description string) {
		if def, ok := amountProviders[name]; ok {
			def.description = description
			amountProviders[name] = def
		}
	}
	describe("model-value", "Latest realized posting amount, falling back to account balance.")
	describe("account-balance", "Live balance of one account.")
	describe("occurrence-rate", "Per-occurrence rate from annualRate/frequency with optional stochastic volatility.")
	describe("growth-factor", "Compounding factor for annualGrowthRate over rule start to occurrence date.")
	describe("terms-minimum", "Payment-terms minimum for one account.")
	describe("late-fee", "Flat fee when a payment posting fell short of its terms minimum this month.")
	describe("balance-fee", "Flat fee when an account balance sits below a threshold.")
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
// dependencies for cycle detection. Resolvers and providers come from the
// registry; RegisterAmountResolver/RegisterAmountProvider extend it without
// touching this function.
func ValidateAmountDescriptor(amount types.PostingAmountResolution, references *AmountReferenceContext) ([]string, error) {
	resolver, ok := LookupAmountResolver(amount.Resolver)
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
		provider, ok := LookupAmountProvider(binding.Provider)
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

// ResolvePostingAmountDescriptor resolves a posting amount.
// Resolver and provider implementations come from the registry.
func ResolvePostingAmountDescriptor(amount types.PostingAmountResolution, ctx *AmountProviderContext) (float64, error) {
	resolver, ok := LookupAmountResolver(amount.Resolver)
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
			provider, ok := LookupAmountProvider(binding.Provider)
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
