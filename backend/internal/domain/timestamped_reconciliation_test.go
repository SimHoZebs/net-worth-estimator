package domain

import (
	"encoding/json"
	"testing"
	"time"

	"github.com/simhozebs/net-worth-estimator/backend/internal/types"
)

func unixAt(day, hour int) int64 {
	return time.Date(2026, time.March, day, hour, 0, 0, 0, time.UTC).Unix()
}

func cashAccount(id string) types.Account {
	return types.Account{ID: id, Name: id, Kind: types.AccountKindCash, Enabled: true, Display: types.PassthroughDisplay(id, id)}
}

func expenseAmount(expression string) types.TransactionAmountResolution {
	return types.TransactionAmountResolution{Resolver: "expression", Config: map[string]any{"expression": expression}, Inputs: map[string]types.AmountInputBinding{}}
}

func observerFixture() *types.FinancialModel {
	account := "checking"
	return &types.FinancialModel{
		Accounts: []types.Account{cashAccount(account)},
		Checkpoints: []types.Checkpoint{
			{AccountID: account, Balance: 1000, Source: "banksync", ObservedAt: unixAt(10, 9)},
			{AccountID: account, Balance: 900, Source: "banksync", ObservedAt: unixAt(10, 15)},
		},
		Transactions: []types.Transaction{
			{ID: "manual", Name: "Expense", SourceAccountID: &account, Amount: expenseAmount("100"), TransactionTime: unixAt(10, 11), PostedTime: unixAt(10, 11), Enabled: true, Source: "user"},
		},
		Evaluations: types.EmptyEvaluationTables(),
	}
}

// 09:00 observation 1000 plus 11:00 manual -100 resolves to 900 at a noon cut.
func TestTimestampedSameDayObservationAndLaterActual(t *testing.T) {
	position, err := ResolveCurrentPosition(observerFixture(), "2026-03-10T12:00:00Z", types.ModelOverrides{})
	if err != nil {
		t.Fatal(err)
	}
	if got := position.Accounts[0].Balance; got != 900 {
		t.Fatalf("current balance = %v, want 900 (09:00 observed 1000, 11:00 actual -100)", got)
	}
	// At noon the 15:00 observation is still future: the observed side
	// carries the 09:00 anchor, separate from the adjusted 900.
	if position.Accounts[0].ObservedBalance == nil || *position.Accounts[0].ObservedBalance != 1000 {
		t.Fatalf("observed balance must be the 09:00 anchor 1000: %+v", position.Accounts[0])
	}
	if position.Accounts[0].ObservedAt == nil || *position.Accounts[0].ObservedAt != unixAt(10, 9) {
		t.Fatalf("observed timestamp must be the 09:00 instant: %+v", position.Accounts[0])
	}
}

// Later 15:00 observation 850 resets the account again with no provisional
// layer or derived reconciliation row.
func TestTimestampedLaterObservationAnchorsAgain(t *testing.T) {
	model := observerFixture()
	model.Checkpoints[1].Balance = 850
	applied, err := applyChronologicalHistory(model, "2026-03-10")
	if err != nil {
		t.Fatal(err)
	}
	if got := applied.state.Balances["checking"]; got != 850 {
		t.Fatalf("balance = %v, want 850", got)
	}
	if len(applied.snapshots) != 1 || applied.snapshots[0].Balances["checking"] != 850 {
		t.Fatalf("daily snapshot must sample the final reset: %+v", applied.snapshots)
	}
	if observed := applied.latestObserved["checking"]; observed.Balance != 850 || observed.ObservedAt != unixAt(10, 15) {
		t.Fatalf("latest observation = %+v, want the 15:00 reset", observed)
	}
}

// Yesterday's anchor plus today's 11:00 actual applies at a noon cut with
// no same-day observation.
func TestExactCutIncludesTodayAfterYesterdayAnchor(t *testing.T) {
	account := "checking"
	model := &types.FinancialModel{
		Accounts: []types.Account{cashAccount(account)},
		Checkpoints: []types.Checkpoint{
			{AccountID: account, Balance: 1000, Source: "banksync", ObservedAt: unixAt(9, 9)},
		},
		Transactions: []types.Transaction{
			{ID: "manual", Name: "Expense", SourceAccountID: &account, Amount: expenseAmount("100"), TransactionTime: unixAt(10, 11), PostedTime: unixAt(10, 11), Enabled: true, Source: "user"},
		},
		Evaluations: types.EmptyEvaluationTables(),
	}
	position, err := ResolveCurrentPosition(model, "2026-03-10T12:00:00Z", types.ModelOverrides{})
	if err != nil {
		t.Fatal(err)
	}
	if got := position.Accounts[0].Balance; got != 900 {
		t.Fatalf("11:00 actual after yesterday's anchor must affect 12:00 balance, got %v", got)
	}
}

// A day-close rule is absent at an intraday cut and executes exactly once
// in the continuation.
func TestDayCloseRuleAbsentAtIntradayCut(t *testing.T) {
	model := observerFixture()
	model.Checkpoints = model.Checkpoints[:1]
	model.Transactions = nil
	model.Schedules = []types.Schedule{
		{ID: "income", Name: "Income", Destinations: []string{"checking"}, Amount: expenseAmount("10"), Recurrence: monthlyTestRecurrence(), StartDate: "2026-03-10", Priority: 1, Enabled: true},
	}
	position, err := ResolveCurrentPosition(model, "2026-03-10T10:00:00Z", types.ModelOverrides{})
	if err != nil {
		t.Fatal(err)
	}
	if got := position.Accounts[0].Balance; got != 1000 {
		t.Fatalf("day-close rule must not execute by a 10:00 cut, got %v", got)
	}
	cut := unixAt(10, 10)
	settings := &types.ProjectionRuntimeSettings{FallbackProjectionStartDate: "2026-03-10", HorizonYears: 1, AsOfInstant: &cut}
	prepared, err := PrepareSimulationRequest(model, settings, types.ModelOverrides{}, nil)
	if err != nil {
		t.Fatal(err)
	}
	if got := prepared.Request.InitialState.Balances["checking"]; got != 1000 {
		t.Fatalf("projection baseline at the cut = %v, want 1000", got)
	}
	run, err := Simulate(prepared.Request)
	if err != nil {
		t.Fatal(err)
	}
	count := 0
	for _, event := range run.TransactionAttempts {
		if event.Origin.TransactionID == "income" && event.Date == "2026-03-10" {
			count++
		}
	}
	if count != 1 {
		t.Fatalf("day-close rule must simulate exactly once after an intraday cut, got %d", count)
	}
}

// An exact 00:00 actual is timed: it precedes the 09:00 observation
// rather than running at day-close.
func TestExactMidnightActualIsTimed(t *testing.T) {
	model := observerFixture()
	model.Checkpoints = model.Checkpoints[:1]
	model.Transactions[0].TransactionTime = unixAt(10, 0)
	model.Transactions[0].PostedTime = unixAt(10, 0)
	position, err := ResolveCurrentPosition(model, "2026-03-10T10:00:00Z", types.ModelOverrides{})
	if err != nil {
		t.Fatal(err)
	}
	if got := position.Accounts[0].Balance; got != 1000 {
		t.Fatalf("exact midnight actual must precede 09:00 observation rather than day-close, got %v", got)
	}
}

// Stored observations arrive out of order: chronology, not arrival,
// governs, and the backdated row is retained.
func TestTimestampedStaleObservationDoesNotRollBack(t *testing.T) {
	account := "checking"
	model := &types.FinancialModel{
		Accounts: []types.Account{cashAccount(account)},
		Checkpoints: []types.Checkpoint{
			{AccountID: account, Balance: 1000, Source: "user", ObservedAt: unixAt(10, 9)},
			{AccountID: account, Balance: 850, Source: "banksync", ObservedAt: unixAt(10, 15)},
			{AccountID: account, Balance: 5000, Source: "banksync", ObservedAt: unixAt(10, 10)},
		},
		Evaluations: types.EmptyEvaluationTables(),
	}
	applied, err := applyChronologicalHistory(model, "2026-03-10")
	if err != nil {
		t.Fatal(err)
	}
	if got := applied.state.Balances[account]; got != 850 {
		t.Fatalf("latest-instant anchor must win regardless of arrival order, got %v", got)
	}
	if len(applied.snapshots) != 1 || applied.snapshots[0].Balances[account] != 850 {
		t.Fatalf("stale arrival must not change the final daily snapshot: %+v", applied.snapshots)
	}
	if observed := applied.latestObserved[account]; observed.ObservedAt != unixAt(10, 15) || observed.Balance != 850 {
		t.Fatalf("latest observation = %+v, want the 15:00 reset", observed)
	}
}

// An observation at t includes events at t, transactions first on the tie.
func TestTimestampedTiePolicyTransactionsFirst(t *testing.T) {
	account := "checking"
	instant := unixAt(10, 9)
	model := &types.FinancialModel{
		Accounts: []types.Account{cashAccount(account)},
		Checkpoints: []types.Checkpoint{
			{AccountID: account, Balance: 1000, Source: "user", ObservedAt: instant},
		},
		Transactions: []types.Transaction{
			{ID: "at-tie", Name: "AtTie", SourceAccountID: &account, Amount: expenseAmount("100"), TransactionTime: instant, PostedTime: instant, Enabled: true, Source: "user"},
		},
		Evaluations: types.EmptyEvaluationTables(),
	}
	applied, err := applyChronologicalHistory(model, "2026-03-10")
	if err != nil {
		t.Fatal(err)
	}
	if got := applied.state.Balances[account]; got != 1000 {
		t.Fatalf("observation at t must reset after the tied transaction: got %v, want 1000", got)
	}
	if observed := applied.latestObserved[account]; observed.ObservedAt != instant || observed.Balance != 1000 {
		t.Fatalf("latest observation = %+v, want the tied reset", observed)
	}
}

// Owner-authored observations win only at the same instant.
func TestTimestampedOwnerWinsSameInstantOnly(t *testing.T) {
	account := "checking"
	instant := unixAt(10, 12)
	model := &types.FinancialModel{
		Accounts: []types.Account{cashAccount(account)},
		Checkpoints: []types.Checkpoint{
			{AccountID: account, Balance: 700, Source: "banksync", ObservedAt: instant},
			{AccountID: account, Balance: 800, Source: "user", ObservedAt: instant},
		},
		Evaluations: types.EmptyEvaluationTables(),
	}
	applied, err := applyChronologicalHistory(model, "2026-03-10")
	if err != nil {
		t.Fatal(err)
	}
	if got := applied.state.Balances[account]; got != 800 {
		t.Fatalf("owner observation must win at the same instant, got %v", got)
	}
}

// Transfer legs anchor independently per account; other-account effects
// are preserved.
func TestTransferLegsAnchorIndependently(t *testing.T) {
	a, b := "checking", "savings"
	source := a
	model := &types.FinancialModel{
		Accounts: []types.Account{cashAccount(a), cashAccount(b)},
		Checkpoints: []types.Checkpoint{
			{AccountID: a, Balance: 1000, Source: "user", ObservedAt: unixAt(10, 9)},
			{AccountID: b, Balance: 200, Source: "user", ObservedAt: unixAt(10, 9)},
			{AccountID: a, Balance: 1000, Source: "banksync", ObservedAt: unixAt(10, 12)},
		},
		Transactions: []types.Transaction{
			{ID: "transfer", Name: "Move", SourceAccountID: &source, Destinations: []string{b}, Amount: expenseAmount("50"), TransactionTime: unixAt(10, 11), PostedTime: unixAt(10, 11), Enabled: true, Source: "user"},
		},
		Evaluations: types.EmptyEvaluationTables(),
	}
	applied, err := applyChronologicalHistory(model, "2026-03-10")
	if err != nil {
		t.Fatal(err)
	}
	// A leg: 1000 - 50 executed, anchored back to 1000 by the bank.
	if got := applied.state.Balances[a]; got != 1000 {
		t.Fatalf("account A balance = %v, want the bank anchor 1000", got)
	}
	// B leg: the destination effect stands with no later anchor.
	if got := applied.state.Balances[b]; got != 250 {
		t.Fatalf("account B balance = %v, want 250", got)
	}
}

// Enabled alone decides execution: pending and void are stored provider
// lifecycle metadata, never independent execution gates. A lifecycle row
// with Enabled true executes like any actual; with Enabled false it stays
// out, as does an owner-disabled settled row. Holds both before the rows
// (exact 10:00 cut) and after them (day-close cut), in recorded-history application and
// in the forward simulation.
func TestEnabledAloneDecidesExecutionRegardlessOfLifecycle(t *testing.T) {
	account := "checking"
	source := account
	model := &types.FinancialModel{
		Accounts: []types.Account{cashAccount(account)},
		Checkpoints: []types.Checkpoint{
			{AccountID: account, Balance: 1000, Source: "user", ObservedAt: unixAt(10, 9)},
		},
		Transactions: []types.Transaction{
			{ID: "pending-disabled", Name: "PendingOff", SourceAccountID: &source, Amount: expenseAmount("100"), TransactionTime: unixAt(10, 11), PostedTime: unixAt(10, 11), Enabled: false, Source: "banksync", Pending: true},
			{ID: "pending-enabled", Name: "PendingOn", SourceAccountID: &source, Amount: expenseAmount("100"), TransactionTime: unixAt(10, 11), PostedTime: unixAt(10, 11), Enabled: true, Source: "banksync", Pending: true},
			{ID: "void-disabled", Name: "VoidOff", SourceAccountID: &source, Amount: expenseAmount("100"), TransactionTime: unixAt(10, 11), PostedTime: unixAt(10, 11), Enabled: false, Source: "banksync", Void: true},
			{ID: "void-enabled", Name: "VoidOn", SourceAccountID: &source, Amount: expenseAmount("100"), TransactionTime: unixAt(10, 11), PostedTime: unixAt(10, 11), Enabled: true, Source: "banksync", Void: true},
			{ID: "settled-disabled", Name: "SettledOff", SourceAccountID: &source, Amount: expenseAmount("100"), TransactionTime: unixAt(10, 11), PostedTime: unixAt(10, 11), Enabled: false, Source: "banksync"},
			{ID: "settled-enabled", Name: "SettledOn", SourceAccountID: &source, Amount: expenseAmount("100"), TransactionTime: unixAt(10, 11), PostedTime: unixAt(10, 11), Enabled: true, Source: "banksync"},
		},
		Evaluations: types.EmptyEvaluationTables(),
	}
	// Before the 11:00 rows: nothing executes at the exact 10:00 cut.
	beforeCut := unixAt(10, 10)
	position, err := ResolveCurrentPosition(model, "2026-03-10T10:00:00Z", types.ModelOverrides{})
	if err != nil {
		t.Fatal(err)
	}
	if got := position.Accounts[0].Balance; got != 1000 {
		t.Fatalf("exact cut before rows = %v, want 1000", got)
	}
	settings := &types.ProjectionRuntimeSettings{FallbackProjectionStartDate: "2026-03-10", HorizonYears: 1, AsOfInstant: &beforeCut}
	_, result, err := ProjectRawFinancialModel(model, settings, types.ModelOverrides{}, nil)
	if err != nil {
		t.Fatal(err)
	}
	if result.Summary.CurrentNetWorth != 1000 || result.Summary.FinalNetWorth != 700 {
		t.Fatalf("exact-cut projection before rows = %v/%v, want current 1000 (history excludes future rows) and final 700 (simulation runs the three enabled future rows)",
			result.Summary.CurrentNetWorth, result.Summary.FinalNetWorth)
	}
	// After the 11:00 rows: exactly the three Enabled rows execute, once
	// each, regardless of their pending/void flags.
	position, err = ResolveCurrentPosition(model, "2026-03-10", types.ModelOverrides{})
	if err != nil {
		t.Fatal(err)
	}
	if got := position.Accounts[0].Balance; got != 700 {
		t.Fatalf("day-close balance = %v, want 700 (three enabled rows at -100 each)", got)
	}
	_, result, err = ProjectRawFinancialModel(model,
		&types.ProjectionRuntimeSettings{FallbackProjectionStartDate: "2026-03-10", HorizonYears: 1},
		types.ModelOverrides{}, nil)
	if err != nil {
		t.Fatal(err)
	}
	if result.Summary.CurrentNetWorth != 700 || result.Summary.FinalNetWorth != 700 {
		t.Fatalf("day-close projection = %v/%v, want 700/700",
			result.Summary.CurrentNetWorth, result.Summary.FinalNetWorth)
	}
}

func TestPositionAndProjectionBaselineShareActualOnlyReset(t *testing.T) {
	account := "checking"
	model := observerFixture()
	position, err := ResolveCurrentPosition(model, "2026-03-10", types.ModelOverrides{})
	if err != nil {
		t.Fatal(err)
	}
	settings := &types.ProjectionRuntimeSettings{FallbackProjectionStartDate: "2026-03-10", HorizonYears: 1}
	prepared, err := PrepareSimulationRequest(model, settings, types.ModelOverrides{}, nil)
	if err != nil {
		t.Fatal(err)
	}
	if len(position.Accounts) != 1 || len(prepared.Request.InitialState.Balances) != 1 {
		t.Fatalf("unexpected account counts: %+v", position)
	}
	if position.Accounts[0].Balance != prepared.Request.InitialState.Balances[account] {
		t.Fatalf("position %v != projection baseline %v at the same cut",
			position.Accounts[0].Balance, prepared.Request.InitialState.Balances[account])
	}
	if position.Accounts[0].ObservedBalance == nil || *position.Accounts[0].ObservedBalance != 900 {
		t.Fatalf("position must carry the observed balance separately: %+v", position.Accounts[0])
	}
	if position.Accounts[0].ObservedAt == nil || *position.Accounts[0].ObservedAt != unixAt(10, 15) {
		t.Fatalf("position must carry the observation timestamp: %+v", position.Accounts[0])
	}
	_, projection, err := ProjectRawFinancialModel(model, settings, types.ModelOverrides{}, nil)
	if err != nil {
		t.Fatal(err)
	}
	if position.NetWorth != projection.Summary.CurrentNetWorth {
		t.Fatalf("position net worth %v != public summary %v", position.NetWorth, projection.Summary.CurrentNetWorth)
	}
}

// Exact-cut projection baseline, position, and account list agree, and the
// cut identity changes the cache key.
func TestExactCutProjectionAgreesWithPositionAndAccountList(t *testing.T) {
	account := "checking"
	model := observerFixture()
	model.Checkpoints = model.Checkpoints[:1]
	cut := "2026-03-10T10:00:00Z"
	position, err := ResolveCurrentPosition(model, cut, types.ModelOverrides{})
	if err != nil {
		t.Fatal(err)
	}
	instant := unixAt(10, 10)
	settings := &types.ProjectionRuntimeSettings{FallbackProjectionStartDate: "2026-03-10", HorizonYears: 1, AsOfInstant: &instant}
	prepared, err := PrepareSimulationRequest(model, settings, types.ModelOverrides{}, nil)
	if err != nil {
		t.Fatal(err)
	}
	if prepared.Request.InitialState.Balances[account] != position.Accounts[0].Balance {
		t.Fatalf("projection baseline %v != position %v at the same exact cut",
			prepared.Request.InitialState.Balances[account], position.Accounts[0].Balance)
	}
	run, err := Simulate(prepared.Request)
	if err != nil {
		t.Fatal(err)
	}
	manualMoves := 0
	for _, event := range run.TransactionAttempts {
		if event.Origin.TransactionID == "manual" {
			manualMoves++
			if event.Date != "2026-03-10" {
				t.Fatalf("afternoon actual must simulate on the start date, got %s", event.Date)
			}
		}
	}
	if manualMoves != 1 {
		t.Fatalf("11:00 actual simulated %d times, want exactly once", manualMoves)
	}
}

func TestExactCutSuppressesAppliedMorningInSimulation(t *testing.T) {
	account := "checking"
	model := &types.FinancialModel{
		Accounts: []types.Account{cashAccount(account)},
		Checkpoints: []types.Checkpoint{
			{AccountID: account, Balance: 1000, Source: "banksync", ObservedAt: unixAt(10, 9)},
		},
		Transactions: []types.Transaction{
			{ID: "morning", Name: "Morning", SourceAccountID: &account, Amount: expenseAmount("100"), TransactionTime: unixAt(10, 9) + 1800, PostedTime: unixAt(10, 9) + 1800, Enabled: true, Source: "user"},
			{ID: "afternoon", Name: "Afternoon", SourceAccountID: &account, Amount: expenseAmount("50"), TransactionTime: unixAt(10, 11), PostedTime: unixAt(10, 11), Enabled: true, Source: "user"},
		},
		Evaluations: types.EmptyEvaluationTables(),
	}
	cut := unixAt(10, 10)
	settings := &types.ProjectionRuntimeSettings{FallbackProjectionStartDate: "2026-03-10", HorizonYears: 1, AsOfInstant: &cut}
	prepared, err := PrepareSimulationRequest(model, settings, types.ModelOverrides{}, nil)
	if err != nil {
		t.Fatal(err)
	}
	if got := prepared.Request.InitialState.Balances[account]; got != 900 {
		t.Fatalf("baseline at 10:00 cut = %v, want 900 (09:00 anchor minus 09:30 actual)", got)
	}
	if prepared.Request.HistoryCutInstant != cut {
		t.Fatalf("simulation request must carry the history cut, got %v", prepared.Request.HistoryCutInstant)
	}
	position, err := ResolveCurrentPosition(model, "2026-03-10T10:00:00Z", types.ModelOverrides{})
	if err != nil {
		t.Fatal(err)
	}
	if position.Accounts[0].Balance != 900 {
		t.Fatalf("position at 10:00 cut = %v, want 900", position.Accounts[0].Balance)
	}
	run, err := Simulate(prepared.Request)
	if err != nil {
		t.Fatal(err)
	}
	counts := map[string]int{}
	for _, event := range run.TransactionAttempts {
		if event.Date == "2026-03-10" {
			counts[event.Origin.TransactionID]++
		}
	}
	if counts["morning"] != 0 || counts["afternoon"] != 1 {
		t.Fatalf("simulation must skip morning already applied and run afternoon once: %+v", counts)
	}
}

// Historical rules keep funding constraints while confirmed actuals move
// recorded amounts.
func TestHistoricalRulesKeepFundingClamps(t *testing.T) {
	account := "checking"
	floor := 0.0
	accountRow := cashAccount(account)
	accountRow.MinBalance = &floor
	cap := 150.0
	model := &types.FinancialModel{
		Accounts: []types.Account{accountRow},
		Checkpoints: []types.Checkpoint{
			{AccountID: account, Balance: 1000, Source: "user", ObservedAt: unixAt(10, 9)},
		},
		Schedules: []types.Schedule{
			{ID: "payout", Name: "Payout", SourceAccountID: &account, Amount: expenseAmount("100"), Recurrence: monthlyTestRecurrence(), StartDate: "2026-03-10", Priority: 1, Enabled: true, AnnualCap: &cap},
		},
		Evaluations: types.EmptyEvaluationTables(),
	}
	drain := account
	model.Transactions = []types.Transaction{
		{ID: "drain", Name: "Drain", SourceAccountID: &drain, Amount: expenseAmount("1500"), TransactionTime: unixAt(10, 10), PostedTime: unixAt(10, 10), Enabled: true, Source: "user"},
	}
	applied, err := applyChronologicalHistory(model, "2026-03-10")
	if err != nil {
		t.Fatal(err)
	}
	// 1000 anchored, then 1500 recorded actual = -500 (actuals ignore the
	// floor); the day-close rule requests 100 from below the floor and
	// realizes nothing.
	if got := applied.state.Balances[account]; got != -500 {
		t.Fatalf("recorded actual must ignore the floor while the rule clamps: balance = %v, want -500", got)
	}
	if got := applied.state.RealizedTransactionAmountsByYear["payout"]["2026"]; got != 0 {
		t.Fatalf("clamped rule realized = %v, want 0", got)
	}
}

// Settled bank actuals are applied through the same actual path as manual
// actuals: a 09:00 observation plus an 11:00 settled import is 900 at a
// noon cut, in position and projection baseline alike.
func TestSettledBankActualParticipatesLikeManual(t *testing.T) {
	account := "checking"
	source := account
	model := &types.FinancialModel{
		Accounts: []types.Account{cashAccount(account)},
		Checkpoints: []types.Checkpoint{
			{AccountID: account, Balance: 1000, Source: "banksync", ObservedAt: unixAt(10, 9)},
		},
		Transactions: []types.Transaction{
			{ID: "bank-expense", Name: "Groceries", SourceAccountID: &source, Amount: expenseAmount("100"), TransactionTime: unixAt(10, 11), PostedTime: unixAt(10, 11), Enabled: true, Source: "banksync"},
		},
		Evaluations: types.EmptyEvaluationTables(),
	}
	position, err := ResolveCurrentPosition(model, "2026-03-10T12:00:00Z", types.ModelOverrides{})
	if err != nil {
		t.Fatal(err)
	}
	if got := position.Accounts[0].Balance; got != 900 {
		t.Fatalf("12:00 balance = %v, want 900 (settled bank actual applies)", got)
	}
	settings := &types.ProjectionRuntimeSettings{FallbackProjectionStartDate: "2026-03-10", HorizonYears: 1, AsOfInstant: &[]int64{unixAt(10, 12)}[0]}
	prepared, err := PrepareSimulationRequest(model, settings, types.ModelOverrides{}, nil)
	if err != nil {
		t.Fatal(err)
	}
	if got := prepared.Request.InitialState.Balances[account]; got != 900 {
		t.Fatalf("projection baseline = %v, want 900 (agrees with position)", got)
	}
}

// A bank actual before the latest anchor is absorbed exactly once: the
// later anchor overwrites without applying the movement again.
func TestBankActualBeforeLatestAnchorAbsorbedOnce(t *testing.T) {
	account := "checking"
	source := account
	model := &types.FinancialModel{
		Accounts: []types.Account{cashAccount(account)},
		Checkpoints: []types.Checkpoint{
			{AccountID: account, Balance: 1000, Source: "banksync", ObservedAt: unixAt(10, 9)},
			{AccountID: account, Balance: 850, Source: "banksync", ObservedAt: unixAt(10, 15)},
		},
		Transactions: []types.Transaction{
			{ID: "bank-expense", Name: "Groceries", SourceAccountID: &source, Amount: expenseAmount("100"), TransactionTime: unixAt(10, 11), PostedTime: unixAt(10, 11), Enabled: true, Source: "banksync"},
		},
		Evaluations: types.EmptyEvaluationTables(),
	}
	applied, err := applyChronologicalHistory(model, "2026-03-10")
	if err != nil {
		t.Fatal(err)
	}
	if got := applied.state.Balances[account]; got != 850 {
		t.Fatalf("balance = %v, want 850 (later anchor absorbs the actual)", got)
	}
	if observed := applied.latestObserved[account]; observed.ObservedAt != unixAt(10, 15) || observed.Balance != 850 {
		t.Fatalf("later reset must absorb the 11:00 actual exactly once: %+v", observed)
	}
}

// Two bank actuals straddling an anchor: the earlier one is absorbed, the
// later one applies. No link or recognition layer is involved.
func TestBankActualsBeforeAndAfterAnchor(t *testing.T) {
	account := "checking"
	source := account
	model := &types.FinancialModel{
		Accounts: []types.Account{cashAccount(account)},
		Checkpoints: []types.Checkpoint{
			{AccountID: account, Balance: 1000, Source: "banksync", ObservedAt: unixAt(10, 10)},
		},
		Transactions: []types.Transaction{
			{ID: "early", Name: "Early", SourceAccountID: &source, Amount: expenseAmount("100"), TransactionTime: unixAt(10, 9), PostedTime: unixAt(10, 9), Enabled: true, Source: "banksync"},
			{ID: "late", Name: "Late", SourceAccountID: &source, Amount: expenseAmount("100"), TransactionTime: unixAt(10, 11), PostedTime: unixAt(10, 11), Enabled: true, Source: "banksync"},
		},
		Evaluations: types.EmptyEvaluationTables(),
	}
	position, err := ResolveCurrentPosition(model, "2026-03-10T12:00:00Z", types.ModelOverrides{})
	if err != nil {
		t.Fatal(err)
	}
	if got := position.Accounts[0].Balance; got != 900 {
		t.Fatalf("12:00 balance = %v, want 900 (early actual absorbed, late applies)", got)
	}
}

// Imported transfer legs are ordinary deltas: with unequal observation
// cutoffs per account, each leg anchors independently and no link layer
// reconciles them.
func TestImportedTransferLegsAnchorIndependently(t *testing.T) {
	a, b := "checking", "savings"
	source := a
	model := &types.FinancialModel{
		Accounts: []types.Account{cashAccount(a), cashAccount(b)},
		Checkpoints: []types.Checkpoint{
			{AccountID: a, Balance: 1000, Source: "banksync", ObservedAt: unixAt(10, 9)},
			{AccountID: b, Balance: 200, Source: "banksync", ObservedAt: unixAt(10, 12)},
		},
		Transactions: []types.Transaction{
			{ID: "transfer", Name: "Move", SourceAccountID: &source, Destinations: []string{b}, Amount: expenseAmount("50"), TransactionTime: unixAt(10, 11), PostedTime: unixAt(10, 11), Enabled: true, Source: "banksync"},
		},
		Evaluations: types.EmptyEvaluationTables(),
	}
	position, err := ResolveCurrentPosition(model, "2026-03-10T13:00:00Z", types.ModelOverrides{})
	if err != nil {
		t.Fatal(err)
	}
	balances := map[string]float64{}
	for _, row := range position.Accounts {
		balances[row.AccountID] = row.Balance
	}
	if balances[a] != 950 || balances[b] != 200 {
		t.Fatalf("balances = %+v, want checking 950 and savings 200 (independent anchors)", balances)
	}
}

func TestCheckpointMismatchProducesNoDerivedSnapshotFields(t *testing.T) {
	account := "checking"
	model := &types.FinancialModel{
		Accounts: []types.Account{cashAccount(account)},
		Checkpoints: []types.Checkpoint{{
			AccountID: account, Balance: 1000, Source: "user", ObservedAt: unixAt(10, 9),
		}},
		Transactions: []types.Transaction{{
			ID: "before-reset", Name: "Before reset", SourceAccountID: &account,
			Amount: expenseAmount("100"), TransactionTime: unixAt(10, 8), PostedTime: unixAt(10, 8), Enabled: true,
		}},
		Evaluations: types.EmptyEvaluationTables(),
	}
	applied, err := applyChronologicalHistory(model, "2026-03-10")
	if err != nil {
		t.Fatal(err)
	}
	if got := applied.state.Balances[account]; got != 1000 {
		t.Fatalf("checkpoint reset = %v, want 1000", got)
	}
	raw, err := json.Marshal(applied.snapshots)
	if err != nil {
		t.Fatal(err)
	}
	var snapshots []map[string]any
	if err := json.Unmarshal(raw, &snapshots); err != nil {
		t.Fatal(err)
	}
	if len(snapshots) != 1 || len(snapshots[0]) != 2 {
		t.Fatalf("historical snapshot must carry only date and balances: %s", raw)
	}
}

func TestCheckpointSourceDoesNotChangeResetSemantics(t *testing.T) {
	for _, source := range []string{"user", "banksync"} {
		t.Run(source, func(t *testing.T) {
			account := "checking"
			model := &types.FinancialModel{
				Accounts: []types.Account{cashAccount(account)},
				Checkpoints: []types.Checkpoint{{
					AccountID: account, Balance: 1000, Source: source, ObservedAt: unixAt(10, 9),
				}},
				Transactions: []types.Transaction{
					{ID: "before", Name: "Before", SourceAccountID: &account, Amount: expenseAmount("25"), TransactionTime: unixAt(10, 8), PostedTime: unixAt(10, 8), Enabled: true},
					{ID: "after", Name: "After", SourceAccountID: &account, Amount: expenseAmount("50"), TransactionTime: unixAt(10, 11), PostedTime: unixAt(10, 11), Enabled: true},
				},
				Evaluations: types.EmptyEvaluationTables(),
			}
			position, err := ResolveCurrentPosition(model, "2026-03-10T12:00:00Z", types.ModelOverrides{})
			if err != nil {
				t.Fatal(err)
			}
			if position.Accounts[0].Balance != 950 || position.Accounts[0].ObservedBalance == nil || *position.Accounts[0].ObservedBalance != 1000 {
				t.Fatalf("current position = %+v, want current 950 and observed 1000", position.Accounts[0])
			}
			prepared, err := PrepareSimulationRequest(model, &types.ProjectionRuntimeSettings{FallbackProjectionStartDate: "2026-03-10", HorizonYears: 1}, types.ModelOverrides{}, nil)
			if err != nil {
				t.Fatal(err)
			}
			if prepared.Request.InitialState.Balances[account] != 950 {
				t.Fatalf("projection baseline = %v, want 950", prepared.Request.InitialState.Balances[account])
			}
		})
	}
}

func TestScheduledBillAfterCheckpointDoesNotMoveCurrentButProjectsLater(t *testing.T) {
	account := "checking"
	cap := 150.0
	end := "2026-12-31"
	model := &types.FinancialModel{
		Accounts: []types.Account{cashAccount(account)},
		Checkpoints: []types.Checkpoint{{
			AccountID: account, Balance: 1000, Source: "user", ObservedAt: unixAt(10, 9),
		}},
		Schedules: []types.Schedule{{
			ID: "bill", Name: "Bill", SourceAccountID: &account, Amount: expenseAmount("100"),
			Recurrence: monthlyTestRecurrence(), StartDate: "2026-03-11", EndDate: &end, AnnualCap: &cap, Enabled: true,
		}},
		Evaluations: types.EmptyEvaluationTables(),
	}
	position, err := ResolveCurrentPosition(model, "2026-03-12", types.ModelOverrides{})
	if err != nil {
		t.Fatal(err)
	}
	if position.Accounts[0].Balance != 1000 {
		t.Fatalf("scheduled guess moved current balance to %v, want 1000", position.Accounts[0].Balance)
	}
	settings := &types.ProjectionRuntimeSettings{FallbackProjectionStartDate: "2026-03-12", HorizonYears: 1, Evaluations: types.EmptyEvaluationTables()}
	prepared, err := PrepareSimulationRequest(model, settings, types.ModelOverrides{}, nil)
	if err != nil {
		t.Fatal(err)
	}
	if prepared.Request.InitialState.Balances[account] != 1000 {
		t.Fatalf("projection baseline = %v, want actual-only 1000", prepared.Request.InitialState.Balances[account])
	}
	path, result, err := ProjectRawFinancialModel(model, settings, types.ModelOverrides{}, nil)
	if err != nil {
		t.Fatal(err)
	}
	if got := historicalBalance(t, path, "2026-03-10", account); got != 1000 {
		t.Fatalf("actual-only historical checkpoint = %v, want 1000", got)
	}
	if hasHistoricalRow(path, "2026-03-11") {
		t.Fatal("scheduled guess must not create a historical balance row")
	}
	var lastHistorical *types.ProjectionRow
	for index := range path.Rows {
		if path.Rows[index].IsHistorical {
			lastHistorical = &path.Rows[index]
		}
	}
	if lastHistorical == nil || lastHistorical.Date != "2026-03-10" || lastHistorical.NetWorth != prepared.Request.InitialState.Balances[account] {
		t.Fatalf("historical timeline must converge to the actual-only baseline: %+v", lastHistorical)
	}
	if got := path.ProjectionStartTransactionState.RealizedTransactionAmountsByYear["bill"]["2026"]; got != 100 {
		t.Fatalf("historical schedule cap ledger = %v, want 100", got)
	}
	if result.Summary.CurrentNetWorth != 1000 || result.AccountSummaries[0].StartingBalance != 1000 {
		t.Fatalf("projection current summary = %+v, want actual-only 1000", result.Summary)
	}
	futureMoves := 0
	for _, event := range result.TransactionEvents {
		if event.Origin.TransactionID != "bill" || event.RealizedAmount == 0 {
			continue
		}
		futureMoves++
		if event.Date != "2026-04-11" || event.RealizedAmount != 50 {
			t.Fatalf("future scheduled bill = %+v, want 50 on 2026-04-11 after the historical cap", event)
		}
	}
	if futureMoves != 1 || result.Summary.FinalNetWorth != 950 {
		t.Fatalf("future moves = %d, final = %v, want one move and 950", futureMoves, result.Summary.FinalNetWorth)
	}
}

func TestRecordedActualAfterCheckpointMovesCurrentAndProjectionOnce(t *testing.T) {
	account := "checking"
	model := &types.FinancialModel{
		Accounts: []types.Account{cashAccount(account)},
		Checkpoints: []types.Checkpoint{{
			AccountID: account, Balance: 1000, Source: "banksync", ObservedAt: unixAt(10, 9),
		}},
		Transactions: []types.Transaction{{
			ID: "actual", Name: "Actual", SourceAccountID: &account, Amount: expenseAmount("100"),
			TransactionTime: unixAt(11, 11), PostedTime: unixAt(11, 11), Enabled: true, Source: "banksync",
		}},
		Evaluations: types.EmptyEvaluationTables(),
	}
	position, err := ResolveCurrentPosition(model, "2026-03-12", types.ModelOverrides{})
	if err != nil {
		t.Fatal(err)
	}
	if position.Accounts[0].Balance != 900 {
		t.Fatalf("current balance = %v, want 900", position.Accounts[0].Balance)
	}
	settings := &types.ProjectionRuntimeSettings{FallbackProjectionStartDate: "2026-03-12", HorizonYears: 1, Evaluations: types.EmptyEvaluationTables()}
	prepared, err := PrepareSimulationRequest(model, settings, types.ModelOverrides{}, nil)
	if err != nil {
		t.Fatal(err)
	}
	if prepared.Request.InitialState.Balances[account] != 900 {
		t.Fatalf("projection baseline = %v, want 900", prepared.Request.InitialState.Balances[account])
	}
	_, result, err := ProjectRawFinancialModel(model, settings, types.ModelOverrides{}, nil)
	if err != nil {
		t.Fatal(err)
	}
	if result.Summary.CurrentNetWorth != 900 || result.Summary.FinalNetWorth != 900 {
		t.Fatalf("projection summary = %+v, want 900/900", result.Summary)
	}
	if len(result.TransactionEvents) != 0 {
		t.Fatalf("recorded actual must not repeat in future simulation: %+v", result.TransactionEvents)
	}
}

func TestProjectionStartDateControlsActualOnlyCurrentSummary(t *testing.T) {
	account := "checking"
	now := time.Now().UTC()
	today := time.Date(now.Year(), now.Month(), now.Day(), 0, 0, 0, 0, time.UTC)
	checkpointAt := today.Add(-12 * time.Hour)
	actualAt := today.Unix()
	model := &types.FinancialModel{
		Accounts: []types.Account{cashAccount(account)},
		Checkpoints: []types.Checkpoint{{
			AccountID: account, Balance: 1000, Source: "user", ObservedAt: checkpointAt.Unix(),
		}},
		Transactions: []types.Transaction{{
			ID: "today-actual", Name: "Today actual", SourceAccountID: &account, Amount: expenseAmount("100"),
			TransactionTime: actualAt, PostedTime: actualAt, Enabled: true,
		}},
		Evaluations: types.EmptyEvaluationTables(),
	}
	for _, test := range []struct {
		name    string
		start   string
		current float64
		actuals int
	}{
		{name: "checkpoint day", start: FormatIsoDate(checkpointAt), current: 1000, actuals: 1},
		{name: "today", start: FormatIsoDate(today), current: 900, actuals: 0},
	} {
		t.Run(test.name, func(t *testing.T) {
			settings := &types.ProjectionRuntimeSettings{FallbackProjectionStartDate: test.start, HorizonYears: 1, Evaluations: types.EmptyEvaluationTables()}
			prepared, err := PrepareSimulationRequest(model, settings, types.ModelOverrides{}, nil)
			if err != nil {
				t.Fatal(err)
			}
			if prepared.Request.InitialState.Balances[account] != test.current {
				t.Fatalf("baseline = %v, want %v", prepared.Request.InitialState.Balances[account], test.current)
			}
			_, result, err := ProjectRawFinancialModel(model, settings, types.ModelOverrides{}, nil)
			if err != nil {
				t.Fatal(err)
			}
			if result.Summary.CurrentNetWorth != test.current {
				t.Fatalf("current summary = %v, want %v", result.Summary.CurrentNetWorth, test.current)
			}
			actuals := 0
			for _, event := range result.TransactionEvents {
				if event.Origin.TransactionID == "today-actual" {
					actuals++
				}
			}
			if actuals != test.actuals {
				t.Fatalf("future actual executions = %d, want %d", actuals, test.actuals)
			}
		})
	}
}
