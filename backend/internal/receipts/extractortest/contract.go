// Package extractortest provides the shared conformance gate for source adapters.
package extractortest

import (
	"context"
	"errors"
	"math"
	"testing"

	"github.com/simhozebs/net-worth-estimator/backend/internal/receipts"
	"github.com/simhozebs/net-worth-estimator/backend/internal/types"
)

// Run exercises the consumer-owned result and cancellation contracts. Adapter
// tests additionally cover translation of their source-specific error cases.
func Run(t *testing.T, adapter receipts.ReceiptExtractor, input receipts.ExtractionInput) {
	t.Helper()
	t.Run("normalized-result", func(t *testing.T) {
		result, err := adapter.Extract(context.Background(), input)
		if err != nil {
			t.Fatal(err)
		}
		if err := types.ValidateReceiptDetails(result.Details); err != nil {
			t.Fatal(err)
		}
		if result.Confidence != nil && (math.IsNaN(*result.Confidence) || *result.Confidence < 0 || *result.Confidence > 1) {
			t.Fatal("invalid confidence")
		}
	})
	t.Run("cancellation", func(t *testing.T) {
		ctx, cancel := context.WithCancel(context.Background())
		cancel()
		_, err := adapter.Extract(ctx, input)
		var failure *receipts.Error
		if !errors.Is(err, context.Canceled) && !(errors.As(err, &failure) && failure.Code == "canceled") {
			t.Fatalf("cancellation = %v", err)
		}
	})
}
