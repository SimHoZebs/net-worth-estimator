package safespending

import (
	"slices"
	"testing"

	"github.com/simhozebs/net-worth-estimator/backend/internal/types"
)

func TestUnknownPostedMovementInvalidatesOnlyAffectedBalanceDependencies(t *testing.T) {
	for _, routingUnknown := range []bool{false, true} {
		t.Run(map[bool]string{false: "amount", true: "routing"}[routingUnknown], func(t *testing.T) {
			m := baseModel()
			m.Accounts = append(m.Accounts, types.Account{ID: "debt", Kind: "debt", Enabled: true}, types.Account{ID: "other-one", Kind: "debt", Enabled: true}, types.Account{ID: "other-two", Kind: "investment", Enabled: true})
			m.Checkpoints = append(m.Checkpoints, types.Checkpoint{AccountID: "debt", Balance: -2000, ObservedAt: stamp("2026-11-14T20:00:00Z")}, types.Checkpoint{AccountID: "other-one", ObservedAt: stamp("2026-11-14T20:00:00Z")}, types.Checkpoint{AccountID: "other-two", ObservedAt: stamp("2026-11-14T20:00:00Z")})
			m.PaymentTerms = []types.PaymentTerms{{AccountID: "debt", MinimumPercent: ptr(.02)}}
			minimum := bill("dependent-minimum", "2026-11-16", 0)
			minimum.Amount = types.TransactionAmountResolution{Resolver: "expression", Config: map[string]any{"expression": "minimum"}, Inputs: map[string]types.AmountInputBinding{"minimum": {Source: "provider", Provider: "terms-minimum", Arguments: map[string]any{"id": "debt"}}}}
			m.Schedules = []types.Schedule{minimum, bill("independent", "2026-11-16", 30)}
			unknown := payment("unknown-debt-movement", 100, "2026-11-15T09:00:00Z")
			unknown.SourceAccountID = ptr("debt")
			if routingUnknown {
				unknown.Destinations = []string{"other-one", "other-two"}
			} else {
				unknown.Amount = types.TransactionAmountResolution{Resolver: "expression", Config: map[string]any{"expression": "balance * .1"}, Inputs: map[string]types.AmountInputBinding{"balance": {Source: "provider", Provider: "account-balance", Arguments: map[string]any{"id": "debt"}}}}
			}
			laterKnown := payment("later-known-debt-debit", 5, "2026-11-15T10:00:00Z")
			laterKnown.SourceAccountID = ptr("debt")
			m.Transactions = []types.Transaction{unknown, laterKnown}
			s := Build(m, nil, "2026-11-15", testEnd)
			assertMoney(t, s.CheckingAvailable, 1244.43)
			if s.Status != "uncertain" || s.CashAfterBills != nil || s.OutstandingBillsTotal != nil || !slices.Contains(s.Reasons, ReasonObligationAmountUnavailable) || len(s.OutstandingObligations) != 2 {
				t.Fatalf("stale provider evidence presented as known %+v", s)
			}
			for _, row := range s.OutstandingObligations {
				if row.ScheduleID != nil && *row.ScheduleID == "dependent-minimum" && row.Amount != nil {
					t.Fatal("dependent minimum used stale debt balance")
				}
				if row.ScheduleID != nil && *row.ScheduleID == "independent" {
					assertMoney(t, row.Amount, 30)
				}
			}
			// An unrelated conditional bill still has precise checking evidence.
			s = Build(m, &types.SafeSpendingSettings{TransactionIDs: []string{"independent"}}, "2026-11-15", testEnd)
			assertMoney(t, s.CheckingAvailable, 1244.43)
			assertMoney(t, s.CashAfterBills, 1214.43)
			if s.Status != "available" {
				t.Fatalf("unrelated bill globally poisoned %+v", s)
			}
			// A later observation covers both prior movements and restores the
			// dependent amount without reconstructing the unresolved movement.
			m.Checkpoints = append(m.Checkpoints, types.Checkpoint{AccountID: "debt", Balance: -2500, ObservedAt: stamp("2026-11-15T11:00:00Z")})
			s = Build(m, nil, "2026-11-15", testEnd)
			assertMoney(t, s.CheckingAvailable, 1244.43)
			assertMoney(t, s.OutstandingBillsTotal, 80)
			assertMoney(t, s.CashAfterBills, 1164.43)
			if s.Status != "available" {
				t.Fatalf("later observation did not restore dependency %+v", s)
			}
		})
	}
}

func TestUnknownNewerClaimInvalidatesLatestAmountEvenWhenBalanceObservationCoversIt(t *testing.T) {
	for _, laterObservation := range []bool{false, true} {
		t.Run(map[bool]string{false: "movement-after-observation", true: "movement-covered-by-later-observation"}[laterObservation], func(t *testing.T) {
			m := baseModel()
			m.Accounts = append(m.Accounts, types.Account{ID: "debt", Kind: "debt", Enabled: true})
			m.Checkpoints = append(m.Checkpoints, types.Checkpoint{AccountID: "debt", Balance: -2000, ObservedAt: stamp("2026-11-14T20:00:00Z")})
			older := payment("october-known", 100, "2026-10-15T09:00:00Z")
			older.SourceAccountID = ptr("debt")
			older.Claim = &types.TransactionClaim{ScheduleID: "S", OccurrenceDate: "2026-10-15"}
			newer := payment("november-unknown", 0, "2026-11-15T09:00:00Z")
			newer.SourceAccountID = ptr("debt")
			newer.Claim = &types.TransactionClaim{ScheduleID: "S", OccurrenceDate: "2026-11-15"}
			newer.Amount = types.TransactionAmountResolution{Resolver: "expression", Config: map[string]any{"expression": "balance * .1"}, Inputs: map[string]types.AmountInputBinding{"balance": {Source: "provider", Provider: "account-balance", Arguments: map[string]any{"id": "debt"}}}}
			m.Transactions = []types.Transaction{older, newer}
			dependent := bill("checking-future-bill", "2026-11-16", 0)
			dependent.Amount = types.TransactionAmountResolution{Resolver: "expression", Config: map[string]any{"expression": "previous"}, Inputs: map[string]types.AmountInputBinding{"previous": {Source: "provider", Provider: "model-value", Arguments: map[string]any{"id": "S"}}}}
			series := bill("S", "2026-10-15", 100)
			series.SourceAccountID = ptr("debt")
			m.Schedules = []types.Schedule{series, dependent}
			if laterObservation {
				m.Checkpoints = append(m.Checkpoints, types.Checkpoint{AccountID: "debt", Balance: -2500, ObservedAt: stamp("2026-11-15T10:00:00Z")})
			}
			s := Build(m, nil, "2026-11-15", testEnd)
			assertMoney(t, s.CheckingAvailable, 1244.43)
			if s.Status != "uncertain" || s.CashAfterBills != nil || s.OutstandingBillsTotal != nil || len(s.OutstandingObligations) != 1 || s.OutstandingObligations[0].Amount != nil || !slices.Contains(s.Reasons, ReasonObligationAmountUnavailable) {
				t.Fatalf("stale October amount survived unknown November claim %+v", s)
			}
			// A later independently known claim restores latest amount evidence;
			// restoring only a balance observation above did not do so.
			known := payment("november-later-known", 150, "2026-11-15T11:00:00Z")
			known.SourceAccountID = ptr("debt")
			known.Claim = &types.TransactionClaim{ScheduleID: "S", OccurrenceDate: "2026-12-15"}
			m.Transactions = append(m.Transactions, known)
			s = Build(m, nil, "2026-11-15", testEnd)
			assertMoney(t, s.CheckingAvailable, 1244.43)
			assertMoney(t, s.OutstandingBillsTotal, 150)
			assertMoney(t, s.CashAfterBills, 1094.43)
			if s.Status != "available" {
				t.Fatalf("known later claim failed to restore latest amount %+v", s)
			}
		})
	}
}

func TestRecordedAmountInvalidationClearsIdentityDateAndAccumulation(t *testing.T) {
	a := newAmounts(&types.FinancialModel{}, map[string]float64{})
	tx := payment("unknown", 100, "2026-11-15T09:00:00Z")
	tx.Claim = &types.TransactionClaim{ScheduleID: "S", OccurrenceDate: "2026-11-15"}
	a.record(tx, 100)
	a.invalidateRecorded(tx)
	for _, id := range []string{"unknown", "S"} {
		if _, ok := a.latest[id]; ok {
			t.Fatalf("latest amount retained for %s", id)
		}
		if _, ok := a.dates[id]; ok {
			t.Fatalf("latest date retained for %s", id)
		}
		if _, ok := a.years[id]; ok {
			t.Fatalf("accumulated state retained for %s", id)
		}
	}
	later := payment("later-known", 150, "2026-11-16T09:00:00Z")
	later.Claim = &types.TransactionClaim{ScheduleID: "S", OccurrenceDate: "2026-11-16"}
	a.record(later, 150)
	if a.latest["S"] != 150 || a.dates["S"] != "2026-11-16" {
		t.Fatal("latest known evidence not restored")
	}
}
