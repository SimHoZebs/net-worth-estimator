package safespending

import (
	"slices"
	"testing"

	"github.com/simhozebs/net-worth-estimator/backend/internal/domain"
	"github.com/simhozebs/net-worth-estimator/backend/internal/types"
)

// The payment period starts 2026-11-01 for the payday fixture. An observation
// from an older cycle must not pull its unlinked occurrences into the ledger:
// a missing link says nothing about whether those bills were paid.
func TestUnlinkedBillBeforePaymentPeriodStaysOutsideForecast(t *testing.T) {
	model, settings := paydayFixture()
	model.Checkpoints = append(model.Checkpoints, types.Checkpoint{AccountID: "checking", Balance: 900, ObservedAt: domain.DayCloseUnix("2026-09-30")})
	older := bill("older", "2026-10-20", 90)
	older.EndDate = ptr(older.StartDate)
	model.Schedules = append(model.Schedules, older)
	settings.TransactionIDs = append(settings.TransactionIDs, older.ID)

	s := BuildAtCut(model, settings, stamp(paydayCut))
	dates := []string{}
	for _, row := range s.Bills {
		dates = append(dates, row.Date)
	}
	if !slices.Equal(dates, []string{"2026-11-20"}) {
		t.Fatalf("rolled over an unlinked older bill %v", dates)
	}
	assertMoney(t, s.PaidByPayday, 0)
	assertMoney(t, s.UnpaidByPayday, 900)

	// Even a same-amount movement in the window does not link the bill. An
	// exact claim is the only settlement evidence.
	unrelated := payment("same-amount", 90, "2026-11-10T12:00:00Z")
	model.Transactions = []types.Transaction{unrelated}
	s = BuildAtCut(model, settings, stamp(paydayCut))
	dates = dates[:0]
	for _, row := range s.Bills {
		dates = append(dates, row.Date)
	}
	if !slices.Equal(dates, []string{"2026-11-20"}) {
		t.Fatalf("amount match rolled over the older bill %v", dates)
	}
	assertMoney(t, s.PaidByPayday, 0)
	assertMoney(t, s.UnpaidByPayday, 900)
}

// An exact posted settlement inside the current window keeps its own earlier
// occurrence in the ledger as paid, so the payment bar does not show it as
// outstanding. Other older occurrences remain outside the forecast.
func TestInWindowSettlementBarsOnlyItsOwnEarlierOccurrence(t *testing.T) {
	model, settings := paydayFixture()
	settled := bill("settled-earlier", "2026-10-20", 90)
	settled.EndDate = ptr(settled.StartDate)
	unlinked := bill("unlinked-earlier", "2026-10-25", 70)
	unlinked.EndDate = ptr(unlinked.StartDate)
	model.Schedules = append(model.Schedules, settled, unlinked)
	settings.TransactionIDs = append(settings.TransactionIDs, settled.ID, unlinked.ID)

	actual := payment("earlier-actual", 90, "2026-11-10T12:00:00Z")
	actual.Claim = &types.TransactionClaim{ScheduleID: settled.ID, OccurrenceDate: settled.StartDate}
	model.Transactions = []types.Transaction{actual}

	s := BuildAtCut(model, settings, stamp(paydayCut))
	if len(s.Bills) != 2 || s.Bills[0].Date != settled.StartDate || s.Bills[0].Status != "paid" ||
		s.Bills[0].ActualDate == nil || *s.Bills[0].ActualDate != "2026-11-10" ||
		s.Bills[1].Date != "2026-11-20" || s.Bills[1].Status != "unpaid" {
		t.Fatalf("barred settlement ledger %+v", s.Bills)
	}
	assertMoney(t, s.PaidByPayday, 90)
	assertMoney(t, s.UnpaidByPayday, 900)
	assertMoney(t, s.PrePaydayBills, 250)
}

// A bill that came due after the period boundary is overdue but still inside
// the current payment period. It stays in the ledger and remains reserved.
func TestOverdueBillInPaymentPeriodRemainsReserved(t *testing.T) {
	model, settings := paydayFixture()
	overdue := bill("overdue", "2026-11-10", 120)
	overdue.EndDate = ptr(overdue.StartDate)
	model.Schedules = append(model.Schedules, overdue)
	settings.TransactionIDs = append(settings.TransactionIDs, overdue.ID)

	s := BuildAtCut(model, settings, stamp(paydayCut))
	dates := []string{}
	for _, row := range s.Bills {
		dates = append(dates, row.Date)
	}
	if !slices.Equal(dates, []string{"2026-11-10", "2026-11-20"}) {
		t.Fatalf("overdue in-period bills %v", dates)
	}
	for _, row := range s.Bills {
		if row.Status != "unpaid" || row.Amount == nil {
			t.Fatalf("overdue bill lost its reservation %+v", row)
		}
	}
	assertMoney(t, s.UnpaidByPayday, 1020)
	assertMoney(t, s.PrePaydayBills, 370)
}
