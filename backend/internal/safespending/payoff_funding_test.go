package safespending

import (
	"testing"

	"github.com/simhozebs/net-worth-estimator/backend/internal/domain"
)

func TestForecastIncludesThirdPayoffInsideFundingHorizon(t *testing.T) {
	model, settings := paydayFixture()
	settings.PaydayDay = 18
	model.Checkpoints[1].Balance, model.Checkpoints[2].Balance = 0, 0
	model.Schedules[1].Amount = fixed(2000)
	cardBill := bill("december-card-charge", "2026-12-19", 5000)
	cardBill.SourceAccountID, cardBill.EndDate = ptr("card-a"), ptr(cardBill.StartDate)
	model.Schedules = append(model.Schedules, cardBill)

	s := BuildAtCut(model, settings, stamp(paydayCut))
	assertMoney(t, s.StatementReserve, 0)
	if s.CycleFundingPayday == nil || *s.CycleFundingPayday != "2026-12-30" {
		t.Fatalf("cycle funding payday = %v, want 2026-12-30", s.CycleFundingPayday)
	}
	assertMoney(t, s.NextCycleIncome, -3250)
	assertMoney(t, s.ForecastCashRoom, -350)
	assertMoney(t, s.SafeToSpend, 0)
}

func TestCardCreditAtPriorCloseOffsetsNextStatement(t *testing.T) {
	model, settings := paydayFixture()
	model.Checkpoints[1].Balance = 50
	model.Checkpoints[2].Balance = 0
	charge := payment("charge-after-credit", 100, "2026-11-16T12:00:00Z")
	charge.SourceAccountID = ptr("card-a")
	model.Transactions = append(model.Transactions, charge)

	s := BuildAtCut(model, settings, domain.DayCloseUnix("2026-11-16"))
	assertMoney(t, s.StatementReserve, 50)
}

func TestCurrentFundedCardAutopayDoesNotDuplicateCarriedDebt(t *testing.T) {
	model, settings := novemberForecastFixture()
	model.Schedules[1].Amount = fixed(6883.21)
	charge := payment("post-close-purchase", 100, "2026-11-18T12:00:00Z")
	charge.SourceAccountID = ptr("card-a")
	model.Transactions = append(model.Transactions, charge)
	cut := domain.DayCloseUnix("2026-11-18")
	before := BuildAtCut(model, settings, cut)
	assertMoney(t, before.NextCycleCarryover, 4284.65)
	assertMoney(t, before.SafeToSpend, 230)

	autopay := bill("current-funded-autopay", "2026-12-10", 100)
	autopay.Destinations, autopay.EndDate = []string{"card-a"}, ptr(autopay.StartDate)
	model.Schedules = append(model.Schedules, autopay)
	settings.TransactionIDs = append(settings.TransactionIDs, autopay.ID)
	after := BuildAtCut(model, settings, cut)
	// A current-funded autopay changes the following cycle's income but does
	// not release the active cycle's carryover or the immediate cash check.
	assertMoney(t, after.NextCycleCarryover, 4384.65)
	assertMoney(t, after.SafeToSpend, 230)
	assertMoney(t, after.NextCycleIncome, *before.NextCycleIncome-100)
}

func TestEquivalentAutopayAndStatementDebitUseSameFundingBucket(t *testing.T) {
	model, settings := paydayFixture()
	model.Checkpoints[0].Balance, model.Checkpoints[0].AvailableBalance = 250, nil
	model.Schedules[1].Amount = fixed(5000)
	earlyPay := model.Schedules[1]
	earlyPay.ID, earlyPay.StartDate, earlyPay.EndDate, earlyPay.Amount = "early-pay", "2026-11-20", ptr("2026-11-20"), fixed(200)
	model.Schedules = append(model.Schedules, earlyPay)
	settings.IncomeScheduleIDs = append(settings.IncomeScheduleIDs, earlyPay.ID)
	before := BuildAtCut(model, settings, stamp(paydayCut))
	assertMoney(t, before.StatementReserve, 650)
	assertMoney(t, before.NextCycleCarryover, 4600)
	assertMoney(t, before.NextCycleIncome, 4750)

	auto := bill("payday-autopay", "2026-11-30", 150)
	auto.Destinations, auto.EndDate = []string{"card-a"}, ptr(auto.StartDate)
	model.Schedules = append(model.Schedules, auto)
	settings.TransactionIDs = append(settings.TransactionIDs, auto.ID)
	after := BuildAtCut(model, settings, stamp(paydayCut))
	assertMoney(t, after.StatementReserve, 500)
	assertMoney(t, after.PaydayBills, 150)
	// The autopay settles the payoff once; the active carryover is unchanged.
	assertMoney(t, after.NextCycleCarryover, 4750)
	assertMoney(t, after.NextCycleIncome, 4600)
}

func TestNextFundedAutopayAtFirstPayoffDoesNotReleaseCarriedDebt(t *testing.T) {
	t.Run("all excess", func(t *testing.T) {
		testNextFundedAutopayAtFirstPayoff(t, 0, 0, 150, 650, 50, 800, 800)
	})
	t.Run("partly settles first payoff", func(t *testing.T) {
		testNextFundedAutopayAtFirstPayoff(t, 40, 0, 150, 650, 50, 760, 800)
	})
	t.Run("earlier payment already settles first payoff", func(t *testing.T) {
		testNextFundedAutopayAtFirstPayoff(t, 100, 100, 350, 800, 150, 1150, 1150)
	})
}

func testNextFundedAutopayAtFirstPayoff(t *testing.T, firstDue, earlierPayment, cash, nextPay, safeToSpend, beforeCarry, afterCarry float64) {
	t.Helper()
	model, settings := paydayFixture()
	model.Checkpoints[0].Balance, model.Checkpoints[0].AvailableBalance = cash, nil
	model.Accounts[1].StatementClosingDay = 17
	model.Checkpoints[1].ObservedAt = domain.DayCloseUnix("2026-11-17")
	model.Checkpoints[1].Balance, model.Checkpoints[2].Balance = -firstDue, 0
	model.Schedules[1].Amount, model.Schedules[1].EndDate = fixed(nextPay), ptr("2026-11-30")
	earlyPay := model.Schedules[1]
	earlyPay.ID, earlyPay.StartDate, earlyPay.EndDate, earlyPay.Amount = "early-pay", "2026-11-20", ptr("2026-11-20"), fixed(250)
	model.Schedules = append(model.Schedules, earlyPay)
	settings.IncomeScheduleIDs = append(settings.IncomeScheduleIDs, earlyPay.ID)
	charge := payment("post-close-purchase", 100, "2026-11-18T12:00:00Z")
	charge.SourceAccountID = ptr("card-a")
	model.Transactions = append(model.Transactions, charge)
	cut := domain.DayCloseUnix("2026-11-18")

	if earlierPayment > 0 {
		autopay := bill("current-funded-autopay", "2026-11-21", earlierPayment)
		autopay.Destinations, autopay.EndDate = []string{"card-a"}, ptr(autopay.StartDate)
		model.Schedules = append(model.Schedules, autopay)
		settings.TransactionIDs = append(settings.TransactionIDs, autopay.ID)
	}
	before := BuildAtCut(model, settings, cut)
	assertMoney(t, before.StatementReserve, firstDue-earlierPayment)
	assertMoney(t, before.NextCycleCarryover, beforeCarry)
	assertMoney(t, before.SafeToSpend, safeToSpend)
	// The carried slice is unknown here, so no next-cycle total is verified.
	if before.NextCycleDiscretionary != nil {
		t.Fatalf("uncertain carry produced a next-cycle total: %v", *before.NextCycleDiscretionary)
	}

	autopay := bill("next-funded-autopay", "2026-11-30", 100+firstDue-earlierPayment)
	autopay.Destinations, autopay.EndDate = []string{"card-a"}, ptr(autopay.StartDate)
	model.Schedules = append(model.Schedules, autopay)
	settings.TransactionIDs = append(settings.TransactionIDs, autopay.ID)
	after := BuildAtCut(model, settings, cut)
	assertMoney(t, after.StatementReserve, 0)
	assertMoney(t, after.NextCycleCarryover, afterCarry)
	assertMoney(t, after.SafeToSpend, safeToSpend)
	if after.NextCycleDiscretionary != nil {
		t.Fatalf("uncertain carry produced a next-cycle total: %v", *after.NextCycleDiscretionary)
	}
}
