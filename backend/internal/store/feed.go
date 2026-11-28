// Shared feed amount semantics (GRP-03). This pure helper owns the
// fixed-amount contract every feed consumer shares: the feed totals and
// the record lists agree on which stored amounts count as fixed figures
// and which stay calculated recipes outside summed totals.
package store

import (
	"math"

	"github.com/simhozebs/net-worth-estimator/backend/internal/domain"
	"github.com/simhozebs/net-worth-estimator/backend/internal/types"
)

func parseFeedNumeric(text string) (float64, bool) {
	amount, err := domain.ParseNumericAmount(text)
	if err != nil {
		return 0, false
	}
	return amount.Value, true
}

func feedNumber(raw any) (float64, bool) {
	switch value := raw.(type) {
	case float64:
		if math.IsNaN(value) || math.IsInf(value, 0) {
			return 0, false
		}
		return value, true
	case float32:
		mapped := float64(value)
		if math.IsNaN(mapped) || math.IsInf(mapped, 0) {
			return 0, false
		}
		return mapped, true
	case int:
		return float64(value), true
	case int64:
		return float64(value), true
	default:
		return 0, false
	}
}

// FeedLiteralAmount extracts the fixed figure from a stored amount
// descriptor, mirroring the record lists: a numeric expression recipe or a
// numeric configured value counts; calculated recipes report varying and
// stay out of summed totals.
func FeedLiteralAmount(amount types.TransactionAmountResolution) (float64, bool) {
	if amount.Config == nil {
		return 0, false
	}
	if expression, ok := amount.Config["expression"]; ok {
		if text, ok := expression.(string); ok {
			if value, ok := parseFeedNumeric(text); ok {
				return value, true
			}
		}
	}
	for _, key := range []string{"value", "amount"} {
		if raw, ok := amount.Config[key]; ok {
			if value, ok := feedNumber(raw); ok {
				return value, true
			}
		}
	}
	return 0, false
}
