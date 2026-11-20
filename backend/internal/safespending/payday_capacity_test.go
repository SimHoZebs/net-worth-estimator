package safespending

import "testing"

func TestPaymentRoomIsTighterCashCheckWithoutReserve(t *testing.T) {
	model, settings := paydayFixture()
	summary := BuildAtCut(model, settings, stamp(paydayCut))
	assertMoney(t, summary.PrePaydayRoom, 450)
	assertMoney(t, summary.PostIncomeRoom, 200)
	assertMoney(t, summary.PaymentRoom, 400) // min(900-250, 900+400-250-0-650)
	assertMoney(t, summary.SafeToSpend, 200)
}

// CardPayoffCapacity is the local fallback for payment capacity. It uses the
// same summary values and evidence cut as PaymentRoom but never subtracts the
// statement reserve, so it stays known when card payoffs are still unknown.
func TestCardPayoffCapacityBeforeStatementReserve(t *testing.T) {
	model, settings := paydayFixture()
	summary := BuildAtCut(model, settings, stamp(paydayCut))
	assertMoney(t, summary.CheckingAvailable, 900)
	assertMoney(t, summary.ExpectedPay, 400)
	assertMoney(t, summary.PrePaydayBills, 250)
	assertMoney(t, summary.PaydayBills, 0)
	assertMoney(t, summary.CardPayoffCapacity, 1050) // 900 + 400 - 250 - 0
	assertMoney(t, summary.PaymentRoom, 400)
}

func TestCardPayoffCapacityIsZeroAtBreakEven(t *testing.T) {
	model, settings := paydayFixture()
	model.Schedules = append(model.Schedules, bill("extra", "2026-11-18", 1050))
	settings.TransactionIDs = []string{"rent", "extra"}
	summary := BuildAtCut(model, settings, stamp(paydayCut))
	assertMoney(t, summary.PrePaydayBills, 1300)  // 250 rent + 1050 extra
	assertMoney(t, summary.CardPayoffCapacity, 0) // 900 + 400 - 1300 - 0
}

func TestCardPayoffCapacityKeepsSignedShortfall(t *testing.T) {
	model, settings := paydayFixture()
	model.Schedules = append(model.Schedules, bill("extra", "2026-11-18", 1400))
	settings.TransactionIDs = []string{"rent", "extra"}
	summary := BuildAtCut(model, settings, stamp(paydayCut))
	assertMoney(t, summary.PrePaydayBills, 1650)
	assertMoney(t, summary.CardPayoffCapacity, -350) // 900 + 400 - 1650 - 0
	assertMoney(t, summary.SafeToSpend, 0)
}

func TestCardPayoffCapacityIndependentOfUnknownCardPayoffs(t *testing.T) {
	model, settings := paydayFixture()
	model.Checkpoints = model.Checkpoints[:2] // drop card-b's payoff observation
	summary := BuildAtCut(model, settings, stamp(paydayCut))
	if summary.StatementReserve != nil || summary.PaymentRoom != nil {
		t.Fatalf("unknown card payoff still produced a statement check %+v", summary)
	}
	assertMoney(t, summary.CardPayoffCapacity, 1050)
	assertMoney(t, summary.PrePaydayRoom, 450)

	// A definite pre-payday shortfall stays visible even if the exact
	// payment room is unknown.
	model, settings = paydayFixture()
	model.Checkpoints = model.Checkpoints[:2]
	model.Schedules = append(model.Schedules, bill("extra", "2026-11-18", 1400))
	settings.TransactionIDs = []string{"rent", "extra"}
	summary = BuildAtCut(model, settings, stamp(paydayCut))
	if summary.PaymentRoom != nil {
		t.Fatalf("unknown card payoff still produced a payment room %+v", summary.PaymentRoom)
	}
	assertMoney(t, summary.PrePaydayRoom, -950) // 900 - 200 - 1650
	assertMoney(t, summary.CardPayoffCapacity, -350)
	prePaydayNoReserve := *summary.PrePaydayRoom + summary.Reserve
	if prePaydayNoReserve != *summary.CheckingAvailable-*summary.PrePaydayBills || prePaydayNoReserve >= 0 {
		t.Fatalf("definite pre-payday cash shortfall lost: %.2f", prePaydayNoReserve)
	}
}

func TestPaymentRoomFollowsPaydayBillsAndKeepsSignedShortfall(t *testing.T) {
	model, settings := paydayFixture()
	model.Schedules = append(model.Schedules, bill("payday-bill", "2026-11-30", 100))
	settings.TransactionIDs = []string{"rent", "payday-bill"}
	summary := BuildAtCut(model, settings, stamp(paydayCut))
	assertMoney(t, summary.PaymentRoom, 300) // min(650, 900+400-250-100-650)
	assertMoney(t, summary.SafeToSpend, 100)

	model, settings = paydayFixture()
	for i := range model.Checkpoints {
		if model.Checkpoints[i].AccountID == "card-a" {
			model.Checkpoints[i].Balance = -1000
		}
		if model.Checkpoints[i].AccountID == "card-b" {
			model.Checkpoints[i].Balance = -500
		}
	}
	summary = BuildAtCut(model, settings, stamp(paydayCut))
	assertMoney(t, summary.StatementReserve, 1500)
	assertMoney(t, summary.PaymentRoom, -450) // 900+400-250-1500
	assertMoney(t, summary.SafeToSpend, 0)
}

func TestPaymentRoomUnknownWhenCardPayoffUnknown(t *testing.T) {
	model, settings := paydayFixture()
	model.Checkpoints = model.Checkpoints[:2] // drop card-b's closing observation
	summary := BuildAtCut(model, settings, stamp(paydayCut))
	if summary.PaymentRoom != nil {
		t.Fatalf("unknown card payoff produced a precise payment check %+v", summary.PaymentRoom)
	}
	assertMoney(t, summary.PrePaydayRoom, 450)
}

func TestPaymentRoomNeedsExpectedIncome(t *testing.T) {
	model, settings := paydayFixture()
	settings.IncomeScheduleIDs = nil
	summary := BuildAtCut(model, settings, stamp(paydayCut))
	if summary.PaymentRoom != nil {
		t.Fatalf("missing payday invented a preview check %+v", summary)
	}
}
