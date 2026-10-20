package domain

import (
	"testing"

	"github.com/simhozebs/net-worth-estimator/backend/internal/types"
)

func bracketTestConfig() map[string]types.JsonValue {
	return map[string]types.JsonValue{
		"deduction": 1000.0,
		"brackets": []any{
			map[string]any{"upTo": 5000.0, "rate": 0.10},
			map[string]any{"upTo": nil, "rate": 0.20},
		},
	}
}

func bracketTestAmount() types.PostingAmountResolution {
	return types.PostingAmountResolution{
		Resolver: "progressive-bracket",
		Config:   bracketTestConfig(),
		Inputs: map[string]types.AmountInputBinding{
			"gross":  {Source: "literal", Value: 10000.0},
			"pretax": {Source: "literal", Value: 1000.0},
		},
	}
}

func TestProgressiveBracketResolverIsRegistered(t *testing.T) {
	def, ok := LookupAmountResolver("progressive-bracket")
	if !ok {
		t.Fatal("progressive-bracket missing from resolver registry")
	}
	inputs, err := def.requiredInputs(bracketTestConfig())
	if err != nil {
		t.Fatalf("required inputs: %v", err)
	}
	if len(inputs) != 2 || inputs[0] != "gross" || inputs[1] != "pretax" {
		t.Fatalf("required inputs = %v, want [gross pretax]", inputs)
	}
	found := false
	for _, info := range ListAmountResolvers() {
		if info.Name == "progressive-bracket" {
			found = true
		}
	}
	if !found {
		t.Fatal("progressive-bracket missing from ListAmountResolvers")
	}
}

func TestProgressiveBracketConfigValidation(t *testing.T) {
	for name, config := range map[string]map[string]types.JsonValue{
		"missing brackets": {},
		"empty brackets":   {"brackets": []any{}},
		"bad rate": {
			"brackets": []any{map[string]any{"upTo": 5000.0, "rate": 1.5}},
		},
		"negative deduction": {
			"deduction": -100.0,
			"brackets":  []any{map[string]any{"upTo": 5000.0, "rate": 0.1}},
		},
	} {
		if _, err := ValidateAmountDescriptor(types.PostingAmountResolution{
			Resolver: "progressive-bracket",
			Config:   config,
			Inputs: map[string]types.AmountInputBinding{
				"gross":  {Source: "literal", Value: 10000.0},
				"pretax": {Source: "literal", Value: 0.0},
			},
		}, &AmountReferenceContext{}); err == nil {
			t.Fatalf("%s: expected validation error", name)
		}
	}
}

func TestProgressiveBracketResolvesLiability(t *testing.T) {
	// Taxable = 10000 - 1000 - 1000 = 8000 → 5000*0.10 + 3000*0.20 = 1100.
	value, err := ResolvePostingAmountDescriptor(bracketTestAmount(), &AmountProviderContext{})
	if err != nil {
		t.Fatalf("resolve: %v", err)
	}
	if value != 1100 {
		t.Fatalf("liability = %v, want 1100", value)
	}
}

func TestProgressiveBracketComposesWithModelValue(t *testing.T) {
	// The chaining a paycheck decomposition needs: inputs read earlier
	// same-day rule realizations through the generic model-value provider.
	amount := types.PostingAmountResolution{
		Resolver: "progressive-bracket",
		Config:   bracketTestConfig(),
		Inputs: map[string]types.AmountInputBinding{
			"gross":  {Source: "provider", Provider: "model-value", Arguments: map[string]any{"id": "gross-rule"}},
			"pretax": {Source: "provider", Provider: "model-value", Arguments: map[string]any{"id": "contrib-rule"}},
		},
	}
	refs := &AmountReferenceContext{
		AccountIDs: map[string]bool{"checking": true},
		PostingIDs: map[string]bool{"gross-rule": true, "contrib-rule": true, "tax-rule": true},
	}
	deps, err := ValidateAmountDescriptor(amount, refs)
	if err != nil {
		t.Fatalf("validate chained amount: %v", err)
	}
	if len(deps) != 2 {
		t.Fatalf("dependencies = %v, want both referenced rules", deps)
	}
	value, err := ResolvePostingAmountDescriptor(amount, &AmountProviderContext{
		LatestRealizedPostingAmounts: map[string]float64{"gross-rule": 10000, "contrib-rule": 1000},
	})
	if err != nil {
		t.Fatalf("resolve chained amount: %v", err)
	}
	if value != 1100 {
		t.Fatalf("chained liability = %v, want 1100", value)
	}
}

func TestProgressiveBracketRejectsExtraInputs(t *testing.T) {
	amount := bracketTestAmount()
	amount.Inputs["extra"] = types.AmountInputBinding{Source: "literal", Value: 1.0}
	if _, err := ValidateAmountDescriptor(amount, &AmountReferenceContext{}); err == nil {
		t.Fatal("expected exact-inputs violation for extra input")
	}
}
