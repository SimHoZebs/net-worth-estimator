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
	assertMoney(t, s.UnpaidByPayday, 250)

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
	assertMoney(t, s.UnpaidByPayday, 250)
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
	assertMoney(t, s.UnpaidByPayday, 250)
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
	assertMoney(t, s.UnpaidByPayday, 370)
	assertMoney(t, s.PrePaydayBills, 370)
}

// The payment bar reports non-card bills only. Card payoffs stay separate in
// the card section even when the production-shaped snapshot carries a large
// statement reserve and a small rent bill.
func TestPaymentProgressExcludesCardPayoffFromBar(t *testing.T) {
	model, settings := novemberForecastFixture()
	s := BuildAtCut(model, settings, domain.DayCloseUnix("2026-11-17"))
	assertMoney(t, s.UnpaidByPayday, 91.08)
	assertMoney(t, s.StatementReserve, 2890.56)
	if len(s.Bills) != 1 || s.Bills[0].ScheduleID == nil || *s.Bills[0].ScheduleID != "rent" {
		t.Fatalf("card payoff entered the bill detail %+v", s.Bills)
	}
}

// A scheduled repayment owned by exactly one tracked card is a card-section
// row. It stays a dated reservation but leaves the bar and the bill detail.
func TestScheduledSingleCardRepaymentExcludedFromBarAndDetail(t *testing.T) {
	model, settings := paydayFixture()
	minimum := bill("card-minimum", "2026-11-30", 150)
	minimum.Destinations = []string{"card-a"}
	model.Schedules = append(model.Schedules, minimum)
	settings.TransactionIDs = append(settings.TransactionIDs, minimum.ID)

	s := BuildAtCut(model, settings, stamp(paydayCut))
	assertMoney(t, s.UnpaidByPayday, 250)
	assertMoney(t, s.StatementReserve, 500)
	assertMoney(t, s.PrePaydayBills, 250)
	assertMoney(t, s.PaydayBills, 150)
	if len(s.Bills) != 1 || s.Bills[0].ScheduleID == nil || *s.Bills[0].ScheduleID != "rent" {
		t.Fatalf("single-card repayment entered the bar detail %+v", s.Bills)
	}
}

// A split transfer into two tracked cards is a real cash movement, not a
// card-section repayment. It remains in the bar and in the bill detail.
func TestScheduledSplitCardTransferStaysInBarAndDetail(t *testing.T) {
	model, settings := paydayFixture()
	split := bill("split-card-payment", "2026-11-30", 150)
	split.Destinations = []string{"card-a", "card-b"}
	model.Schedules = append(model.Schedules, split)
	settings.TransactionIDs = append(settings.TransactionIDs, split.ID)

	s := BuildAtCut(model, settings, stamp(paydayCut))
	assertMoney(t, s.UnpaidByPayday, 400)
	if s.StatementReserve != nil {
		t.Fatalf("split transfer produced a precise card payoff %+v", s.StatementReserve)
	}
	found := false
	for _, row := range s.Bills {
		if row.ScheduleID != nil && *row.ScheduleID == split.ID {
			found = true
		}
	}
	if !found || len(s.Bills) != 2 {
		t.Fatalf("split transfer missing from bill detail %+v", s.Bills)
	}
}

// Without a statement estimate the card payoff is unknown, but the non-card
// bills still price the payment bar.
func TestMissingStatementEstimateDoesNotNullPaymentBar(t *testing.T) {
	model, settings := paydayFixture()
	model.Checkpoints = model.Checkpoints[:2] // drop card-b's closing observation

	s := BuildAtCut(model, settings, stamp(paydayCut))
	if s.StatementReserve != nil {
		t.Fatalf("missing estimate produced a precise card payoff %+v", s.StatementReserve)
	}
	assertMoney(t, s.UnpaidByPayday, 250)
}
