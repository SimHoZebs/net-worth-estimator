package safespending

import (
	"testing"

	"github.com/simhozebs/net-worth-estimator/backend/internal/domain"
)

func TestForecastIncludesThirdPayoffInsideFundingHorizon(t *testing.T) {
	model, settings := paydayFixture()
	settings.PaydayDay = 18
	settings.Reserve = 0
	model.Checkpoints[1].Balance, model.Checkpoints[2].Balance = 0, 0
	model.Schedules[1].Amount = fixed(2000)
	cardBill := bill("december-card-charge", "2026-12-19", 5000)
	cardBill.SourceAccountID, cardBill.EndDate = ptr("card-a"), ptr(cardBill.StartDate)
	model.Schedules = append(model.Schedules, cardBill)

	s := BuildAtCut(model, settings, stamp(paydayCut))
	assertMoney(t, s.StatementReserve, 0)
	assertMoney(t, s.NextCycleIncome, -3000)
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
	assertMoney(t, before.NextCycleCarryover, 230)
	assertMoney(t, before.SafeToSpend, 230)

	autopay := bill("current-funded-autopay", "2026-12-10", 100)
	autopay.Destinations, autopay.EndDate = []string{"card-a"}, ptr(autopay.StartDate)
	model.Schedules = append(model.Schedules, autopay)
	settings.TransactionIDs = append(settings.TransactionIDs, autopay.ID)
	after := BuildAtCut(model, settings, cut)
	assertMoney(t, after.NextCycleCarryover, 230)
	assertMoney(t, after.SafeToSpend, 230)
	assertMoney(t, after.NextCycleIncome, *before.NextCycleIncome)
}

func TestEquivalentAutopayAndStatementDebitUseSameFundingBucket(t *testing.T) {
	model, settings := paydayFixture()
	settings.Reserve = 0
	model.Checkpoints[0].Balance, model.Checkpoints[0].AvailableBalance = 250, nil
	model.Schedules[1].Amount = fixed(5000)
	earlyPay := model.Schedules[1]
	earlyPay.ID, earlyPay.StartDate, earlyPay.EndDate, earlyPay.Amount = "early-pay", "2026-11-20", ptr("2026-11-20"), fixed(200)
	model.Schedules = append(model.Schedules, earlyPay)
	settings.IncomeScheduleIDs = append(settings.IncomeScheduleIDs, earlyPay.ID)
	before := BuildAtCut(model, settings, stamp(paydayCut))
	assertMoney(t, before.StatementReserve, 650)
	assertMoney(t, before.NextCycleCarryover, 200)
	assertMoney(t, before.NextCycleIncome, 9350)

	auto := bill("payday-autopay", "2026-11-30", 150)
	auto.Destinations, auto.EndDate = []string{"card-a"}, ptr(auto.StartDate)
	model.Schedules = append(model.Schedules, auto)
	settings.TransactionIDs = append(settings.TransactionIDs, auto.ID)
	after := BuildAtCut(model, settings, stamp(paydayCut))
	assertMoney(t, after.StatementReserve, 500)
	assertMoney(t, after.PaydayBills, 150)
	assertMoney(t, after.NextCycleCarryover, 200)
	assertMoney(t, after.NextCycleIncome, 9350)
}

func TestNextFundedAutopayAtFirstPayoffDoesNotReleaseCarriedDebt(t *testing.T) {
	t.Run("all excess", func(t *testing.T) {
		testNextFundedAutopayAtFirstPayoff(t, 0, 0, 150, 650, 50, 700)
	})
	t.Run("partly settles first payoff", func(t *testing.T) {
		testNextFundedAutopayAtFirstPayoff(t, 40, 0, 150, 650, 50, 660)
	})
	t.Run("earlier payment already settles first payoff", func(t *testing.T) {
		testNextFundedAutopayAtFirstPayoff(t, 100, 100, 350, 800, 150, 950)
	})
}

func testNextFundedAutopayAtFirstPayoff(t *testing.T, firstDue, earlierPayment, cash, nextPay, carryover, total float64) {
	t.Helper()
	model, settings := paydayFixture()
	settings.Reserve = 0
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
	assertMoney(t, before.NextCycleCarryover, carryover)
	assertMoney(t, before.SafeToSpend, carryover)
	assertMoney(t, before.NextCycleDiscretionary, total)

	autopay := bill("next-funded-autopay", "2026-11-30", 100+firstDue-earlierPayment)
	autopay.Destinations, autopay.EndDate = []string{"card-a"}, ptr(autopay.StartDate)
	model.Schedules = append(model.Schedules, autopay)
	settings.TransactionIDs = append(settings.TransactionIDs, autopay.ID)
	after := BuildAtCut(model, settings, cut)
	assertMoney(t, after.StatementReserve, 0)
	assertMoney(t, after.NextCycleCarryover, carryover)
	assertMoney(t, after.SafeToSpend, carryover)
	assertMoney(t, after.NextCycleDiscretionary, total)
}
