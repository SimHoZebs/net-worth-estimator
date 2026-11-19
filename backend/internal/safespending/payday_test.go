package safespending

import (
	"slices"
	"testing"

	"github.com/simhozebs/net-worth-estimator/backend/internal/domain"
	"github.com/simhozebs/net-worth-estimator/backend/internal/types"
)

const paydayCut = "2026-11-15T12:00:00Z"

func paydayFixture() (*types.FinancialModel, *types.SafeSpendingSettings) {
	model := baseModel()
	model.Checkpoints[0] = types.Checkpoint{AccountID: "checking", Balance: 900, AvailableBalance: ptr(900.0), ObservedAt: stamp("2026-11-14T20:00:00Z")}
	model.Accounts = append(model.Accounts,
		types.Account{ID: "card-a", Name: "Card A", Kind: types.AccountKindDebt, Enabled: true, StatementClosingDay: 19},
		types.Account{ID: "card-b", Name: "Card B", Kind: types.AccountKindDebt, Enabled: true, StatementClosingDay: 19},
	)
	model.Checkpoints = append(model.Checkpoints,
		types.Checkpoint{AccountID: "card-a", Balance: -500, ObservedAt: domain.DayCloseUnix("2026-10-19")},
		types.Checkpoint{AccountID: "card-b", Balance: -150, ObservedAt: domain.DayCloseUnix("2026-10-19")},
	)
	model.Schedules = []types.Schedule{
		bill("rent", "2026-11-20", 250),
		{ID: "salary", Name: "salary", Destinations: []string{"checking"}, Amount: fixed(400), Recurrence: types.Recurrence{Unit: types.RecurrenceMonth, Interval: 1, MonthlyMode: types.RecurrenceMonthlyByDate}, StartDate: "2026-11-30", Enabled: true},
	}
	settings := &types.SafeSpendingSettings{
		Reserve:            200,
		AccountIDs:         []string{"card-a", "card-b"},
		SpendingAccountIDs: []string{"checking"},
		IncomeScheduleIDs:  []string{"salary"},
		TransactionIDs:     []string{"rent"},
	}
	return model, settings
}

func TestPaydayAllowanceIsSmallerOfTwoCashChecks(t *testing.T) {
	model, settings := paydayFixture()
	summary := BuildAtCut(model, settings, stamp(paydayCut))
	if summary.CashAsOf != "2026-11-15" || summary.Payday == nil || *summary.Payday != "2026-11-30" {
		t.Fatalf("dated ledger %+v", summary)
	}
	assertMoney(t, summary.CheckingAvailable, 900)
	assertMoney(t, summary.ExpectedPay, 400)
	assertMoney(t, summary.PrePaydayBills, 250)
	assertMoney(t, summary.PaydayBills, 0)
	assertMoney(t, summary.StatementReserve, 650)
	assertMoney(t, summary.PrePaydayRoom, 450)
	assertMoney(t, summary.PostIncomeRoom, 200)
	assertMoney(t, summary.SafeToSpend, 200)
	if len(summary.Bills) != 1 || summary.Bills[0].Status != "unpaid" {
		t.Fatalf("dated bills %+v", summary.Bills)
	}
	if len(summary.Statements) != 4 {
		t.Fatalf("expected closed and estimated rows for both cards %+v", summary.Statements)
	}
	closed := map[string]float64{}
	for _, statement := range summary.Statements {
		if statement.Kind == "closed" && statement.Amount != nil {
			closed[statement.AccountID] = *statement.Amount
		}
		if statement.Kind == "estimated" && (statement.ClosingDate != "2026-11-19" || statement.Amount == nil || *statement.Amount != 0) {
			t.Fatalf("estimate %+v", statement)
		}
	}
	if closed["card-a"] != 500 || closed["card-b"] != 150 {
		t.Fatalf("closed statements %+v", closed)
	}
}

func TestPaydayObligationsDueOnPaydayAreSeparate(t *testing.T) {
	model, settings := paydayFixture()
	model.Schedules = append(model.Schedules, bill("payday-bill", "2026-11-30", 100))
	settings.TransactionIDs = []string{"rent", "payday-bill"}
	summary := BuildAtCut(model, settings, stamp(paydayCut))
	assertMoney(t, summary.PrePaydayBills, 250)
	assertMoney(t, summary.PaydayBills, 100)
	assertMoney(t, summary.PrePaydayRoom, 450)
	assertMoney(t, summary.PostIncomeRoom, 100)
	assertMoney(t, summary.SafeToSpend, 100)
}

func TestPlannedCardPaymentReducesPayoffOnce(t *testing.T) {
	model, settings := paydayFixture()
	minimum := bill("card-minimum", "2026-11-30", 150)
	minimum.Destinations = []string{"card-a"}
	model.Schedules = append(model.Schedules, minimum)
	settings.TransactionIDs = []string{"rent", "card-minimum"}
	summary := BuildAtCut(model, settings, stamp(paydayCut))
	assertMoney(t, summary.PrePaydayBills, 250)
	assertMoney(t, summary.PaydayBills, 150)
	assertMoney(t, summary.StatementReserve, 500)
	assertMoney(t, summary.PostIncomeRoom, 200)
	assertMoney(t, summary.SafeToSpend, 200)
	for _, statement := range summary.Statements {
		if statement.AccountID == "card-a" && statement.Kind == "closed" {
			assertMoney(t, statement.Amount, 350)
		}
	}
}

func TestClosingDayThirtyOneClampsInShorterMonth(t *testing.T) {
	model, settings := paydayFixture()
	for i := range model.Accounts {
		if model.Accounts[i].ID == "card-a" {
			model.Accounts[i].StatementClosingDay = 31
		}
	}
	summary := BuildAtCut(model, settings, stamp(paydayCut))
	dates := []string{}
	for _, statement := range summary.Statements {
		if statement.AccountID == "card-a" {
			dates = append(dates, statement.ClosingDate)
		}
	}
	if !slices.Equal(dates, []string{"2026-10-31", "2026-11-30"}) {
		t.Fatalf("clamped closing dates %v", dates)
	}
}

func TestCardPaymentReducesCashAndPayoffOnce(t *testing.T) {
	model, settings := paydayFixture()
	settlement := payment("card-payment", 200, "2026-11-14T21:00:00Z")
	settlement.Destinations = []string{"card-a"}
	model.Transactions = []types.Transaction{settlement}
	summary := BuildAtCut(model, settings, stamp(paydayCut))
	assertMoney(t, summary.CheckingAvailable, 700)
	assertMoney(t, summary.StatementReserve, 450)
	assertMoney(t, summary.PrePaydayRoom, 250)
	assertMoney(t, summary.PostIncomeRoom, 200)
	assertMoney(t, summary.SafeToSpend, 200)
	for _, statement := range summary.Statements {
		if statement.AccountID == "card-a" && statement.Kind == "closed" {
			assertMoney(t, statement.Amount, 300)
		}
	}
}

func TestScheduledCardChargeBelongsToStatementEstimateNotCashBills(t *testing.T) {
	model, settings := paydayFixture()
	charge := bill("card-charge", "2026-11-10", 75)
	charge.SourceAccountID = ptr("card-a")
	model.Schedules = append(model.Schedules, charge)
	summary := BuildAtCut(model, settings, stamp(paydayCut))
	assertMoney(t, summary.StatementReserve, 725)
	if len(summary.Bills) != 1 || summary.Bills[0].ScheduleID == nil || *summary.Bills[0].ScheduleID != "rent" {
		t.Fatalf("card charge entered cash bills %+v", summary.Bills)
	}
	for _, statement := range summary.Statements {
		if statement.AccountID == "card-a" && statement.Kind == "estimated" {
			assertMoney(t, statement.Amount, 75)
		}
	}
}

func TestUncertainStatementBalanceLeavesRoomsUnknownButShowsObligations(t *testing.T) {
	model, settings := paydayFixture()
	model.Checkpoints = model.Checkpoints[:2] // drop card-b's closing observation
	summary := BuildAtCut(model, settings, stamp(paydayCut))
	if !slices.Contains(summary.Reasons, ReasonStatementBalanceUnavailable) {
		t.Fatalf("missing reason %+v", summary.Reasons)
	}
	if summary.StatementReserve != nil || summary.PostIncomeRoom != nil || summary.SafeToSpend != nil {
		t.Fatalf("uncertain statement produced precise allowance %+v", summary)
	}
	assertMoney(t, summary.PrePaydayBills, 250)
	assertMoney(t, summary.PrePaydayRoom, 450)
	if len(summary.Bills) != 1 || len(summary.Statements) != 4 {
		t.Fatalf("known obligations hidden %+v %+v", summary.Bills, summary.Statements)
	}
	for _, statement := range summary.Statements {
		if statement.AccountID == "card-b" && statement.Kind == "closed" && statement.Amount != nil {
			t.Fatal("purchases invented a historical statement balance")
		}
	}
}

func statementAmount(t *testing.T, summary types.SafeSpendingSummary, accountID, kind, closingDate string) *float64 {
	t.Helper()
	for _, statement := range summary.Statements {
		if statement.AccountID == accountID && statement.Kind == kind && statement.ClosingDate == closingDate {
			return statement.Amount
		}
	}
	t.Fatalf("statement %s %s %s missing in %+v", accountID, kind, closingDate, summary.Statements)
	return nil
}

func TestClosedStatementReplaysChargesBetweenCheckpointAndClose(t *testing.T) {
	model, settings := paydayFixture()
	for i := range model.Checkpoints {
		if model.Checkpoints[i].AccountID == "card-a" {
			model.Checkpoints[i].ObservedAt = domain.DayCloseUnix("2026-10-01")
		}
	}
	charge := payment("card-purchase", 150, "2026-10-10T10:00:00Z")
	charge.SourceAccountID = ptr("card-a")
	charge.Destinations = nil
	model.Transactions = []types.Transaction{charge}
	summary := BuildAtCut(model, settings, stamp(paydayCut))
	assertMoney(t, statementAmount(t, summary, "card-a", "closed", "2026-10-19"), 650)
	assertMoney(t, summary.StatementReserve, 800)
}

func TestCloseDayObservationAfterCutIsNotEvidence(t *testing.T) {
	model, settings := paydayFixture()
	model.Checkpoints = append(model.Checkpoints, types.Checkpoint{AccountID: "card-a", Balance: -9999, ObservedAt: stamp("2026-11-19T20:00:00Z")})
	summary := BuildAtCut(model, settings, stamp("2026-11-19T12:00:00Z"))
	for _, statement := range summary.Statements {
		if statement.Amount != nil && *statement.Amount == 9999 {
			t.Fatalf("observation after cut used as statement balance %+v", statement)
		}
		if statement.ClosingDate == "2026-11-19" && statement.Kind != "estimated" {
			t.Fatalf("close day before cut ended treated as closed %+v", statement)
		}
	}
}

func TestStatementEstimateIncludesRecordedActivityAndDedupesClaims(t *testing.T) {
	model, settings := paydayFixture()
	purchase := payment("unscheduled-purchase", 75, "2026-11-10T10:00:00Z")
	purchase.SourceAccountID = ptr("card-a")
	purchase.Destinations = nil
	scheduled := bill("scheduled-charge", "2026-11-12", 50)
	scheduled.SourceAccountID = ptr("card-a")
	claimed := payment("claimed-charge", 50, "2026-11-12T10:00:00Z")
	claimed.SourceAccountID = ptr("card-a")
	claimed.Destinations = nil
	claimed.Claim = &types.TransactionClaim{ScheduleID: "scheduled-charge", OccurrenceDate: "2026-11-12"}
	refund := payment("refund", 25, "2026-11-14T10:00:00Z")
	refund.SourceAccountID = nil
	refund.Destinations = []string{"card-a"}
	model.Transactions = []types.Transaction{purchase, claimed, refund}
	model.Schedules = append(model.Schedules, scheduled)
	summary := BuildAtCut(model, settings, stamp(paydayCut))
	assertMoney(t, statementAmount(t, summary, "card-a", "estimated", "2026-11-19"), 100)
	assertMoney(t, summary.StatementReserve, 750)
	for _, bill := range summary.Bills {
		if bill.ScheduleID != nil && *bill.ScheduleID == "scheduled-charge" {
			t.Fatalf("card charge entered cash bills %+v", bill)
		}
	}
}

func TestRefundBeforeChargeInUnorderedRowsGivesSameNet(t *testing.T) {
	model, settings := paydayFixture()
	charge := payment("late-purchase", 75, "2026-11-10T10:00:00Z")
	charge.SourceAccountID = ptr("card-a")
	charge.Destinations = nil
	refund := payment("early-refund", 25, "2026-11-14T10:00:00Z")
	refund.SourceAccountID = nil
	refund.Destinations = []string{"card-a"}
	model.Transactions = []types.Transaction{refund, charge}
	summary := BuildAtCut(model, settings, stamp(paydayCut))
	assertMoney(t, statementAmount(t, summary, "card-a", "estimated", "2026-11-19"), 50)
	assertMoney(t, summary.StatementReserve, 700)
}

func TestExcessPlannedPaymentCarriesToNewerStatement(t *testing.T) {
	model, settings := paydayFixture()
	settings.AccountIDs = []string{"card-a"}
	settings.TransactionIDs = []string{"rent", "card-payment"}
	for i := range model.Checkpoints {
		if model.Checkpoints[i].AccountID == "card-a" {
			model.Checkpoints[i].Balance = -100
		}
	}
	purchase := payment("new-charge", 80, "2026-11-10T10:00:00Z")
	purchase.SourceAccountID = ptr("card-a")
	purchase.Destinations = nil
	paymentRule := bill("card-payment", "2026-11-30", 150)
	paymentRule.Destinations = []string{"card-a"}
	model.Transactions = []types.Transaction{purchase}
	model.Schedules = append(model.Schedules, paymentRule)
	summary := BuildAtCut(model, settings, stamp(paydayCut))
	assertMoney(t, statementAmount(t, summary, "card-a", "closed", "2026-10-19"), 0)
	assertMoney(t, statementAmount(t, summary, "card-a", "estimated", "2026-11-19"), 30)
	assertMoney(t, summary.StatementReserve, 30)
	assertMoney(t, summary.PaydayBills, 150)
}

func TestPaymentFromUnselectedCashAccountSettlesDebt(t *testing.T) {
	model, settings := paydayFixture()
	model.Accounts = append(model.Accounts, types.Account{ID: "savings", Name: "Savings", Kind: types.AccountKindCash, Enabled: true})
	model.Checkpoints = append(model.Checkpoints, types.Checkpoint{AccountID: "savings", Balance: 1000, AvailableBalance: ptr(1000.0), ObservedAt: stamp("2026-11-14T20:00:00Z")})
	settlement := payment("savings-payment", 200, "2026-11-14T21:00:00Z")
	settlement.SourceAccountID = ptr("savings")
	settlement.Destinations = []string{"card-a"}
	model.Transactions = []types.Transaction{settlement}
	summary := BuildAtCut(model, settings, stamp(paydayCut))
	assertMoney(t, statementAmount(t, summary, "card-a", "closed", "2026-10-19"), 300)
}

func TestSplitRoutingLeavesStatementPayoffUnavailable(t *testing.T) {
	model, settings := paydayFixture()
	split := payment("split", 200, "2026-11-14T21:00:00Z")
	split.Destinations = []string{"card-a", "card-b"}
	model.Transactions = []types.Transaction{split}
	summary := BuildAtCut(model, settings, stamp(paydayCut))
	if summary.StatementReserve != nil {
		t.Fatalf("ambiguous routing produced a precise payoff %+v", summary.Statements)
	}
}

func TestEveryStatementCloseThroughPaydayIsCounted(t *testing.T) {
	model, settings := paydayFixture()
	for i := range model.Schedules {
		if model.Schedules[i].ID == "salary" {
			model.Schedules[i].StartDate = "2027-02-28"
		}
	}
	summary := BuildAtCut(model, settings, stamp(paydayCut))
	if len(summary.Statements) != 10 {
		t.Fatalf("expected five closes per card %+v", summary.Statements)
	}
	closed := 0
	for _, statement := range summary.Statements {
		if statement.Kind == "closed" {
			closed++
		}
	}
	if closed != 2 {
		t.Fatalf("closed rows = %d, want 2", closed)
	}
	assertMoney(t, statementAmount(t, summary, "card-a", "closed", "2026-10-19"), 500)
	assertMoney(t, summary.StatementReserve, 650)
}

func TestSelectedDebtAccountNeedsNoPaymentTerms(t *testing.T) {
	model, settings := paydayFixture()
	model.PaymentTerms = nil
	settings.AccountIDs = []string{"card-a"}
	summary := BuildAtCut(model, settings, stamp(paydayCut))
	assertMoney(t, summary.StatementReserve, 500)
	if len(summary.Statements) != 2 {
		t.Fatalf("card without terms produced no ledger %+v", summary.Statements)
	}
	for i := range model.Accounts {
		if model.Accounts[i].ID == "card-a" {
			model.Accounts[i].StatementClosingDay = 0
		}
	}
	summary = BuildAtCut(model, settings, stamp(paydayCut))
	if dates := []string{summary.Statements[0].ClosingDate, summary.Statements[1].ClosingDate}; dates[0] != "2026-10-19" || dates[1] != "2026-11-19" {
		t.Fatalf("default closing day not applied %v", dates)
	}
}

func TestNullCardSelectionPrefersCardSuffix(t *testing.T) {
	model, settings := paydayFixture()
	settings.AccountIDs = nil
	model.Accounts = append(model.Accounts, types.Account{ID: "prime_card", Name: "Prime", Kind: types.AccountKindDebt, Enabled: true, StatementClosingDay: 19})
	model.Checkpoints = append(model.Checkpoints, types.Checkpoint{AccountID: "prime_card", Balance: -50, ObservedAt: domain.DayCloseUnix("2026-10-19")})
	summary := BuildAtCut(model, settings, stamp(paydayCut))
	for _, statement := range summary.Statements {
		if statement.AccountID != "prime_card" {
			t.Fatalf("null selection ignored the card suffix %+v", summary.Statements)
		}
	}
	assertMoney(t, summary.StatementReserve, 50)
}

func TestCardSelectionDistinguishesNullFromEmpty(t *testing.T) {
	model, settings := paydayFixture()
	settings.AccountIDs = []string{}
	summary := BuildAtCut(model, settings, stamp(paydayCut))
	if len(summary.Statements) != 0 {
		t.Fatalf("empty selection selected all cards %+v", summary.Statements)
	}
	assertMoney(t, summary.StatementReserve, 0)
	settings.AccountIDs = []string{"missing"}
	summary = BuildAtCut(model, settings, stamp(paydayCut))
	if len(summary.Statements) != 0 {
		t.Fatalf("stale selection selected cards %+v", summary.Statements)
	}
	settings.AccountIDs = nil
	summary = BuildAtCut(model, settings, stamp(paydayCut))
	if len(summary.Statements) != 4 {
		t.Fatalf("null selection did not select all cards %+v", summary.Statements)
	}
}

func TestPaydayRequiresInflowIntoSelectedCash(t *testing.T) {
	model, settings := paydayFixture()
	for i := range model.Schedules {
		if model.Schedules[i].ID == "salary" {
			model.Schedules[i].SourceAccountID = ptr("checking")
			model.Schedules[i].Destinations = nil
		}
	}
	summary := BuildAtCut(model, settings, stamp(paydayCut))
	if summary.Payday != nil || summary.SafeToSpend != nil {
		t.Fatalf("outflow treated as payday %+v", summary)
	}
	model.Schedules[1].SourceAccountID = nil
	model.Schedules[1].Destinations = []string{"card-a"}
	summary = BuildAtCut(model, settings, stamp(paydayCut))
	if summary.Payday != nil {
		t.Fatalf("inflow to a card treated as payday %+v", summary)
	}
}

func TestSameDayPayCountsUnlessPostedClaimSettlesIt(t *testing.T) {
	model, settings := paydayFixture()
	for i := range model.Schedules {
		if model.Schedules[i].ID == "salary" {
			model.Schedules[i].StartDate = "2026-11-15"
		}
	}
	summary := BuildAtCut(model, settings, stamp(paydayCut))
	if summary.Payday == nil || *summary.Payday != "2026-11-15" {
		t.Fatalf("unposted same-day pay ignored %+v", summary)
	}
	paycheck := payment("paycheck", 400, "2026-11-15T09:00:00Z")
	paycheck.SourceAccountID = nil
	paycheck.Destinations = []string{"checking"}
	paycheck.Claim = &types.TransactionClaim{ScheduleID: "salary", OccurrenceDate: "2026-11-15"}
	model.Transactions = []types.Transaction{paycheck}
	summary = BuildAtCut(model, settings, stamp(paydayCut))
	if summary.Payday == nil || *summary.Payday != "2026-12-15" {
		t.Fatalf("posted claim did not advance payday %+v", summary)
	}
}

func TestPendingIncomeClaimLeavesExpectedPayUnknown(t *testing.T) {
	model, settings := paydayFixture()
	paycheck := payment("pending-paycheck", 400, "2026-11-15T09:00:00Z")
	paycheck.Pending = true
	paycheck.SourceAccountID = nil
	paycheck.Destinations = []string{"checking"}
	paycheck.Claim = &types.TransactionClaim{ScheduleID: "salary", OccurrenceDate: "2026-11-30"}
	model.Transactions = []types.Transaction{paycheck}
	summary := BuildAtCut(model, settings, stamp(paydayCut))
	if summary.Payday == nil || *summary.Payday != "2026-11-30" || summary.ExpectedPay != nil || summary.SafeToSpend != nil {
		t.Fatalf("pending pay became precise %+v", summary)
	}
}

func TestUnrelatedUnresolvedMovementDoesNotHideStatementPayoff(t *testing.T) {
	model, settings := paydayFixture()
	model.Accounts = append(model.Accounts, types.Account{ID: "loan-other", Kind: types.AccountKindDebt, Enabled: true})
	model.Checkpoints = append(model.Checkpoints, types.Checkpoint{AccountID: "loan-other", Balance: -100, ObservedAt: stamp("2026-11-14T20:00:00Z")})
	unresolved := payment("unrelated", 0, "2026-11-14T21:00:00Z")
	unresolved.SourceAccountID = ptr("loan-other")
	unresolved.Destinations = nil
	unresolved.Amount = types.TransactionAmountResolution{Resolver: "expression", Config: map[string]any{"expression": "balance * .1"}, Inputs: map[string]types.AmountInputBinding{"balance": {Source: "provider", Provider: "account-balance", Arguments: map[string]any{"id": "loan-other"}}}}
	model.Transactions = []types.Transaction{unresolved}
	summary := BuildAtCut(model, settings, stamp(paydayCut))
	assertMoney(t, summary.StatementReserve, 650)
	assertMoney(t, statementAmount(t, summary, "card-a", "closed", "2026-10-19"), 500)
}

func TestNoIncomeKeepsDatedObligationsButNoAllowance(t *testing.T) {
	model, settings := paydayFixture()
	settings.IncomeScheduleIDs = nil
	summary := BuildAtCut(model, settings, stamp(paydayCut))
	if summary.Payday != nil || summary.ExpectedPay != nil || summary.PrePaydayBills != nil || summary.PrePaydayRoom != nil || summary.PostIncomeRoom != nil || summary.SafeToSpend != nil {
		t.Fatalf("missing payday invented an allowance %+v", summary)
	}
	if !slices.Contains(summary.Reasons, ReasonPaydayUnavailable) {
		t.Fatalf("missing reason %+v", summary.Reasons)
	}
	if len(summary.Bills) == 0 || summary.Bills[0].Date != "2026-11-20" {
		t.Fatalf("known obligations hidden %+v", summary.Bills)
	}
}
