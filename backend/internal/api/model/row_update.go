package model

import (
	"bytes"
	"encoding/json"
	"fmt"
	"math"
	"reflect"
	"strconv"

	"github.com/danielgtaylor/huma/v2"
	"github.com/simhozebs/net-worth-estimator/backend/internal/types"
)

// optional carries one member of a row update: absent leaves the stored value
// untouched, present replaces it. The generic wrapper exists only to remember
// presence; its wire schema is the member's own schema.
type optional[T any] struct {
	Set   bool
	Null  bool
	Value T
}

func (o *optional[T]) UnmarshalJSON(data []byte) error {
	o.Set = true
	if bytes.Equal(bytes.TrimSpace(data), []byte("null")) {
		o.Null = true
		var zero T
		o.Value = zero
		return nil
	}
	return json.Unmarshal(data, &o.Value)
}

func (o optional[T]) Schema(r huma.Registry) *huma.Schema {
	return huma.SchemaFromType(r, reflect.TypeFor[T]())
}

// nullableOptional is an update member whose null value clears the stored
// field. Its schema accepts null in addition to the member type. Object
// members are inlined because the OpenAPI generator cannot attach null to a
// component reference.
type nullableOptional[T any] struct {
	optional[T]
}

func (o nullableOptional[T]) Schema(r huma.Registry) *huma.Schema {
	s := huma.SchemaFromType(r, reflect.TypeFor[T]())
	if s.Ref != "" {
		target := r.SchemaFromRef(s.Ref)
		clone := *target
		clone.Ref = ""
		s = &clone
	}
	s.Nullable = true
	return s
}

// amountInput authors an amount as a literal with optional yearly growth, or
// replays a stored resolution descriptor verbatim during model import. The
// editor never builds resolver input, so the simple form is the documented
// path; the descriptor form keeps imports byte-faithful.
type amountInput struct {
	Value          *float64
	AnnualIncrease *float64
	Resolution     *types.TransactionAmountResolution
}

func (a *amountInput) UnmarshalJSON(data []byte) error {
	var probe struct {
		Value          *float64 `json:"value"`
		AnnualIncrease *float64 `json:"annualIncrease"`
		Resolver       *string  `json:"resolver"`
	}
	if err := json.Unmarshal(data, &probe); err != nil {
		return err
	}
	switch {
	case probe.Resolver != nil:
		var resolution types.TransactionAmountResolution
		if err := json.Unmarshal(data, &resolution); err != nil {
			return err
		}
		a.Resolution = &resolution
	case probe.Value != nil:
		a.Value = probe.Value
		a.AnnualIncrease = probe.AnnualIncrease
	default:
		return fmt.Errorf("amount must state a value or a resolver")
	}
	return nil
}

func (a amountInput) Schema(r huma.Registry) *huma.Schema {
	annualIncrease := -50.0
	maxIncrease := 50.0
	minValue := 0.0
	maxValue := 1e10
	return &huma.Schema{
		Description: "Literal amount with optional yearly growth, or a stored resolution descriptor.",
		AnyOf: []*huma.Schema{
			{
				Type:     huma.TypeObject,
				Required: []string{"value"},
				Properties: map[string]*huma.Schema{
					"value": {
						Type:        huma.TypeNumber,
						Minimum:     &minValue,
						Maximum:     &maxValue,
						Description: "Amount in the row currency.",
					},
					"annualIncrease": {
						Type:        huma.TypeNumber,
						Minimum:     &annualIncrease,
						Maximum:     &maxIncrease,
						Description: "Yearly growth percent applied to the amount.",
					},
				},
			},
			huma.SchemaFromType(r, reflect.TypeFor[types.TransactionAmountResolution]()),
		},
	}
}

// resolution renders the authored amount as the stored descriptor. A literal
// with growth compiles to the same expression and growth provider the editor
// used to build by hand.
func (a amountInput) resolution() (types.TransactionAmountResolution, error) {
	return a.resolutionAllowingGrowth(true)
}

// literalResolution renders an amount for a one-time transaction: growth is not
// meaningful there, so a nonzero increase is rejected instead of stored.
func (a amountInput) literalResolution() (types.TransactionAmountResolution, error) {
	return a.resolutionAllowingGrowth(false)
}

func (a amountInput) resolutionAllowingGrowth(allowGrowth bool) (types.TransactionAmountResolution, error) {
	if a.Resolution != nil {
		return *a.Resolution, nil
	}
	if a.Value == nil {
		return types.TransactionAmountResolution{}, fmt.Errorf("amount must state a value or a resolver")
	}
	value := *a.Value
	if math.IsNaN(value) || math.IsInf(value, 0) || value < 0 || value > 1e10 {
		return types.TransactionAmountResolution{}, fmt.Errorf("amount must be between 0 and 10000000000")
	}
	expression := strconv.FormatFloat(value, 'f', -1, 64)
	rate := 0.0
	if a.AnnualIncrease != nil {
		rate = *a.AnnualIncrease
	}
	if math.IsNaN(rate) || math.IsInf(rate, 0) || rate < -50 || rate > 50 {
		return types.TransactionAmountResolution{}, fmt.Errorf("annual increase must be between -50 and 50 percent")
	}
	if !allowGrowth && rate != 0 {
		return types.TransactionAmountResolution{}, fmt.Errorf("one-time transactions carry no yearly increase")
	}
	if rate == 0 {
		return types.TransactionAmountResolution{
			Resolver: "expression",
			Config:   map[string]any{"expression": expression},
			Inputs:   map[string]types.AmountInputBinding{},
		}, nil
	}
	return types.TransactionAmountResolution{
		Resolver: "expression",
		Config:   map[string]any{"expression": "(" + expression + ") * growth"},
		Inputs: map[string]types.AmountInputBinding{
			"growth": {
				Source:    "provider",
				Provider:  "growth-factor",
				Arguments: map[string]any{"annualGrowthRate": rate / 100},
			},
		},
	}, nil
}
