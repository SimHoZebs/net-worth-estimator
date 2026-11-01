package store

import (
	"testing"

	"github.com/simhozebs/net-worth-estimator/backend/internal/types"
)

// Literal detection mirrors the record lists: numeric expressions and
// numeric configured values count; calculated recipes stay varying.
func TestFeedLiteralAmount(t *testing.T) {
	expression := func(config map[string]any) types.PostingAmountResolution {
		return types.PostingAmountResolution{Resolver: "expression", Config: config, Inputs: map[string]types.AmountInputBinding{}}
	}
	cases := []struct {
		name   string
		amount types.PostingAmountResolution
		value  float64
		fixed  bool
	}{
		{"numeric expression", expression(map[string]any{"expression": "10.5"}), 10.5, true},
		{"padded expression", expression(map[string]any{"expression": "  42 "}), 42, true},
		{"negative exponent", expression(map[string]any{"expression": "-1.5e3"}), -1500, true},
		{"formula", expression(map[string]any{"expression": "balance * 2"}), 0, false},
		{"empty expression", expression(map[string]any{"expression": ""}), 0, false},
		{"value number", expression(map[string]any{"value": 7.25}), 7.25, true},
		{"amount number", expression(map[string]any{"amount": 3.0}), 3, true},
		{"infinite value", expression(map[string]any{"value": "x"}), 0, false},
		{"no config", expression(nil), 0, false},
	}
	for _, tc := range cases {
		t.Run(tc.name, func(t *testing.T) {
			value, fixed := FeedLiteralAmount(tc.amount)
			if fixed != tc.fixed || (fixed && value != tc.value) {
				t.Fatalf("literal = (%v, %v), want (%v, %v)", value, fixed, tc.value, tc.fixed)
			}
		})
	}
}
