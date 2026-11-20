package safespending

import (
	"slices"
	"testing"

	"github.com/simhozebs/net-worth-estimator/backend/internal/types"
)

func TestPendingClaimWithDifferentRouteDoesNotEraseCashBill(t *testing.T) {
	model, settings := paydayFixture()
	model.Accounts = append(model.Accounts, types.Account{ID: "other-checking", Kind: types.AccountKindCash, Enabled: true})
	before := BuildAtCut(model, settings, stamp(paydayCut))
	assertMoney(t, before.SafeToSpend, 400)

	hold := payment("unselected-hold", 250, "2026-11-14T12:00:00Z")
	hold.Pending = true
	hold.SourceAccountID = ptr("other-checking")
	hold.Claim = &types.TransactionClaim{ScheduleID: "rent", OccurrenceDate: "2026-11-20"}
	model.Transactions = append(model.Transactions, hold)

	s := BuildAtCut(model, settings, stamp(paydayCut))
	assertMoney(t, s.CheckingAvailable, 900)
	assertMoney(t, s.PrePaydayBills, 250)
	assertMoney(t, s.SafeToSpend, 400)
	if len(s.Bills) != 1 || s.Bills[0].Status != "unpaid" {
		t.Fatalf("unfunded claim replaced the cash bill: %+v", s.Bills)
	}
}

func TestUnclaimedCoveredHoldOnlyWarnsAboutPossibleOverlap(t *testing.T) {
	model, settings := paydayFixture()
	model.Checkpoints[0].Balance = 1150
	model.Checkpoints[0].AvailableBalance = ptr(900.0)
	hold := payment("unclaimed-hold", 250, "2026-11-14T12:00:00Z")
	hold.Pending = true
	model.Transactions = append(model.Transactions, hold)

	s := BuildAtCut(model, settings, stamp(paydayCut))
	assertMoney(t, s.PrePaydayBills, 250)
	assertMoney(t, s.PaidByPayday, 0)
	if !slices.Contains(s.Reasons, ReasonPossiblePendingPaymentOverlap) {
		t.Fatalf("unclaimed hold overlap not flagged: %v", s.Reasons)
	}
}

func TestPartiallyCoveredPendingBillReservesRemainingEstimate(t *testing.T) {
	model, settings := paydayFixture()
	model.Checkpoints[0].Balance = 950
	model.Checkpoints[0].AvailableBalance = ptr(900.0)
	hold := payment("partial-hold", 50, "2026-11-14T12:00:00Z")
	hold.Pending = true
	hold.Claim = &types.TransactionClaim{ScheduleID: "rent", OccurrenceDate: "2026-11-20"}
	model.Transactions = append(model.Transactions, hold)

	s := BuildAtCut(model, settings, stamp(paydayCut))
	assertMoney(t, s.CheckingAvailable, 900)
	assertMoney(t, s.PrePaydayBills, 200)
	assertMoney(t, s.SafeToSpend, 450)
	assertMoney(t, s.Bills[0].Amount, 250)
	assertMoney(t, s.UnpaidByPayday, 250)
}
