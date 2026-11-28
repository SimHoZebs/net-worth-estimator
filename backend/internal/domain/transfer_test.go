package domain

import (
	"testing"
	"time"

	"github.com/simhozebs/net-worth-estimator/backend/internal/types"
)

func TestTransferLegPairSharesAllBoundaryRules(t *testing.T) {
	base := TransferLegFacts{AccountID: "checking", Currency: "USD", Cents: 10000, Day: 100, Outflow: true, Settled: true}
	inflow := base
	inflow.AccountID, inflow.Outflow = "savings", false
	if got := CheckTransferLegPair(base, inflow); got != TransferMatchOK {
		t.Fatalf("opposite legs rejected: %v", got)
	}
	inflow.Day += TransferMatchWindowDays
	if got := CheckTransferLegPair(base, inflow); got != TransferMatchOK {
		t.Fatalf("window boundary rejected: %v", got)
	}
	inflow.Day++
	if got := CheckTransferLegPair(base, inflow); got != TransferMatchWindow {
		t.Fatalf("eight-day gap problem = %v, want window", got)
	}

	for _, tc := range []struct {
		name   string
		mutate func(*TransferLegFacts)
		want   TransferMatchProblem
	}{
		{name: "same account", mutate: func(leg *TransferLegFacts) { leg.AccountID = base.AccountID }, want: TransferMatchAccount},
		{name: "pending", mutate: func(leg *TransferLegFacts) { leg.Settled = false }, want: TransferMatchUnsettled},
		{name: "foreign currency", mutate: func(leg *TransferLegFacts) { leg.Currency = "EUR" }, want: TransferMatchCurrency},
		{name: "cent mismatch", mutate: func(leg *TransferLegFacts) { leg.Cents++ }, want: TransferMatchCents},
		{name: "same direction", mutate: func(leg *TransferLegFacts) { leg.Outflow = true }, want: TransferMatchDirection},
	} {
		t.Run(tc.name, func(t *testing.T) {
			candidate := base
			candidate.AccountID, candidate.Outflow, candidate.Day = "savings", false, base.Day
			tc.mutate(&candidate)
			if got := CheckTransferLegPair(base, candidate); got != tc.want {
				t.Fatalf("problem = %v, want %v", got, tc.want)
			}
		})
	}
}

func TestTransferLegKeyReusesNormalizedNumericAmount(t *testing.T) {
	stamp := time.Date(2026, time.March, 10, 12, 0, 0, 0, time.UTC).Unix()
	key, ok := TransferLegKey(types.TransactionFacts{Amount: " +001.20 ", Currency: "USD", PostedTime: stamp})
	if !ok || key.Cents != 120 || key.Day != stamp/86400 || key.Outflow {
		t.Fatalf("key = %+v, ok=%v", key, ok)
	}
}

func TestNettableTransferLinkSharesRouteAndRoundedAmountRules(t *testing.T) {
	checking, savings := "checking", "savings"
	outflow := &types.Transaction{ID: "out", SourceAccountID: &checking}
	inflow := &types.Transaction{ID: "in", Destinations: []string{savings}}
	for _, pair := range [][2]*types.Transaction{{outflow, inflow}, {inflow, outflow}} {
		out, in, amount, ok := NettableTransferLink(pair[0], pair[1], 500.4, 500.4)
		if !ok || out != outflow || in != inflow || amount != 500 {
			t.Fatalf("nettable pair = %+v %+v %v %v", out, in, amount, ok)
		}
	}
	if _, _, _, ok := NettableTransferLink(outflow, inflow, 500.4, 500.6); ok {
		t.Fatal("different rounded amounts netted")
	}
	sameRoute := &types.Transaction{ID: "other-out", SourceAccountID: &savings}
	if _, _, _, ok := NettableTransferLink(outflow, sameRoute, 500, 500); ok {
		t.Fatal("same-route pair netted")
	}
}
