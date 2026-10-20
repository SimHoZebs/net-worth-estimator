package domain

import "testing"

// The backend carries only wiring: names, field keys, kinds, and required
// flags. Human words live in the frontend.

func fieldKeys(fields []AmountFieldSpec) map[string]AmountFieldSpec {
	out := make(map[string]AmountFieldSpec, len(fields))
	for _, field := range fields {
		out[field.Key] = field
	}
	return out
}

func TestListAmountSpecsAreMinimalWiring(t *testing.T) {
	resolvers := ListAmountResolverSpecs()
	byName := map[string]AmountResolverInfo{}
	for _, r := range resolvers {
		byName[r.Name] = r
	}
	expression, ok := byName["expression"]
	if !ok {
		t.Fatalf("missing resolver spec expression")
	}
	fields := fieldKeys(expression.ConfigFields)
	field, ok := fields["expression"]
	if !ok || !field.Required || field.Kind != "expression" {
		t.Fatalf("expression resolver wiring = %+v, want required expression field", expression.ConfigFields)
	}
	bracket, ok := byName["progressive-bracket"]
	if !ok {
		t.Fatalf("missing resolver spec progressive-bracket")
	}
	bracketFields := fieldKeys(bracket.ConfigFields)
	if _, ok := bracketFields["brackets"]; !ok {
		t.Fatalf("progressive-bracket resolver wiring = %+v, want brackets field", bracket.ConfigFields)
	}

	providers := ListAmountProviderSpecs()
	if len(providers) < 7 {
		t.Fatalf("providers = %d, want at least 7", len(providers))
	}
	byProvider := map[string]AmountProviderInfo{}
	for _, p := range providers {
		byProvider[p.Name] = p
	}
	rate, ok := byProvider["occurrence-rate"]
	if !ok {
		t.Fatalf("missing provider occurrence-rate")
	}
	if !rate.Volatile {
		t.Fatalf("occurrence-rate must report volatile wiring")
	}
	rateFields := fieldKeys(rate.ArgFields)
	if field, ok := rateFields["annualRate"]; !ok || !field.Required {
		t.Fatalf("occurrence-rate wiring = %+v, want required annualRate", rate.ArgFields)
	}
	if field, ok := rateFields["volatility"]; !ok || field.Required {
		t.Fatalf("occurrence-rate wiring = %+v, want optional volatility", rate.ArgFields)
	}
	for _, name := range []string{"model-value", "account-balance", "growth-factor", "terms-minimum", "late-fee", "balance-fee"} {
		provider, ok := byProvider[name]
		if !ok {
			t.Fatalf("missing provider %s", name)
		}
		if len(provider.ArgFields) == 0 {
			t.Fatalf("provider %s has no arg wiring", name)
		}
	}

}
