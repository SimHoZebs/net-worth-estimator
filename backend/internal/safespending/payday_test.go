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
		types.Account{ID: "card-a", Name: "Card A", Kind: types.AccountKindCreditCard, Enabled: true, StatementClosingDay: 19},
		types.Account{ID: "card-b", Name: "Card B", Kind: types.AccountKindCreditCard, Enabled: true, StatementClosingDay: 19},
	)
	model.Checkpoints = append(model.Checkpoints,
		types.Checkpoint{AccountID: "card-a", Balance: -500, ObservedAt: domain.DayCloseUnix("2026-10-19")},
		types.Checkpoint{AccountID: "card-b", Balance: -150, ObservedAt: domain.DayCloseUnix("2026-10-19")},
	)
	model.Schedules = []types.Schedule{
		bill("rent", "2026-11-20", 250),
		{ID: "salary", Name: "salary", Destinations: []string{"checking"}, Amount: fixed(400), Recurrence: types.Recurrence{Unit: types.RecurrenceMonth, Interval: 1, MonthlyMode: types.RecurrenceMonthlyByDate}, StartDate: "2026-11-30", Enabled: true},
	}
	model.Schedules[0].EndDate = ptr("2026-11-20")
	settings := &types.SafeSpendingSettings{
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
	assertMoney(t, summary.PrePaydayRoom, 650)
	assertMoney(t, summary.PostIncomeRoom, 400)
	assertMoney(t, summary.SafeToSpend, 400)
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
	assertMoney(t, summary.PrePaydayRoom, 650)
	assertMoney(t, summary.PostIncomeRoom, 300)
	assertMoney(t, summary.SafeToSpend, 300)
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
	assertMoney(t, summary.PostIncomeRoom, 400)
	assertMoney(t, summary.SafeToSpend, 400)
	for _, statement := range summary.Statements {
		if statement.AccountID == "card-a" && statement.Kind == "closed" {
			assertMoney(t, statement.Amount, 350)
		}
	}
}

func TestScheduledSplitCardPaymentCannotSettleBothCards(t *testing.T) {
	model, settings := paydayFixture()
	split := bill("split-card-payment", "2026-11-21", 150)
	split.Destinations = []string{"card-a", "card-b"}
	model.Schedules = append(model.Schedules, split)
	settings.TransactionIDs = append(settings.TransactionIDs, split.ID)
	s := BuildAtCut(model, settings, stamp(paydayCut))
	assertMoney(t, s.PrePaydayBills, 400)
	if s.StatementReserve != nil || s.SafeToSpend != nil {
		t.Fatalf("unallocated split was deducted from both cards: %+v", s)
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
	if !slices.Equal(dates, []string{"2026-10-31"}) {
		t.Fatalf("clamped closing dates %v", dates)
	}
	settings.PaydayDay = 1
	summary = BuildAtCut(model, settings, stamp(paydayCut))
	assertMoney(t, statementAmount(t, summary, "card-a", "estimated", "2026-11-30"), 0)
}

func TestCardPaymentReducesCashAndPayoffOnce(t *testing.T) {
	model, settings := paydayFixture()
	settlement := payment("card-payment", 200, "2026-11-14T21:00:00Z")
	settlement.Destinations = []string{"card-a"}
	model.Transactions = []types.Transaction{settlement}
	summary := BuildAtCut(model, settings, stamp(paydayCut))
	assertMoney(t, summary.CheckingAvailable, 700)
	assertMoney(t, summary.StatementReserve, 450)
	assertMoney(t, summary.PaidByPayday, 0)
	assertMoney(t, summary.UnpaidByPayday, 250)
	if len(summary.Bills) != 1 || summary.Bills[0].ID != "schedule:rent:2026-11-20" {
		t.Fatalf("card repayment entered the bill detail: %+v", summary.Bills)
	}
	assertMoney(t, summary.PrePaydayRoom, 450)
	assertMoney(t, summary.PostIncomeRoom, 400)
	assertMoney(t, summary.SafeToSpend, 400)
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
	assertMoney(t, summary.PrePaydayRoom, 650)
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

func TestClosedStatementAppliesChargesBetweenCheckpointAndClose(t *testing.T) {
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

func TestEveryStatementCloseBeforeConfiguredPayoffIsCounted(t *testing.T) {
	model, settings := paydayFixture()
	for i := range model.Schedules {
		if model.Schedules[i].ID == "salary" {
			model.Schedules[i].StartDate = "2027-02-28"
		}
	}
	summary := BuildAtCut(model, settings, stamp(paydayCut))
	if summary.Payday == nil || *summary.Payday != "2027-02-28" || summary.PayoffDate != "2026-11-30" || len(summary.Statements) != 4 {
		t.Fatalf("expected two closes per card before the configured payoff despite later income: %+v", summary)
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

func TestNullCardSelectionUsesDeclaredCreditCards(t *testing.T) {
	model, settings := paydayFixture()
	settings.AccountIDs = nil
	model.Accounts = append(model.Accounts,
		types.Account{ID: "prime_card", Name: "Prime", Kind: types.AccountKindCreditCard, Enabled: true, StatementClosingDay: 19},
		types.Account{ID: "loan-other", Kind: types.AccountKindDebt, Enabled: true},
	)
	model.Checkpoints = append(model.Checkpoints, types.Checkpoint{AccountID: "prime_card", Balance: -50, ObservedAt: domain.DayCloseUnix("2026-10-19")})
	summary := BuildAtCut(model, settings, stamp(paydayCut))
	// A null selection tracks every declared credit card and nothing else:
	// no _card suffix heuristic and no generic debt fallback.
	want := map[string]bool{"card-a": true, "card-b": true, "prime_card": true}
	seen := map[string]bool{}
	for _, statement := range summary.Statements {
		if !want[statement.AccountID] {
			t.Fatalf("null selection included a non-card %+v", statement)
		}
		seen[statement.AccountID] = true
	}
	for id := range want {
		if !seen[id] {
			t.Fatalf("null selection missed declared card %s", id)
		}
	}
	assertMoney(t, summary.StatementReserve, 700)
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

func TestExplicitSelectionRequiresDeclaredCreditCard(t *testing.T) {
	model, settings := paydayFixture()
	// An explicitly selected account is tracked only when it is declared a
	// credit card. A neutral cash label or an unrelated loan is not tracked,
	// mirroring the frontend's declared-card picker.
	model.Accounts = append(model.Accounts,
		types.Account{ID: "synced_card", Name: "Synced card", Kind: types.AccountKindCreditCard,
			Enabled: true, StatementClosingDay: 19},
		types.Account{ID: "cash_account", Kind: types.AccountKindCash, Enabled: true},
	)
	model.Checkpoints = append(model.Checkpoints, types.Checkpoint{
		AccountID: "synced_card", Balance: -75,
		ObservedAt: domain.DayCloseUnix("2026-10-19"),
	})
	settings.AccountIDs = []string{"synced_card", "cash_account"}
	summary := BuildAtCut(model, settings, stamp(paydayCut))
	if len(summary.Statements) == 0 {
		t.Fatalf("explicit declared card produced no statements %+v", summary)
	}
	for _, statement := range summary.Statements {
		if statement.AccountID != "synced_card" {
			t.Fatalf("explicit selection included an account that is not a declared card %+v", statement)
		}
	}
}

func TestCardToCardTransferFollowsBalanceApplication(t *testing.T) {
	model, settings := paydayFixture()
	// Two explicitly tracked declared credit cards. Their kind must not change
	// which leg is a charge and which a payment.
	model.Accounts = append(model.Accounts,
		types.Account{ID: "cash-card-x", Name: "Card X", Kind: types.AccountKindCreditCard, Enabled: true, StatementClosingDay: 19},
		types.Account{ID: "cash-card-y", Name: "Card Y", Kind: types.AccountKindCreditCard, Enabled: true, StatementClosingDay: 19},
	)
	closeAt := domain.DayCloseUnix("2026-10-19")
	model.Checkpoints = append(model.Checkpoints,
		types.Checkpoint{AccountID: "cash-card-x", Balance: -100, ObservedAt: closeAt},
		types.Checkpoint{AccountID: "cash-card-y", Balance: -100, ObservedAt: closeAt},
	)
	transferAt := stamp("2026-11-01T12:00:00Z")
	model.Transactions = append(model.Transactions, types.Transaction{
		ID: "card-to-card", Name: "card transfer",
		SourceAccountID: ptr("cash-card-x"), Destinations: []string{"cash-card-y"},
		Amount: fixed(100), TransactionTime: transferAt, PostedTime: transferAt,
		Enabled: true, Source: "user",
	})
	settings.AccountIDs = []string{"cash-card-x", "cash-card-y"}
	summary := BuildAtCut(model, settings, stamp(paydayCut))
	// cashDelta takes 100 from the source balance and adds 100 to the
	// destination. With debt = max(0, -balance) the source owes 200 and the
	// destination is paid off, so both statements follow the applied balances.
	assertMoney(t, statementAmount(t, summary, "cash-card-x", "closed", "2026-10-19"), 100)
	assertMoney(t, statementAmount(t, summary, "cash-card-x", "estimated", "2026-11-19"), 100)
	assertMoney(t, statementAmount(t, summary, "cash-card-y", "closed", "2026-10-19"), 0)
	assertMoney(t, summary.CheckingAvailable, 900)
	assertMoney(t, summary.StatementReserve, 200)
}

func statementTotal(t *testing.T, summary types.SafeSpendingSummary, accountID string) float64 {
	t.Helper()
	total := 0.0
	for _, statement := range summary.Statements {
		if statement.AccountID == accountID && statement.Amount != nil {
			total += *statement.Amount
		}
	}
	return total
}

func setCardCheckpoint(t *testing.T, model *types.FinancialModel, accountID string, balance float64, observedAt int64) {
	t.Helper()
	for i := range model.Checkpoints {
		if model.Checkpoints[i].AccountID == accountID {
			model.Checkpoints[i] = types.Checkpoint{AccountID: accountID, Balance: balance, ObservedAt: observedAt}
			return
		}
	}
	t.Fatalf("checkpoint for %s missing", accountID)
}

func setCardClosingDay(t *testing.T, model *types.FinancialModel, accountID string, day int) {
	t.Helper()
	for i := range model.Accounts {
		if model.Accounts[i].ID == accountID {
			model.Accounts[i].StatementClosingDay = day
			return
		}
	}
	t.Fatalf("account %s missing", accountID)
}

func TestIntercardTransferAppliesDatedLegsWithoutCashOutflow(t *testing.T) {
	model, settings := paydayFixture()
	transferAt := stamp("2026-11-10T10:00:00Z")
	model.Transactions = []types.Transaction{{
		ID: "transfer", Name: "transfer", SourceAccountID: ptr("card-a"),
		Destinations: []string{"card-b"}, Amount: fixed(50),
		TransactionTime: transferAt, PostedTime: transferAt,
		Enabled: true, Source: "user",
	}}
	summary := BuildAtCut(model, settings, stamp(paydayCut))
	// cashDelta moves 50 from card A's balance to card B's. Card A owes 550
	// (500 closed plus a 50 charge on the 11-19 estimate) and card B owes 100
	// (150 closed less the 50 payment). Checking is untouched and the total
	// reserve is unchanged, so the internal move spends no cash.
	assertMoney(t, statementAmount(t, summary, "card-a", "closed", "2026-10-19"), 500)
	assertMoney(t, statementAmount(t, summary, "card-a", "estimated", "2026-11-19"), 50)
	assertMoney(t, statementAmount(t, summary, "card-b", "closed", "2026-10-19"), 100)
	// Independent check against history application: A's -500 balance falls to -550,
	// B's -150 rises to -100, and debt is max(0, -balance) on each card.
	if got := statementTotal(t, summary, "card-a"); got != 550 {
		t.Fatalf("card A payoff %v, want applied debt 550", got)
	}
	if got := statementTotal(t, summary, "card-b"); got != 100 {
		t.Fatalf("card B payoff %v, want applied debt 100", got)
	}
	assertMoney(t, summary.CheckingAvailable, 900)
	assertMoney(t, summary.StatementReserve, 650)
	assertMoney(t, summary.PrePaydayRoom, 650)
	if slices.Contains(summary.Reasons, ReasonStatementBalanceUnavailable) || slices.Contains(summary.Reasons, ReasonStatementEstimateUnavailable) {
		t.Fatalf("precise transfer produced an estimate reason %+v", summary.Reasons)
	}
}

func TestIntercardTransferAcrossDifferentCloseDates(t *testing.T) {
	model, settings := paydayFixture()
	// Card A closes on the 19th, so its 11-19 statement settles before the
	// 11-30 payday. Card B closes on the 5th, so its only in-window close is
	// 11-05 and the next one falls after payday.
	setCardClosingDay(t, model, "card-a", 19)
	setCardClosingDay(t, model, "card-b", 5)
	setCardCheckpoint(t, model, "card-a", -500, domain.DayCloseUnix("2026-10-19"))
	setCardCheckpoint(t, model, "card-b", -100, domain.DayCloseUnix("2026-11-05"))
	transferAt := stamp("2026-11-10T10:00:00Z")
	model.Transactions = []types.Transaction{{
		ID: "transfer", Name: "transfer", SourceAccountID: ptr("card-a"),
		Destinations: []string{"card-b"}, Amount: fixed(50),
		TransactionTime: transferAt, PostedTime: transferAt,
		Enabled: true, Source: "user",
	}}
	summary := BuildAtCut(model, settings, stamp(paydayCut))
	// History application takes 50 from A (debt 550 on 11-19) and adds 50 to B (debt 50
	// on 11-05). Both match max(0, -balance) after the transfer, and B has no
	// estimated row because its next close is past payday.
	assertMoney(t, statementAmount(t, summary, "card-a", "closed", "2026-10-19"), 500)
	assertMoney(t, statementAmount(t, summary, "card-a", "estimated", "2026-11-19"), 50)
	assertMoney(t, statementAmount(t, summary, "card-b", "closed", "2026-11-05"), 50)
	if got := statementTotal(t, summary, "card-a"); got != 550 {
		t.Fatalf("card A payoff %v, want applied debt 550", got)
	}
	if got := statementTotal(t, summary, "card-b"); got != 50 {
		t.Fatalf("card B payoff %v, want applied debt 50", got)
	}
	assertMoney(t, summary.CheckingAvailable, 900)
	assertMoney(t, summary.StatementReserve, 600)
	assertMoney(t, summary.PrePaydayRoom, 650)
	for _, statement := range summary.Statements {
		if statement.AccountID == "card-b" && statement.Kind == "estimated" {
			t.Fatalf("destination close after payday entered the reserve %+v", statement)
		}
	}
}

func TestScheduledIntercardTransferMatchesClaimedTransfer(t *testing.T) {
	model, settings := paydayFixture()
	model.Schedules = append(model.Schedules, types.Schedule{
		ID: "balance-transfer", Name: "balance transfer", SourceAccountID: ptr("card-a"),
		Destinations: []string{"card-b"}, Amount: fixed(50),
		Recurrence: types.Recurrence{Unit: types.RecurrenceMonth, Interval: 1, MonthlyMode: types.RecurrenceMonthlyByDate},
		StartDate:  "2026-11-10", Enabled: true,
	})
	projected := BuildAtCut(model, settings, stamp(paydayCut))
	assertMoney(t, statementAmount(t, projected, "card-a", "closed", "2026-10-19"), 500)
	assertMoney(t, statementAmount(t, projected, "card-a", "estimated", "2026-11-19"), 50)
	assertMoney(t, statementAmount(t, projected, "card-b", "closed", "2026-10-19"), 100)
	assertMoney(t, projected.StatementReserve, 650)

	claimed := payment("claimed-transfer", 50, "2026-11-10T10:00:00Z")
	claimed.SourceAccountID = ptr("card-a")
	claimed.Destinations = []string{"card-b"}
	claimed.Claim = &types.TransactionClaim{ScheduleID: "balance-transfer", OccurrenceDate: "2026-11-10"}
	model.Transactions = []types.Transaction{claimed}
	recorded := BuildAtCut(model, settings, stamp(paydayCut))
	assertMoney(t, statementAmount(t, recorded, "card-a", "closed", "2026-10-19"), 500)
	assertMoney(t, statementAmount(t, recorded, "card-a", "estimated", "2026-11-19"), 50)
	assertMoney(t, statementAmount(t, recorded, "card-b", "closed", "2026-10-19"), 100)
	assertMoney(t, recorded.StatementReserve, 650)
	assertMoney(t, recorded.PrePaydayRoom, 650)
}

func TestSplitIntercardTransferLeavesPayoffUnavailable(t *testing.T) {
	model, settings := paydayFixture()
	model.Accounts = append(model.Accounts, types.Account{ID: "card-c", Name: "Card C", Kind: types.AccountKindCreditCard, Enabled: true, StatementClosingDay: 19})
	model.Checkpoints = append(model.Checkpoints, types.Checkpoint{AccountID: "card-c", Balance: -75, ObservedAt: domain.DayCloseUnix("2026-10-19")})
	settings.AccountIDs = []string{"card-a", "card-b", "card-c"}
	transferAt := stamp("2026-11-10T10:00:00Z")
	model.Transactions = []types.Transaction{{
		ID: "split-transfer", Name: "split transfer", SourceAccountID: ptr("card-a"),
		Destinations: []string{"card-b", "card-c"}, Amount: fixed(50),
		TransactionTime: transferAt, PostedTime: transferAt,
		Enabled: true, Source: "user",
	}}
	summary := BuildAtCut(model, settings, stamp(paydayCut))
	if summary.StatementReserve != nil || summary.PostIncomeRoom != nil || summary.SafeToSpend != nil {
		t.Fatalf("unallocatable split produced a precise payoff %+v", summary)
	}
	assertMoney(t, summary.PrePaydayRoom, 650)
	if len(summary.Bills) != 1 || len(summary.Statements) == 0 {
		t.Fatalf("known obligations or statements hidden %+v %+v", summary.Bills, summary.Statements)
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
	if summary.Payday == nil || *summary.Payday != "2026-11-30" || summary.ExpectedPay != nil || summary.SafeToSpend != nil {
		t.Fatalf("outflow treated as payday %+v", summary)
	}
	model.Schedules[1].SourceAccountID = nil
	model.Schedules[1].Destinations = []string{"card-a"}
	summary = BuildAtCut(model, settings, stamp(paydayCut))
	if summary.ExpectedPay != nil || !slices.Contains(summary.Reasons, ReasonPaydayUnavailable) {
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
	if summary.Payday == nil || *summary.Payday != "2026-11-30" || summary.ExpectedPay != nil || summary.PostIncomeRoom != nil || summary.SafeToSpend != nil {
		t.Fatalf("missing payday invented an allowance %+v", summary)
	}
	assertMoney(t, summary.PrePaydayBills, 250)
	assertMoney(t, summary.PrePaydayRoom, 650)
	if !slices.Contains(summary.Reasons, ReasonPaydayUnavailable) {
		t.Fatalf("missing reason %+v", summary.Reasons)
	}
	if len(summary.Bills) == 0 || summary.Bills[0].Date != "2026-11-20" {
		t.Fatalf("known obligations hidden %+v", summary.Bills)
	}
}

// Synthetic regression for the evidence rule: an actual settles a bill only
// when it happened by the cut and claims that exact occurrence. A claim naming
// another cycle leaves the current occurrence expected. Only a posted settlement
// inside the payment window carries its own earlier occurrence into the ledger,
// where it bars that occurrence without settling the current one.
func TestBillSettlementRequiresExactClaimByEvidenceCut(t *testing.T) {
	for _, tc := range []struct {
		name      string
		claimDate string
		status    string
		preBills  float64
		billDates []string
		statuses  []string
	}{
		{name: "exact occurrence", claimDate: "2026-11-20", status: "paid", preBills: 0,
			billDates: []string{"2026-11-20"}, statuses: []string{"paid"}},
		{name: "wrong cycle", claimDate: "2026-10-20", status: "unpaid", preBills: 250,
			billDates: []string{"2026-10-20", "2026-11-20"}, statuses: []string{"paid", "unpaid"}},
	} {
		t.Run(tc.name, func(t *testing.T) {
			model, settings := paydayFixture()
			// The rule spans both cycles; the payment window starts 11-01.
			model.Schedules[0].StartDate = "2026-10-20"
			actual := payment("rent-actual", 250, "2026-11-14T19:00:00Z")
			actual.Claim = &types.TransactionClaim{ScheduleID: "rent", OccurrenceDate: tc.claimDate}
			model.Transactions = []types.Transaction{actual}

			summary := BuildAtCut(model, settings, stamp(paydayCut))
			dates := []string{}
			statuses := []string{}
			for _, row := range summary.Bills {
				dates = append(dates, row.Date)
				statuses = append(statuses, row.Status)
			}
			if !slices.Equal(dates, tc.billDates) || !slices.Equal(statuses, tc.statuses) {
				t.Fatalf("ledger %v / %v, want %v / %v", dates, statuses, tc.billDates, tc.statuses)
			}
			current := summary.Bills[len(summary.Bills)-1]
			if current.Status != tc.status {
				t.Fatalf("current status = %s, want %s: %+v", current.Status, tc.status, current)
			}
			if tc.status == "paid" {
				if current.TransactionID == nil || *current.TransactionID != actual.ID {
					t.Fatalf("settled bill lost its claim %+v", current)
				}
			} else if current.TransactionID != nil {
				t.Fatalf("wrong-cycle claim settled the bill %+v", current)
			}
			assertMoney(t, summary.CheckingAvailable, 900)
			assertMoney(t, summary.PrePaydayBills, tc.preBills)
		})
	}
}

// A real pending authorization claims its exact occurrence without a second
// cash deduction or a confirmed payment. Cash rules gate hold coverage.
func TestRealPendingClaimIsUnconfirmedAndCashRulesOwnTheHold(t *testing.T) {
	for _, afterObservation := range []bool{false, true} {
		t.Run(map[bool]string{false: "before-observation", true: "after-observation"}[afterObservation], func(t *testing.T) {
			model, settings := paydayFixture()
			model.Checkpoints[0].Balance = 1150
			at := "2026-11-14T19:00:00Z"
			if afterObservation {
				at = "2026-11-15T09:00:00Z"
			}
			hold := payment("rent-hold", 250, at)
			hold.Pending = true
			hold.Claim = &types.TransactionClaim{ScheduleID: "rent", OccurrenceDate: "2026-11-20"}
			model.Transactions = []types.Transaction{hold}

			summary := BuildAtCut(model, settings, stamp(paydayCut))
			if len(summary.Bills) != 1 || summary.Bills[0].Status != "pending" {
				t.Fatalf("pending claim lost its evidence %+v", summary.Bills)
			}
			assertMoney(t, summary.PaidByPayday, 0)
			assertMoney(t, summary.PrePaydayBills, 0)
			assertMoney(t, summary.PaydayBills, 0)
			if afterObservation {
				if summary.Status != "uncertain" || summary.CheckingAvailable != nil || summary.SafeToSpend != nil {
					t.Fatalf("uncovered hold wrongly presented as exact %+v", summary)
				}
			} else {
				if summary.Status != "available" {
					t.Fatalf("covered hold changed the gate %+v", summary)
				}
				assertMoney(t, summary.CheckingAvailable, 900)
				assertMoney(t, summary.PrePaydayRoom, 900)
			}
		})
	}
}

func TestPendingBillWithZeroOrInsufficientObservedHoldGapLeavesCashUnknown(t *testing.T) {
	for _, balance := range []float64{900, 1149} {
		model, settings := paydayFixture()
		model.Checkpoints[0].Balance = balance
		hold := payment("uncovered-hold", 250, "2026-11-14T19:00:00Z")
		hold.Pending = true
		hold.Claim = &types.TransactionClaim{ScheduleID: "rent", OccurrenceDate: "2026-11-20"}
		model.Transactions = []types.Transaction{hold}

		s := BuildAtCut(model, settings, stamp(paydayCut))
		if s.CheckingAvailable != nil || s.SafeToSpend != nil || !slices.Contains(s.Reasons, ReasonPendingHoldCoverageUnknown) {
			t.Fatalf("treated a hold without sufficient gap as free cash: %+v", s)
		}
		assertMoney(t, s.PaidByPayday, 0)
		assertMoney(t, s.UnpaidByPayday, 250)
	}
}

// Synthetic regression: an observation on the bill's own date neither confirms
// nor denies payment. The unclaimed bill stays expected, priced and deducted
// once, so the subtotal and the room before income stay available.
func TestSameDayObservationKeepsBillExpectedAndPriced(t *testing.T) {
	model, settings := paydayFixture()
	model.Schedules[0].StartDate = "2026-11-15"
	model.Checkpoints[0] = types.Checkpoint{AccountID: "checking", Balance: 900, AvailableBalance: ptr(900.0), ObservedAt: stamp("2026-11-15T08:00:00Z")}
	summary := BuildAtCut(model, settings, stamp(paydayCut))
	if len(summary.Bills) != 1 || summary.Bills[0].Status != "unpaid" {
		t.Fatalf("same-day observation changed the bill %+v", summary.Bills)
	}
	assertMoney(t, summary.Bills[0].Amount, 250)
	if summary.Status != "available" || len(summary.Reasons) != 0 {
		t.Fatalf("same-day observation made the allowance uncertain %+v", summary)
	}
	assertMoney(t, summary.CheckingAvailable, 900)
	assertMoney(t, summary.PrePaydayBills, 250)
	assertMoney(t, summary.PrePaydayRoom, 650)
	assertMoney(t, summary.PostIncomeRoom, 400)
	assertMoney(t, summary.SafeToSpend, 400)

	actual := payment("rent-actual", 250, "2026-11-15T09:00:00Z")
	actual.Claim = &types.TransactionClaim{ScheduleID: "rent", OccurrenceDate: "2026-11-15"}
	model.Transactions = []types.Transaction{actual}
	summary = BuildAtCut(model, settings, stamp(paydayCut))
	if len(summary.Bills) != 1 || summary.Bills[0].Status != "paid" || len(summary.Reasons) != 0 {
		t.Fatalf("claim did not settle the same-day bill %+v", summary)
	}
	assertMoney(t, summary.CheckingAvailable, 650)
	assertMoney(t, summary.PrePaydayBills, 0)
}

// Synthetic regression: a claimed bill keeps its ledger row and amount but is
// not deducted from cash a second time through the obligation subtotal.
func TestClaimedBillAmountIsNotDeductedTwice(t *testing.T) {
	model, settings := paydayFixture()
	base := BuildAtCut(model, settings, stamp(paydayCut))
	assertMoney(t, base.CheckingAvailable, 900)
	assertMoney(t, base.PrePaydayBills, 250)

	actual := payment("rent-actual", 250, "2026-11-14T19:00:00Z")
	actual.Claim = &types.TransactionClaim{ScheduleID: "rent", OccurrenceDate: "2026-11-20"}
	model.Transactions = []types.Transaction{actual}
	settled := BuildAtCut(model, settings, stamp(paydayCut))
	assertMoney(t, settled.CheckingAvailable, 900)
	assertMoney(t, settled.PrePaydayBills, 0)
	assertMoney(t, settled.PrePaydayRoom, 900)
	assertMoney(t, settled.PostIncomeRoom, 650)
	assertMoney(t, settled.SafeToSpend, 650)
	if len(settled.Bills) != 1 || settled.Bills[0].Status != "paid" || settled.Bills[0].Amount == nil || *settled.Bills[0].Amount != 250 {
		t.Fatalf("settled bill ledger %+v", settled.Bills)
	}
}

// The configured payoff window includes unclaimed earlier bills, even if
// one fell on a different selected paycheck date.
func TestPastDueBillInCurrentIncomeCycleIsCountedOnce(t *testing.T) {
	model, settings := paydayFixture()
	for i := range model.Schedules {
		if model.Schedules[i].ID == "salary" {
			// Income on the 1st: the previous cycle boundary is 11-01 and the
			// selected payday is 12-01, with today on 11-15.
			model.Schedules[i].StartDate = "2026-11-01"
		}
	}
	model.Schedules[0].StartDate = "2026-10-20"    // also has a 10-20 arrears occurrence
	boundary := bill("boundary", "2026-11-01", 90) // the prior payday itself
	boundary.EndDate = ptr("2026-11-01")
	model.Schedules = append(model.Schedules,
		boundary,
		bill("past-due", "2026-11-10", 120), // earlier in the current cycle
	)
	settings.TransactionIDs = []string{"rent", "boundary", "past-due"}

	summary := BuildAtCut(model, settings, stamp(paydayCut))
	if summary.Payday == nil || *summary.Payday != "2026-12-01" {
		t.Fatalf("payday %+v", summary.Payday)
	}
	dates := []string{}
	for _, row := range summary.Bills {
		dates = append(dates, row.Date)
	}
	if !slices.Equal(dates, []string{"2026-11-01", "2026-11-10", "2026-11-20"}) {
		t.Fatalf("payment window %v, want the unpaid bills since the prior configured payoff", dates)
	}
	for _, row := range summary.Bills {
		if row.Status != "unpaid" || row.Amount == nil {
			t.Fatalf("expected bill lost its price %+v", row)
		}
	}
	assertMoney(t, summary.Bills[0].Amount, 90)
	assertMoney(t, summary.CheckingAvailable, 900)
	assertMoney(t, summary.PrePaydayBills, 460)
	// The configured Nov 30 payoff also leaves cash before Dec 1 income.
	assertMoney(t, summary.PrePaydayRoom, -210)
}

// Annual income puts the previous payday exactly 12 months back. The inclusive
// lookback boundary keeps that cycle, so a bill that came due after it is still
// expected and counted while older arrears before it stay out.
func TestAnnualPaydayKeepsPastDueCurrentCycleBill(t *testing.T) {
	model, settings := paydayFixture()
	for i := range model.Schedules {
		if model.Schedules[i].ID == "salary" {
			model.Schedules[i].Recurrence = types.Recurrence{Unit: types.RecurrenceYear, Interval: 1}
			model.Schedules[i].StartDate = "2025-11-30"
		}
	}
	rent := &model.Schedules[0]
	rent.EndDate = ptr("2026-11-20") // one occurrence in the long annual cycle
	old := bill("old-arrears", "2025-11-20", 90)
	old.EndDate = ptr("2025-11-20") // before the 2025-11-30 boundary
	pastDue := bill("past-due", "2026-11-10", 120)
	pastDue.EndDate = ptr("2026-11-10")
	model.Schedules = append(model.Schedules, old, pastDue)
	settings.TransactionIDs = []string{"rent", "old-arrears", "past-due"}

	summary := BuildAtCut(model, settings, stamp(paydayCut))
	if summary.Payday == nil || *summary.Payday != "2026-11-30" {
		t.Fatalf("annual payday %+v", summary.Payday)
	}
	dates := []string{}
	for _, row := range summary.Bills {
		dates = append(dates, row.Date)
	}
	if !slices.Equal(dates, []string{"2026-11-10", "2026-11-20"}) {
		t.Fatalf("annual cycle window %v", dates)
	}
	assertMoney(t, summary.PrePaydayBills, 370)
	assertMoney(t, summary.PrePaydayRoom, 530)
}
