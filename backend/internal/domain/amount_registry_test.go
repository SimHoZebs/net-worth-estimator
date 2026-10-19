package domain

import (
	"testing"

	"github.com/simhozebs/net-worth-estimator/backend/internal/types"
)

// Plugins extend amounts without touching Validate/Resolve: a resolver plus
// a provider registered here resolve through the generic path.

func TestCustomResolverAndProviderPlugin(t *testing.T) {
	RegisterAmountResolver("test-double", "Test resolver doubling one input.", resolverDefinition{
		requiredInputs: func(config map[string]types.JsonValue) ([]string, error) {
			return []string{"x"}, nil
		},
		resolve: func(config map[string]types.JsonValue, inputs map[string]float64) (float64, error) {
			return inputs["x"] * 2, nil
		},
	})
	RegisterAmountProvider("test-const", "Test provider returning a constant.", providerDefinition{
		resolve: func(args map[string]types.JsonValue, ctx *AmountProviderContext) (float64, error) {
			return 21, nil
		},
	})

	amount := types.PostingAmountResolution{
		Resolver: "test-double",
		Config:   map[string]types.JsonValue{},
		Inputs: map[string]types.AmountInputBinding{
			"x": {Source: "provider", Provider: "test-const", Arguments: map[string]any{}},
		},
	}
	if _, err := ValidateAmountDescriptor(amount, &AmountReferenceContext{}); err != nil {
		t.Fatalf("validate plugin amount: %v", err)
	}
	value, err := ResolvePostingAmountDescriptor(amount, &AmountProviderContext{})
	if err != nil {
		t.Fatalf("resolve plugin amount: %v", err)
	}
	if value != 42 {
		t.Fatalf("plugin value = %v, want 42", value)
	}

	found := false
	for _, info := range ListAmountResolvers() {
		if info.Name == "test-double" {
			found = true
		}
	}
	if !found {
		t.Fatalf("test-double missing from ListAmountResolvers")
	}
	found = false
	for _, info := range ListAmountProviders() {
		if info.Name == "test-const" {
			found = true
		}
	}
	if !found {
		t.Fatalf("test-const missing from ListAmountProviders")
	}

	mustPanic := func(fn func()) {
		defer func() {
			if recover() == nil {
				t.Fatalf("expected panic for duplicate registration")
			}
		}()
		fn()
	}
	mustPanic(func() {
		RegisterAmountResolver("test-double", "dup", resolverDefinition{
			requiredInputs: func(map[string]types.JsonValue) ([]string, error) { return nil, nil },
			resolve:        func(map[string]types.JsonValue, map[string]float64) (float64, error) { return 0, nil },
		})
	})
	mustPanic(func() {
		RegisterAmountProvider("test-const", "dup", providerDefinition{
			resolve: func(map[string]types.JsonValue, *AmountProviderContext) (float64, error) { return 0, nil },
		})
	})
}

func TestVolatileHookIsGeneric(t *testing.T) {
	RegisterAmountProvider("test-volatile", "Test volatile provider.", providerDefinition{
		resolve: func(args map[string]types.JsonValue, ctx *AmountProviderContext) (float64, error) {
			return 1, nil
		},
		volatileParams: func(args map[string]types.JsonValue) (float64, float64, bool) {
			return 0.1, 0.2, true
		},
	})
	amount := types.PostingAmountResolution{
		Resolver: "expression",
		Config:   map[string]types.JsonValue{"expression": "v"},
		Inputs: map[string]types.AmountInputBinding{
			"v": {Source: "provider", Provider: "test-volatile", Arguments: map[string]any{}},
		},
	}
	params, found := VolatileRateInputOf(amount)
	if !found || params.Provider != "test-volatile" {
		t.Fatalf("generic volatile discovery failed: %+v %v", params, found)
	}
	if CountVolatileRateInputs(amount) != 1 {
		t.Fatalf("volatile count != 1")
	}
}
