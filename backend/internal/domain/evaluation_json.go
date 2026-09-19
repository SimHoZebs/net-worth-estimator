package domain

import (
	"math"
	"sort"

	"github.com/simhozebs/net-worth-estimator/backend/internal/types"
)

// Shared JSON and numeric shaping helpers for evaluation results. Go is the
// owner of these helpers.

type constraintCount struct {
	Type  string
	Count int
}

func constraintsToJSON(counts []constraintCount) []types.JsonValue {
	out := make([]types.JsonValue, len(counts))
	for i, c := range counts {
		out[i] = map[string]any{"type": c.Type, "count": c.Count}
	}
	return out
}

func roundCents(amount float64) float64 {
	return math.Round(amount*100) / 100
}

func uniqueSortedStrings(values []string) []string {
	seen := map[string]bool{}
	out := []string{}
	for _, value := range values {
		if !seen[value] {
			seen[value] = true
			out = append(out, value)
		}
	}
	return out
}

func medianValue(values []float64) float64 {
	if len(values) == 0 {
		return 0
	}
	sorted := make([]float64, len(values))
	copy(sorted, values)
	sort.Float64s(sorted)
	middle := len(sorted) / 2
	if len(sorted)%2 == 0 {
		return (sorted[middle-1] + sorted[middle]) / 2
	}
	return sorted[middle]
}
