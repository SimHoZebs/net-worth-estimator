package safespending

import (
	"slices"
	"testing"

	"github.com/simhozebs/net-worth-estimator/backend/internal/types"
)

func TestEffectiveAccountsPreservesConfigureScope(t *testing.T) {
	m := baseModel()
	m.Accounts = append(m.Accounts,
		types.Account{ID: "savings", Kind: "cash", Enabled: true},
		types.Account{ID: "card-kind-cash", Kind: "cash", Enabled: true},
		types.Account{ID: "investment", Kind: "investment", Enabled: true},
		types.Account{ID: "debt", Kind: "debt", Enabled: true},
	)
	for _, stored := range [][]string{nil, {}, {"deleted"}} {
		s := Build(m, &types.SafeSpendingSettings{SpendingAccountIDs: stored}, "2026-11-15", testEnd)
		if !slices.Equal(s.SelectedAccountIDs, []string{"checking"}) {
			t.Fatalf("stored %v selected %v", stored, s.SelectedAccountIDs)
		}
		assertMoney(t, s.CheckingAvailable, 1244.43)
	}
	for _, tc := range []struct{ stored, want []string }{
		{[]string{"savings", "checking"}, []string{"savings", "checking"}},
		{[]string{"deleted", "investment"}, []string{"investment"}},
		{[]string{"debt"}, []string{"checking"}},
		{[]string{"savings", "savings"}, []string{"savings"}},
	} {
		s := Build(m, &types.SafeSpendingSettings{SpendingAccountIDs: tc.stored}, "2026-11-15", testEnd)
		if !slices.Equal(s.SelectedAccountIDs, tc.want) {
			t.Fatalf("stored %v selected %v want %v", tc.stored, s.SelectedAccountIDs, tc.want)
		}
		if slices.Contains(tc.want, "investment") && s.CashAfterBills != nil {
			t.Fatal("selected investment without available evidence used as cash")
		}
	}
}

func TestCheckingFallbackLiteralThenEnabledThenAnyCash(t *testing.T) {
	m := baseModel()
	m.Accounts = []types.Account{{ID: "disabled", Kind: "cash"}, {ID: "enabled", Kind: "cash", Enabled: true}, {ID: "checking", Kind: "cash"}}
	for _, want := range []string{"checking", "enabled", "disabled"} {
		s := Build(m, nil, "2026-11-15", testEnd)
		if !slices.Equal(s.SelectedAccountIDs, []string{want}) {
			t.Fatalf("selected %v want %s", s.SelectedAccountIDs, want)
		}
		m.Accounts = m.Accounts[:len(m.Accounts)-1]
	}
	m.Accounts = nil
	s := Build(m, nil, "2026-11-15", testEnd)
	if len(s.SelectedAccountIDs) != 0 || s.CashAfterBills != nil || s.Status != "missing" {
		t.Fatalf("no cash %+v", s)
	}
}
