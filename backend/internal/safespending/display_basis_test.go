package safespending

import (
	"slices"
	"testing"

	"github.com/simhozebs/net-worth-estimator/backend/internal/types"
)

// The owner-facing basis at a cash checkpoint follows the account's display
// preference, with a reported available figure needed for available to mean
// anything. The observed figure of the other basis stays on the baseline for
// reconciliation even when it is not the figure that funds the forecast.
func TestCashCheckpointFollowsEffectiveDisplayBasis(t *testing.T) {
	t.Run("posted preference with both figures", func(t *testing.T) {
		m := baseModel()
		m.Accounts[0].DisplayBasis = types.DisplayBasisPosted
		s := Build(m, nil, "2026-11-15", testEnd)
		if s.Status != "available" || len(s.Reasons) != 0 {
			t.Fatalf("posted preference status %q reasons %v", s.Status, s.Reasons)
		}
		if len(s.Baselines) != 1 {
			t.Fatalf("baselines %+v", s.Baselines)
		}
		b := s.Baselines[0]
		if b.Basis != "posted" || b.Status != "available" {
			t.Fatalf("posted preference basis %+v", b)
		}
		assertMoney(t, b.PostedBalance, 1608.05)
		assertMoney(t, b.AvailableBalance, 1244.43)
		assertMoney(t, s.CheckingAvailable, 1608.05)
		assertMoney(t, s.CashAfterBills, 1608.05)

		// Explicit posted uses the replayed posted figure, so a confirmed
		// movement after the checkpoint moves cash without changing the
		// observed evidence row.
		income := payment("confirmed-income", 100, "2026-11-15T10:00:00Z")
		income.SourceAccountID = nil
		income.Destinations = []string{"checking"}
		m.Transactions = []types.Transaction{income}
		s = Build(m, nil, "2026-11-15", testEnd)
		assertMoney(t, s.CheckingAvailable, 1708.05)
		assertMoney(t, s.Baselines[0].PostedBalance, 1608.05)
		assertMoney(t, s.Baselines[0].AvailableBalance, 1244.43)
	})

	t.Run("available preference and configured default", func(t *testing.T) {
		for _, basis := range []types.DisplayBasis{"", types.DisplayBasisAvailable} {
			m := baseModel()
			m.Accounts[0].DisplayBasis = basis
			s := Build(m, nil, "2026-11-15", testEnd)
			if s.Baselines[0].Basis != "available" {
				t.Fatalf("basis %q produced %+v", basis, s.Baselines)
			}
			assertMoney(t, s.Baselines[0].AvailableBalance, 1244.43)
			assertMoney(t, s.CheckingAvailable, 1244.43)
		}
	})

	t.Run("no available field falls back to posted", func(t *testing.T) {
		m := baseModel()
		m.Checkpoints[0].AvailableBalance = nil
		s := Build(m, nil, "2026-11-15", testEnd)
		if s.Baselines[0].Basis != "posted" || s.Baselines[0].AvailableBalance != nil {
			t.Fatalf("posted fallback basis %+v", s.Baselines)
		}
		assertMoney(t, s.CheckingAvailable, 1608.05)
	})

	t.Run("mixed cash accounts use each account's basis", func(t *testing.T) {
		for _, posted := range []string{"checking", "savings"} {
			m := baseModel()
			m.Accounts = append(m.Accounts, types.Account{ID: "savings", Name: "Savings", Kind: types.AccountKindCash, Enabled: true})
			m.Checkpoints = append(m.Checkpoints, types.Checkpoint{AccountID: "savings", Balance: 500, AvailableBalance: ptr(480.0), ObservedAt: stamp("2026-11-14T20:00:00Z")})
			for i := range m.Accounts {
				if (m.Accounts[i].ID == "checking") == (posted == "checking") {
					m.Accounts[i].DisplayBasis = types.DisplayBasisPosted
				}
			}
			settings := &types.SafeSpendingSettings{SpendingAccountIDs: []string{"checking", "savings"}}
			s := Build(m, settings, "2026-11-15", testEnd)
			if len(s.Baselines) != 2 {
				t.Fatalf("baselines %+v", s.Baselines)
			}
			want := map[string]string{"checking": "available", "savings": "available"}
			want[posted] = "posted"
			for _, b := range s.Baselines {
				if b.Basis != want[b.AccountID] {
					t.Fatalf("%s basis = %q want %q", b.AccountID, b.Basis, want[b.AccountID])
				}
			}
			wantCash := 1244.43 + 480.0
			if posted == "checking" {
				wantCash = 1608.05 + 480.0
			} else {
				wantCash = 1244.43 + 500.0
			}
			assertMoney(t, s.CheckingAvailable, wantCash)
		}
	})
}

// A priced outgoing hold on the posted basis is reconciled through the bill
// ledger, not by nulling the numeric cash basis or by deducting the held part
// twice. Available evidence, when present, remains on the baseline untouched.
func TestPostedBasisPricedHoldStaysNumericAndCountsOnce(t *testing.T) {
	for _, tc := range []struct {
		name      string
		available *float64
		wantAvail float64
		unpriced  bool
	}{
		{name: "posted only", available: nil, wantAvail: 1608.05},
		{name: "both figures with posted preference", available: ptr(1244.43), wantAvail: 1608.05},
		{name: "posted only with a priced bill and unpriced hold", wantAvail: 1608.05, unpriced: true},
	} {
		t.Run(tc.name, func(t *testing.T) {
			m := baseModel()
			m.Accounts[0].DisplayBasis = types.DisplayBasisPosted
			m.Checkpoints[0].AvailableBalance = tc.available
			m.Schedules = []types.Schedule{bill("utility", "2026-11-15", 100)}
			hold := payment("utility-hold", 40, "2026-11-14T12:00:00Z")
			hold.Pending = true
			if tc.unpriced {
				hold.Amount.Resolver = "unavailable"
			}
			hold.Claim = &types.TransactionClaim{ScheduleID: "utility", OccurrenceDate: "2026-11-15"}
			m.Transactions = []types.Transaction{hold}

			s := Build(m, nil, "2026-11-15", testEnd)
			if s.Status != "available" || len(s.Reasons) != 0 {
				t.Fatalf("priced hold status %q reasons %v", s.Status, s.Reasons)
			}
			assertMoney(t, s.CheckingAvailable, tc.wantAvail)
			assertMoney(t, s.CashAfterBills, tc.wantAvail-100)
			if len(s.Baselines) != 1 || s.Baselines[0].Basis != "posted" || s.Baselines[0].Status != "available" {
				t.Fatalf("posted hold baseline %+v", s.Baselines)
			}
			if s.Baselines[0].AvailableBalance == nil {
				if tc.available != nil {
					t.Fatal("reported available evidence was dropped")
				}
			} else {
				assertMoney(t, s.Baselines[0].AvailableBalance, *tc.available)
			}
			assertMoney(t, s.Baselines[0].PostedBalance, 1608.05)
			if len(s.ConfirmedMovements) != 0 {
				t.Fatalf("pending hold replayed as a confirmed movement %+v", s.ConfirmedMovements)
			}
			if len(s.Bills) != 1 || s.Bills[0].Status != "pending" {
				t.Fatalf("hold bill %+v", s.Bills)
			}
			assertMoney(t, s.Bills[0].Amount, 100)
			// The held 40 is reserved once by the full dated bill debit, not
			// once in an embedded available total and again as a remainder.
			assertMoney(t, s.Bills[0].UncoveredHold, 100)
			if slices.Contains(s.Reasons, ReasonPossiblePendingPaymentOverlap) {
				t.Fatalf("linked hold flagged as an unlinked overlap %v", s.Reasons)
			}
			assertMoney(t, s.OutstandingBillsTotal, 100)

			// The same debt appears once in the dated cash timing check.
			atCut := BuildAtCut(m, &types.SafeSpendingSettings{SpendingAccountIDs: []string{"checking"}}, stamp("2026-11-15T12:00:00Z"))
			assertMoney(t, atCut.PrePaydayBills, 100)
			assertMoney(t, atCut.CheckingAvailable, tc.wantAvail)
		})
	}
}

func TestCashBasisHistoricalCutUsesOnlyEarlierEvidence(t *testing.T) {
	m := baseModel()
	m.Accounts[0].DisplayBasis = types.DisplayBasisPosted
	m.Checkpoints = append(m.Checkpoints,
		types.Checkpoint{AccountID: "checking", Balance: 9999, AvailableBalance: ptr(9999.0), ObservedAt: stamp("2026-11-16T20:00:00Z")},
		types.Checkpoint{AccountID: "checking", Balance: 1111, AvailableBalance: ptr(1111.0), ObservedAt: stamp("2026-11-15T13:00:00Z")},
	)
	cut := stamp("2026-11-15T12:00:00Z")
	s := buildEvidence(m, nil, "2026-11-15", "2026-11-30", cut)
	assertMoney(t, s.CheckingAvailable, 1608.05)
	if len(s.Baselines) != 1 || *s.Baselines[0].ObservedAt != stamp("2026-11-14T20:00:00Z") || s.Baselines[0].Basis != "posted" {
		t.Fatalf("later checkpoint used at historical cut %+v", s.Baselines)
	}
}

func TestCashBasisWithoutBaselineAtHistoricalCutStaysUnknown(t *testing.T) {
	m := baseModel()
	m.Accounts[0].DisplayBasis = types.DisplayBasisPosted
	s := Build(m, nil, "2026-11-13", "2026-11-30")
	if s.Status != "missing" || s.CheckingAvailable != nil {
		t.Fatalf("missing historical baseline %+v", s)
	}
	if len(s.Baselines) != 1 || s.Baselines[0].Basis != "missing" || s.Baselines[0].Status != "missing" || s.Baselines[0].AvailableBalance != nil {
		t.Fatalf("missing historical evidence %+v", s.Baselines)
	}
}
