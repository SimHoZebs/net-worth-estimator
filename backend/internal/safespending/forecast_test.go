package safespending

import (
	"slices"
	"testing"

	"github.com/simhozebs/net-worth-estimator/backend/internal/domain"
	"github.com/simhozebs/net-worth-estimator/backend/internal/types"
)

func TestNovemberCashFundingAndNextCycleAreSeparate(t *testing.T) {
	model, settings := novemberForecastFixture()
	s := BuildAtCut(model, settings, domain.DayCloseUnix("2026-11-17"))
	if s.CycleReset != "2026-11-20" || s.NextCycleEnd != "2026-12-19" || s.DaysUntilReset != 3 {
		t.Fatalf("unexpected global cycle %s → %s (%d days)", s.CycleReset, s.NextCycleEnd, s.DaysUntilReset)
	}
	assertMoney(t, statementAmount(t, s, "card-a", "closed", "2026-11-17"), 275.55)
	assertMoney(t, statementAmount(t, s, "card-b", "estimated", "2026-11-19"), 2615.01)
	assertMoney(t, s.ExpectedPay, 7449.65)
	assertMoney(t, s.StatementReserve, 2890.56)
	assertMoney(t, s.SpendableCash, 300.92)
	assertMoney(t, s.SafeToSpend, 300.92)
	assertMoney(t, s.IncomeFunded, 595.52)
	assertMoney(t, s.AdditionalSavings, 595.52)
	assertMoney(t, s.SavingsAllowance, 95.52)
	assertMoney(t, s.FundingRoom, 896.44)
	assertMoney(t, s.NextCycleCarryover, 896.44)
	assertMoney(t, s.NextCycleIncome, 3486.08)
	assertMoney(t, s.NextCycleDiscretionary, 4382.52)
}

func TestReserveIsOutsideCycleBudgetAndNextCycle(t *testing.T) {
	model, settings := novemberForecastFixture()
	withoutReserve := BuildAtCut(model, settings, domain.DayCloseUnix("2026-11-17"))
	settings.Reserve = 400
	withReserve := BuildAtCut(model, settings, domain.DayCloseUnix("2026-11-17"))

	for _, field := range []struct {
		name string
		get  func(*types.SafeSpendingSummary) *float64
	}{
		{"with cash cushion", func(s *types.SafeSpendingSummary) *float64 { return s.FundingRoom }},
		{"without cash cushion", func(s *types.SafeSpendingSummary) *float64 { return s.IncomeFunded }},
		{"after savings goal", func(s *types.SafeSpendingSummary) *float64 { return s.SavingsAllowance }},
		{"next cycle carryover", func(s *types.SafeSpendingSummary) *float64 { return s.NextCycleCarryover }},
		{"next cycle budget", func(s *types.SafeSpendingSummary) *float64 { return s.NextCycleDiscretionary }},
	} {
		before, after := field.get(&withoutReserve), field.get(&withReserve)
		if before == nil || after == nil || *before != *after {
			t.Fatalf("reserve changed %s: %v → %v", field.name, before, after)
		}
	}
	// The cushion is the cash left before the funding paycheck; adding it to
	// the income-funded amount reproduces the with-cushion amount exactly.
	if got := *withoutReserve.FundingRoom; got != *withoutReserve.SpendableCash+*withoutReserve.IncomeFunded {
		t.Fatalf("with-cushion %.2f != cushion %.2f + income %.2f", got, *withoutReserve.SpendableCash, *withoutReserve.IncomeFunded)
	}
	// The reserve narrows only the cash checkpoints kept in the detail view.
	assertMoney(t, withoutReserve.SpendableCash, 300.92)
	assertMoney(t, withReserve.SpendableCash, -99.08)
	assertMoney(t, withoutReserve.SafeToSpend, 300.92)
	assertMoney(t, withReserve.SafeToSpend, 0)
}

func novemberForecastFixture() (*types.FinancialModel, *types.SafeSpendingSettings) {
	model, settings := paydayFixture()
	settings.Reserve = 0
	settings.SavingsTarget = 500
	model.Checkpoints[0].Balance = 392
	model.Checkpoints[0].AvailableBalance = nil
	model.Accounts[1].StatementClosingDay = 17
	model.Checkpoints[1].ObservedAt = domain.DayCloseUnix("2026-11-17")
	model.Checkpoints[1].Balance = -275.55
	model.Checkpoints[2].Balance = 0
	charge := payment("card-b-spending", 2615.01, "2026-11-17T12:00:00Z")
	charge.SourceAccountID = ptr("card-b")
	model.Transactions = []types.Transaction{charge}
	model.Schedules[0].StartDate = "2026-11-21"
	model.Schedules[0].Amount = fixed(91.08)
	model.Schedules[0].EndDate = ptr("2026-11-21")
	model.Schedules[1].Amount = fixed(7449.65)
	housing := bill("housing", "2026-12-01", 3963.57)
	laterPeriod := bill("later-period", "2027-01-30", 999)
	model.Schedules = append(model.Schedules, housing, laterPeriod)
	settings.TransactionIDs = append(settings.TransactionIDs, housing.ID, laterPeriod.ID)
	return model, settings
}

func TestCurrentCycleCardPurchaseAfterItsCloseConsumesCarryoverOnce(t *testing.T) {
	model, settings := novemberForecastFixture()
	charge := payment("card-a-new-purchase", 100, "2026-11-18T12:00:00Z")
	charge.SourceAccountID = ptr("card-a")
	model.Transactions = append(model.Transactions, charge)
	s := BuildAtCut(model, settings, domain.DayCloseUnix("2026-11-18"))
	assertMoney(t, s.StatementReserve, 2890.56)
	assertMoney(t, s.SafeToSpend, 300.92)
	assertMoney(t, s.NextCycleCarryover, 796.44)
	assertMoney(t, s.NextCycleIncome, 3486.08)
	assertMoney(t, s.NextCycleDiscretionary, 4282.52)

	// Reduce the first paycheck until the outstanding card purchase binds
	// today's cash spending, even though the bill is paid next month.
	model.Schedules[1].Amount = fixed(6883.21)
	s = BuildAtCut(model, settings, domain.DayCloseUnix("2026-11-18"))
	assertMoney(t, s.SafeToSpend, 230)
	assertMoney(t, s.NextCycleCarryover, 230)
	assertMoney(t, s.AdditionalSavings, -70.92)
}

func TestConfiguredPayoffDoesNotMoveScheduledIncome(t *testing.T) {
	model, settings := paydayFixture()
	settings.PaydayDay = 18
	settings.Reserve = 0
	model.Checkpoints[0].Balance = 500
	model.Checkpoints[0].AvailableBalance = nil
	s := BuildAtCut(model, settings, stamp(paydayCut))
	if s.PayoffDate != "2026-11-18" || s.Payday == nil || *s.Payday != "2026-11-30" {
		t.Fatalf("payoff %q, payday %v", s.PayoffDate, s.Payday)
	}
	assertMoney(t, s.CardPayoffCapacity, 500)
	assertMoney(t, s.SpendableCash, -400)
	assertMoney(t, s.IncomeFunded, 400)
	assertMoney(t, s.FundingRoom, 0)
	assertMoney(t, s.PaymentRoom, -150)
	assertMoney(t, s.SafeToSpend, 0)
}

func TestLaterCashShortfallLimitsTodayEvenWhenNextIncomeIsPositive(t *testing.T) {
	model, settings := paydayFixture()
	settings.Reserve = 0
	model.Schedules[1].Amount = fixed(1200)
	model.Schedules[1].EndDate = ptr("2026-11-30")
	later := model.Schedules[1]
	later.ID, later.StartDate, later.EndDate, later.Amount = "later-pay", "2026-12-31", nil, fixed(5000)
	nextCard := bill("dec-card", "2026-12-17", 1500)
	nextCard.SourceAccountID = ptr("card-a")
	nextCard.EndDate = ptr(nextCard.StartDate)
	model.Schedules = append(model.Schedules, later, nextCard)
	settings.IncomeScheduleIDs = append(settings.IncomeScheduleIDs, later.ID)

	s := BuildAtCut(model, settings, stamp(paydayCut))
	// The Dec 30 payoff precedes Dec 31 income. It leaves the first
	// funding bucket short; the later paycheck cannot fix that checkpoint.
	assertMoney(t, s.NextCycleCarryover, -300)
	assertMoney(t, s.NextCycleIncome, 5000)
	assertMoney(t, s.ForecastCashRoom, -300)
	assertMoney(t, s.SafeToSpend, 0)
}

func TestKnownCashShortfallSurvivesAnUnpricedFutureBill(t *testing.T) {
	model, settings := novemberForecastFixture()
	settings.Reserve = 400
	unknown := bill("unpriced-next-period-bill", "2026-12-31", 100)
	unknown.Amount.Resolver = "unavailable"
	model.Schedules = append(model.Schedules, unknown)
	settings.TransactionIDs = append(settings.TransactionIDs, unknown.ID)

	s := BuildAtCut(model, settings, domain.DayCloseUnix("2026-11-17"))
	assertMoney(t, s.StatementReserve, 2890.56)
	assertMoney(t, s.SafeToSpend, 0)
	if s.ForecastCashRoom != nil {
		t.Fatal("a reserve shortfall is not a proven shortfall for payments")
	}
	if s.NextCycleDiscretionary != nil {
		t.Fatal("unpriced bill should still prevent an exact next-cycle total")
	}
}

func TestFallbackAndGlobalCycleClampIndependently(t *testing.T) {
	model, settings := paydayFixture()
	settings.CycleStartDay = 31
	settings.IncomeScheduleIDs = nil
	s := BuildAtCut(model, settings, stamp("2028-02-29T12:00:00Z"))
	if s.CycleReset != "2028-03-31" || s.NextCycleEnd != "2028-04-29" || s.DaysUntilReset != 31 ||
		s.PayoffDate != "2028-02-29" || s.Payday == nil || *s.Payday != "2028-02-29" || s.ExpectedPay != nil {
		t.Fatalf("unexpected dates and income forecast: %+v", s)
	}
	assertMoney(t, s.SpendableCash, 700)
}

func TestStatementClosingOnPayoffAndLatePostingBelongToFollowingPayoff(t *testing.T) {
	model, settings := paydayFixture()
	settings.Reserve = 0
	settings.PaydayDay = 19
	for i := range model.Schedules {
		model.Schedules[i].StartDate = "2026-11-19"
	}
	model.Schedules[0].EndDate = nil
	charge := payment("late-card-charge", 50, "2026-11-12T12:00:00Z")
	charge.SourceAccountID = ptr("card-a")
	charge.TransactionTime = stamp("2026-10-18T12:00:00Z")
	model.Transactions = []types.Transaction{charge}

	s := BuildAtCut(model, settings, stamp(paydayCut))
	assertMoney(t, s.StatementReserve, 650)
	assertMoney(t, s.NextCycleCarryover, 350)
	assertMoney(t, s.NextCycleIncome, 150)
	if slices.ContainsFunc(s.Statements, func(row types.SafeSpendingStatement) bool { return row.ClosingDate == s.PayoffDate }) {
		t.Fatalf("same-day close appeared in upcoming payoff: %+v", s.Statements)
	}
}

func TestPaidAndUnpaidByPayoffKeepOccurrenceAndActualDates(t *testing.T) {
	model, settings := paydayFixture()
	model.Checkpoints = append(model.Checkpoints, types.Checkpoint{AccountID: "checking", Balance: 900, ObservedAt: domain.DayCloseUnix("2026-09-30")})
	lateBill := bill("arrears", "2026-10-20", 80)
	lateBill.EndDate = ptr(lateBill.StartDate)
	model.Schedules = append(model.Schedules, lateBill)
	settings.TransactionIDs = append(settings.TransactionIDs, lateBill.ID)

	// The older observation must not roll the unlinked earlier occurrence into
	// the forecast. Being unlinked says nothing about whether it was paid.
	before := BuildAtCut(model, settings, stamp(paydayCut))
	assertMoney(t, before.UnpaidByPayday, 900)
	if len(before.Bills) != 1 || before.Bills[0].Date != "2026-11-20" {
		t.Fatalf("unlinked earlier occurrence entered the ledger %+v", before.Bills)
	}

	actual := payment("actual", 80, "2026-11-14T12:00:00Z")
	actual.Claim = &types.TransactionClaim{ScheduleID: lateBill.ID, OccurrenceDate: lateBill.StartDate}
	hold := payment("hold", 250, "2026-11-14T18:00:00Z")
	hold.Pending = true
	hold.Claim = &types.TransactionClaim{ScheduleID: "rent", OccurrenceDate: "2026-11-20"}
	model.Transactions = []types.Transaction{actual, hold}
	after := BuildAtCut(model, settings, stamp(paydayCut))
	assertMoney(t, after.PaidByPayday, 80)
	assertMoney(t, after.UnpaidByPayday, 900)
	assertMoney(t, after.PrePaydayBills, 0)
	if len(after.Bills) != 2 || after.Bills[0].Date != lateBill.StartDate ||
		after.Bills[0].ActualDate == nil || *after.Bills[0].ActualDate != "2026-11-14" ||
		after.Bills[1].Status != "pending" || after.Bills[1].ActualDate != nil {
		t.Fatalf("payment detail: %+v", after.Bills)
	}
}
