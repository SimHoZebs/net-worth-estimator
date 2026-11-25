package safespending

import (
	"math"
	"testing"

	"github.com/simhozebs/net-worth-estimator/backend/internal/domain"
	"github.com/simhozebs/net-worth-estimator/backend/internal/types"
)

func TestNov20ActiveCycleKeepsNov30PaymentProgress(t *testing.T) {
	model, settings := novemberForecastFixture()
	prior := BuildAtCut(model, settings, domain.DayCloseUnix("2026-11-17"))
	active := BuildAtCut(model, settings, domain.DayCloseUnix("2026-11-20"))

	if prior.CycleStart != "2026-10-20" || prior.CycleEnd != "2026-11-19" ||
		active.CycleStart != "2026-11-20" || active.CycleEnd != "2026-12-19" {
		t.Fatalf("active cycle dates = %s → %s, want prior Oct 20–Nov 19 and active Nov 20–Dec 19",
			active.CycleStart, active.CycleEnd)
	}
	if active.Payday == nil || *active.Payday != "2026-11-30" {
		t.Fatalf("actual next income = %v, want 2026-11-30", active.Payday)
	}
	if active.CycleFundingPayday == nil || *active.CycleFundingPayday != "2026-12-30" {
		t.Fatalf("cycle funding payday = %v, want 2026-12-30", active.CycleFundingPayday)
	}
	if active.PayoffDate != "2026-11-30" || active.PaymentPeriodStart != prior.PaymentPeriodStart {
		t.Fatalf("payment window moved: payoff %q start %q", active.PayoffDate, active.PaymentPeriodStart)
	}
	assertMoney(t, active.StatementReserve, *prior.StatementReserve)
	assertMoney(t, active.PrePaydayBills, *prior.PrePaydayBills)
	assertMoney(t, active.PaidByPayday, *prior.PaidByPayday)
	assertMoney(t, active.UnpaidByPayday, *prior.UnpaidByPayday)
	if len(active.Bills) != len(prior.Bills) {
		t.Fatalf("payment ledger bills changed: %d vs %d", len(active.Bills), len(prior.Bills))
	}
	// The displayed budget follows the active cycle's funding paycheck, not
	// the upcoming payment progress.
	if *active.IncomeFunded == *prior.IncomeFunded {
		t.Fatalf("cycle budget did not follow the active cycle: %.2f", *active.IncomeFunded)
	}
}

func TestCycleWithoutIncomeLeavesFundingPaydayAndAmountsUnknown(t *testing.T) {
	model, settings := paydayFixture()
	settings.IncomeScheduleIDs = nil
	s := BuildAtCut(model, settings, stamp(paydayCut))
	if s.CycleFundingPayday != nil {
		t.Fatalf("cycle funding payday = %v, want nil without income", *s.CycleFundingPayday)
	}
	if s.IncomeFunded != nil || s.SavingsAllowance != nil || s.FundingRoom != nil {
		t.Fatalf("missing income synthesized a cycle amount: %v %v %v",
			s.IncomeFunded, s.SavingsAllowance, s.FundingRoom)
	}
	if s.PrePaydayRoom == nil {
		t.Fatal("missing income erased the independently known cash checkpoint")
	}
}

func TestCycleAmountsSurviveMissingCashEvidence(t *testing.T) {
	model, settings := novemberForecastFixture()
	checkpoints := make([]types.Checkpoint, 0, len(model.Checkpoints))
	for _, cp := range model.Checkpoints {
		if cp.AccountID != "checking" {
			checkpoints = append(checkpoints, cp)
		}
	}
	model.Checkpoints = checkpoints
	s := BuildAtCut(model, settings, domain.DayCloseUnix("2026-11-17"))
	if s.CheckingAvailable != nil || s.FundingRoom != nil {
		t.Fatalf("missing cash evidence produced a cushion: %v %v", s.CheckingAvailable, s.FundingRoom)
	}
	if s.IncomeFunded == nil || s.SavingsAllowance == nil {
		t.Fatalf("missing cash evidence erased paycheck-funded amounts: %v %v", s.IncomeFunded, s.SavingsAllowance)
	}
	assertMoney(t, s.IncomeFunded, 4559.09)
	assertMoney(t, s.SavingsAllowance, 4059.09)
}

func TestMissingPayoffKeepsCashTotalsAndProvenZero(t *testing.T) {
	model, settings := novemberForecastFixture()
	checkpoints := make([]types.Checkpoint, 0, len(model.Checkpoints))
	for _, cp := range model.Checkpoints {
		if cp.AccountID == "checking" {
			cp.Balance, cp.AvailableBalance = 91.08, nil
		}
		checkpoints = append(checkpoints, cp)
	}
	model.Checkpoints = checkpoints
	for i := range model.Transactions {
		if model.Transactions[i].SourceAccountID != nil {
			model.Transactions[i].Amount.Resolver = "unavailable"
		}
	}
	s := BuildAtCut(model, settings, domain.DayCloseUnix("2026-11-17"))
	if s.IncomeFunded != nil || s.SavingsAllowance != nil {
		t.Fatalf("incomplete dues exposed a cycle amount: %v %v", s.IncomeFunded, s.SavingsAllowance)
	}
	if s.PrePaydayBills == nil {
		t.Fatal("missing payoff erased the recurring total")
	}
	assertMoney(t, s.PrePaydayRoom, 0)
}

func TestLinkedSettlementReducesCycleBudgetOnce(t *testing.T) {
	model, settings := paydayFixture()
	model.Schedules[0].StartDate = "2026-11-15"
	unsettled := BuildAtCut(model, settings, stamp("2026-11-14T12:00:00Z"))
	if unsettled.IncomeFunded == nil {
		t.Fatal("unsettled cycle budget unknown")
	}
	settlement := payment("rent-settled", 250, "2026-11-14T10:00:00Z")
	settlement.Claim = &types.TransactionClaim{ScheduleID: "rent", OccurrenceDate: "2026-11-15"}
	model.Transactions = append(model.Transactions, settlement)
	settled := BuildAtCut(model, settings, stamp("2026-11-14T12:00:00Z"))
	if settled.IncomeFunded == nil {
		t.Fatal("settled cycle budget unknown")
	}
	if *settled.IncomeFunded != *unsettled.IncomeFunded+250 {
		t.Fatalf("settlement changed the budget by %.2f, want 250 once",
			*settled.IncomeFunded-*unsettled.IncomeFunded)
	}
	if len(settled.Bills) != len(unsettled.Bills) {
		t.Fatal("linked settlement changed the obligation ledger size")
	}
}

func TestPendingChargesThatMissedCloseFundTheActiveCycle(t *testing.T) {
	cut := domain.DayCloseUnix("2026-11-20")
	build := func(withPending bool) types.SafeSpendingSummary {
		model, settings := paydayFixture()
		model.Schedules[0].StartDate = "2026-12-02"
		model.Schedules[0].Amount = fixed(10)
		model.Schedules[0].EndDate = ptr("2026-12-02")
		settings.TransactionIDs = append(settings.TransactionIDs, model.Schedules[0].ID)
		if withPending {
			model.Transactions = append(model.Transactions,
				pricedPendingCharge("hold-1", 24.82, "2026-11-17T12:00:00Z"),
				pricedPendingCharge("hold-2", 13.27, "2026-11-18T12:00:00Z"),
				pricedPendingCharge("hold-3", 8.58, "2026-11-18T12:00:00Z"),
				pricedPendingCharge("hold-4", 42.86, "2026-11-19T12:00:00Z"),
			)
		}
		return BuildAtCut(model, settings, cut)
	}
	base := build(false)
	withHolds := build(true)
	if base.CycleFundingPayday == nil || *base.CycleFundingPayday != "2026-12-30" {
		t.Fatalf("cycle funding payday = %v, want 2026-12-30", base.CycleFundingPayday)
	}
	if base.IncomeFunded == nil || withHolds.IncomeFunded == nil {
		t.Fatalf("cycle budget unknown: %v %v", base.IncomeFunded, withHolds.IncomeFunded)
	}
	if got := *base.IncomeFunded - *withHolds.IncomeFunded; math.Abs(got-89.53) > 0.005 {
		t.Fatalf("pending charges changed the cycle budget by %.2f, want 89.53 once", got)
	}
}

func TestPayoffDateDifferentFromSelectedPayday(t *testing.T) {
	model, settings := novemberForecastFixture()
	settings.PaydayDay = 18
	s := BuildAtCut(model, settings, domain.DayCloseUnix("2026-11-17"))
	if s.CycleFundingPayday == nil || *s.CycleFundingPayday != "2026-12-30" {
		t.Fatalf("cycle funding payday = %v, want 2026-12-30", s.CycleFundingPayday)
	}
	if s.IncomeFunded == nil || s.SavingsAllowance == nil {
		t.Fatal("payoff on the configured date was dropped when the payday differs")
	}
}
