package domain_test

import (
	"math"
	"testing"

	"github.com/simhozebs/net-worth-estimator/backend/internal/domain"
)

func TestParseNumericAmountPreservesAndNormalizesLiterals(t *testing.T) {
	for _, tc := range []struct {
		raw     string
		value   float64
		literal string
	}{
		{raw: "42.10", value: 42.1, literal: "42.10"},
		{raw: "001.2300", value: 1.23, literal: "001.2300"},
		{raw: "1.", value: 1, literal: "1."},
		{raw: " -001.20 ", value: -1.2, literal: "-001.20"},
		{raw: "+001.20", value: 1.2, literal: "001.20"},
		{raw: ".5", value: 0.5, literal: "0.5"},
		{raw: "-.5", value: -0.5, literal: "-0.5"},
		{raw: "1e3", value: 1000, literal: "1000"},
		{raw: "1E+3", value: 1000, literal: "1000"},
		{raw: "-1.5e-3", value: -0.0015, literal: "-0.0015"},
		{raw: " 42 ", value: 42, literal: "42"},
	} {
		t.Run(tc.raw, func(t *testing.T) {
			amount, err := domain.ParseNumericAmount(tc.raw)
			if err != nil {
				t.Fatal(err)
			}
			if amount.Value != tc.value || amount.Literal != tc.literal {
				t.Fatalf("amount = %+v, want value %v literal %q", amount, tc.value, tc.literal)
			}
			evaluated, err := domain.EvaluateArithmetic(amount.Literal, nil)
			if err != nil || math.Abs(evaluated-tc.value) > 1e-12 {
				t.Fatalf("evaluated = %v, err %v, want %v", evaluated, err, tc.value)
			}
		})
	}
}

func TestParseNumericAmountRejectsInvalidAndNonFiniteValues(t *testing.T) {
	for _, raw := range []string{"", "n/a", "NaN", "+Inf", "-Inf", "1e999", "0x1p2", "1_000", "1 2", ".", "--1"} {
		t.Run(raw, func(t *testing.T) {
			if amount, err := domain.ParseNumericAmount(raw); err == nil {
				t.Fatalf("amount = %+v, want rejection", amount)
			}
		})
	}
}
