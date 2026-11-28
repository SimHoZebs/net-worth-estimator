package domain

import (
	"fmt"
	"math"
	"regexp"
	"strconv"
	"strings"
)

var numericAmountPattern = regexp.MustCompile(`^[+-]?(?:[0-9]+(?:\.[0-9]*)?|\.[0-9]+)(?:[eE][+-]?[0-9]+)?$`)

// NumericAmount is a finite numeric amount and its arithmetic-compatible
// decimal spelling.
type NumericAmount struct {
	Value   float64
	Literal string
}

// ParseNumericAmount accepts finite decimal and exponent spellings. Literal
// preserves an already-valid decimal spelling after trimming. Leading plus,
// leading-dot, and exponent forms normalize to decimal text the arithmetic
// expression evaluator accepts.
func ParseNumericAmount(raw string) (NumericAmount, error) {
	text := strings.TrimSpace(raw)
	if !numericAmountPattern.MatchString(text) {
		return NumericAmount{}, fmt.Errorf("invalid numeric amount %q", raw)
	}
	value, err := strconv.ParseFloat(text, 64)
	if err != nil {
		return NumericAmount{}, fmt.Errorf("invalid numeric amount %q: %w", raw, err)
	}
	if math.IsNaN(value) || math.IsInf(value, 0) {
		return NumericAmount{}, fmt.Errorf("numeric amount %q must be finite", raw)
	}

	unsigned := strings.TrimPrefix(text, "+")
	sign := ""
	if strings.HasPrefix(unsigned, "-") {
		sign = "-"
		unsigned = strings.TrimPrefix(unsigned, "-")
	}
	literal := sign + unsigned
	if strings.ContainsAny(unsigned, "eE") {
		literal = strconv.FormatFloat(value, 'f', -1, 64)
	} else if strings.HasPrefix(unsigned, ".") {
		literal = sign + "0" + unsigned
	}
	return NumericAmount{Value: value, Literal: literal}, nil
}
