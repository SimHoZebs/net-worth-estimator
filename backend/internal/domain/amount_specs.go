package domain

import (
	"sort"
)

// Minimal discovery wiring for resolvers and providers.
//
// The wire shape (PostingAmountResolution with resolver/config/inputs) is
// unchanged. This endpoint exposes only the machine facts a client needs
// to build and validate that wire shape without hard-coding registry
// logic: entry names, field keys, field kinds, and required flags.
// All human words (labels, summaries, templates, examples) live in the
// frontend. All builders compile down to the same wire shape validated
// by ValidateAmountDescriptor.

// Field kinds tell a client which control to render for a key:
// expression, money, percent, rate, volatility, account, posting,
// posting-or-account, brackets.
type AmountFieldSpec struct {
	Key      string `json:"key"`
	Kind     string `json:"kind"`
	Required bool   `json:"required"`
}

// ResolverSpecs returns wiring for every registered resolver.
func ListAmountResolverSpecs() []AmountResolverInfo {
	base := ListAmountResolvers()
	specs := map[string]AmountResolverInfo{
		"expression": {
			Name:        "expression",
			Description: "Arithmetic expression over named inputs (identifiers, rate, abs, + - * /).",
			ConfigFields: []AmountFieldSpec{
				{Key: "expression", Kind: "expression", Required: true},
			},
		},
		"progressive-bracket": {
			Name:        "progressive-bracket",
			Description: "Progressive tax liability on (gross - pretax - deduction).",
			ConfigFields: []AmountFieldSpec{
				{Key: "deduction", Kind: "money", Required: false},
				{Key: "brackets", Kind: "brackets", Required: true},
			},
		},
	}
	out := make([]AmountResolverInfo, 0, len(base))
	for _, info := range base {
		if spec, ok := specs[info.Name]; ok {
			// Preserve registry description when spec does not override.
			if spec.Description == "" {
				spec.Description = info.Description
			}
			out = append(out, spec)
			continue
		}
		// Plugin resolvers: surface name and description; the frontend
		// renders a generic entry for unknown names.
		out = append(out, info)
	}
	sort.Slice(out, func(i, j int) bool { return out[i].Name < out[j].Name })
	return out
}

// ProviderSpecs returns wiring for every amount provider.
func ListAmountProviderSpecs() []AmountProviderInfo {
	base := ListAmountProviders()
	specs := map[string]AmountProviderInfo{
		"model-value": {
			Name: "model-value",
			ArgFields: []AmountFieldSpec{
				{Key: "id", Kind: "posting-or-account", Required: true},
			},
		},
		"account-balance": {
			Name: "account-balance",
			ArgFields: []AmountFieldSpec{
				{Key: "id", Kind: "account", Required: true},
			},
		},
		"occurrence-rate": {
			Name:     "occurrence-rate",
			Volatile: true,
			ArgFields: []AmountFieldSpec{
				{Key: "annualRate", Kind: "rate", Required: true},
				{Key: "volatility", Kind: "volatility", Required: false},
			},
		},
		"growth-factor": {
			Name: "growth-factor",
			ArgFields: []AmountFieldSpec{
				{Key: "annualGrowthRate", Kind: "rate", Required: true},
			},
		},
		"terms-minimum": {
			Name: "terms-minimum",
			ArgFields: []AmountFieldSpec{
				{Key: "id", Kind: "account", Required: true},
			},
		},
		"late-fee": {
			Name: "late-fee",
			ArgFields: []AmountFieldSpec{
				{Key: "payment", Kind: "posting", Required: true},
				{Key: "account", Kind: "account", Required: true},
				{Key: "fee", Kind: "money", Required: true},
			},
		},
		"balance-fee": {
			Name: "balance-fee",
			ArgFields: []AmountFieldSpec{
				{Key: "account", Kind: "account", Required: true},
				{Key: "threshold", Kind: "money", Required: true},
				{Key: "fee", Kind: "money", Required: true},
			},
		},
	}
	out := make([]AmountProviderInfo, 0, len(base))
	for _, info := range base {
		if spec, ok := specs[info.Name]; ok {
			if spec.Description == "" {
				spec.Description = info.Description
			}
			out = append(out, spec)
			continue
		}
		out = append(out, info)
	}
	sort.Slice(out, func(i, j int) bool { return out[i].Name < out[j].Name })
	return out
}
