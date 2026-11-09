package analysis

import (
	"context"
	"fmt"
	"testing"

	"github.com/simhozebs/net-worth-estimator/backend/internal/types"
)

// Cancel at a deterministic checkpoint inside the matching phase rather than
// racing a timer against the machine's current speed.
type checkpointContext struct {
	context.Context
	checks, cancelAt int
}

func (c *checkpointContext) Err() error {
	c.checks++
	if c.checks >= c.cancelAt {
		return context.Canceled
	}
	return nil
}

func TestIncomeTransferMatchingChecksCancellationInsideBuckets(t *testing.T) {
	var items []types.AnalysisTransaction
	for i := 0; i < 100; i++ {
		items = append(items, types.AnalysisTransaction{TransactionID: fmt.Sprint(i), AccountID: "in", Facts: types.TransactionFacts{Amount: "100", Currency: "USD", OccurredAt: 1767398400}})
	}
	items = append(items, types.AnalysisTransaction{TransactionID: "out", AccountID: "out", Facts: types.TransactionFacts{Amount: "-100", Currency: "USD", OccurredAt: 1767398400}})
	ctx := &checkpointContext{Context: context.Background(), cancelAt: 110}
	if _, err := incomeTransferIDs(ctx, items); err != context.Canceled {
		t.Fatalf("cancellation=%v checks=%d", err, ctx.checks)
	}
}
