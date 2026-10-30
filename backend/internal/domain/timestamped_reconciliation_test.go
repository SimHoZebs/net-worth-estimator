package domain

import (
	"testing"
	"time"

	"github.com/simhozebs/net-worth-estimator/backend/internal/types"
)

func unixAt(day, hour int) int64 {
	return time.Date(2026, time.March, day, hour, 0, 0, 0, time.UTC).Unix()
}

func cashAccount(id string) types.Account {
	return types.Account{ID: id, Name: id, Kind: types.AccountKindCash, Enabled: true}
}

func expenseAmount(expression string) types.PostingAmountResolution {
	return types.PostingAmountResolution{Resolver: "expression", Config: map[string]any{"expression": expression}, Inputs: map[string]types.AmountInputBinding{}}
}

func observerFixture() *types.FinancialModelDocument {
	account := "checking"
	return &types.FinancialModelDocument{
		Accounts: []types.Account{cashAccount(account)},
		Checkpoints: []types.Checkpoint{
			{AccountID: account, Balance: 1000, Source: "simplefin", ObservedAt: unixAt(10, 9)},
			{AccountID: account, Balance: 900, Source: "simplefin", ObservedAt: unixAt(10, 15)},
		},
		Postings: []types.Posting{
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
		t.Fatalf("adjusted balance = %v, want 900 (09:00 observed 1000, 11:00 actual -100)", got)
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

// Later 15:00 observation 850 anchors again with a -50 correction and no
// provisional layer.
func TestTimestampedLaterObservationAnchorsAgain(t *testing.T) {
	document := observerFixture()
	document.Checkpoints[1].Balance = 850
	replay, err := replayChronologicalHistory(document, "2026-03-10")
	if err != nil {
		t.Fatal(err)
	}
	if got := replay.state.Balances["checking"]; got != 850 {
		t.Fatalf("adjusted balance = %v, want 850", got)
	}
	corrections := replay.snapshots[0].CheckpointCorrections
	if len(corrections) != 2 {
		t.Fatalf("two same-day observations must both anchor, got %+v", corrections)
	}
	if corrections[1].ModeledBalance != 900 || corrections[1].Adjustment != -50 {
		t.Fatalf("later observation must record observed-vs-modeled diff, got %+v", corrections[1])
	}
}

// Yesterday's anchor plus today's 11:00 actual applies at a noon cut with
// no same-day observation.
func TestExactCutIncludesTodayAfterYesterdayAnchor(t *testing.T) {
	account := "checking"
	document := &types.FinancialModelDocument{
		Accounts: []types.Account{cashAccount(account)},
		Checkpoints: []types.Checkpoint{
			{AccountID: account, Balance: 1000, Source: "simplefin", ObservedAt: unixAt(9, 9)},
		},
		Postings: []types.Posting{
			{ID: "manual", Name: "Expense", SourceAccountID: &account, Amount: expenseAmount("100"), TransactionTime: unixAt(10, 11), PostedTime: unixAt(10, 11), Enabled: true, Source: "user"},
		},
		Evaluations: types.EmptyEvaluationTables(),
	}
	position, err := ResolveCurrentPosition(document, "2026-03-10T12:00:00Z", types.ModelOverrides{})
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
	document := observerFixture()
	document.Checkpoints = document.Checkpoints[:1]
	document.Postings = nil
	document.RecurrenceRules = []types.RecurrenceRule{
		{ID: "income", Name: "Income", Destinations: []string{"checking"}, Amount: expenseAmount("10"), Frequency: types.FrequencyMonthly, StartDate: "2026-03-10", Priority: 1, Enabled: true},
	}
	position, err := ResolveCurrentPosition(document, "2026-03-10T10:00:00Z", types.ModelOverrides{})
	if err != nil {
		t.Fatal(err)
	}
	if got := position.Accounts[0].Balance; got != 1000 {
		t.Fatalf("day-close rule must not execute by a 10:00 cut, got %v", got)
	}
	cut := unixAt(10, 10)
	settings := &types.ProjectionRuntimeSettings{FallbackProjectionStartDate: "2026-03-10", HorizonYears: 1, AsOfInstant: &cut}
	prepared, err := PrepareSimulationRequest(document, settings, types.ModelOverrides{}, nil)
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
		if event.Origin.PostingID == "income" && event.Date == "2026-03-10" {
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
	document := observerFixture()
	document.Checkpoints = document.Checkpoints[:1]
	document.Postings[0].TransactionTime = unixAt(10, 0)
	document.Postings[0].PostedTime = unixAt(10, 0)
	position, err := ResolveCurrentPosition(document, "2026-03-10T10:00:00Z", types.ModelOverrides{})
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
	document := &types.FinancialModelDocument{
		Accounts: []types.Account{cashAccount(account)},
		Checkpoints: []types.Checkpoint{
			{AccountID: account, Balance: 1000, Source: "user", ObservedAt: unixAt(10, 9)},
			{AccountID: account, Balance: 850, Source: "simplefin", ObservedAt: unixAt(10, 15)},
			{AccountID: account, Balance: 5000, Source: "simplefin", ObservedAt: unixAt(10, 10)},
		},
		Evaluations: types.EmptyEvaluationTables(),
	}
	replay, err := replayChronologicalHistory(document, "2026-03-10")
	if err != nil {
		t.Fatal(err)
	}
	if got := replay.state.Balances[account]; got != 850 {
		t.Fatalf("latest-instant anchor must win regardless of arrival order, got %v", got)
	}
	corrections := replay.snapshots[0].CheckpointCorrections
	if len(corrections) != 3 {
		t.Fatalf("every stored observation anchors in instant order, got %+v", corrections)
	}
}

// An observation at t includes events at t, postings first on the tie.
func TestTimestampedTiePolicyPostingsFirst(t *testing.T) {
	account := "checking"
	instant := unixAt(10, 9)
	document := &types.FinancialModelDocument{
		Accounts: []types.Account{cashAccount(account)},
		Checkpoints: []types.Checkpoint{
			{AccountID: account, Balance: 1000, Source: "user", ObservedAt: instant},
		},
		Postings: []types.Posting{
			{ID: "at-tie", Name: "AtTie", SourceAccountID: &account, Amount: expenseAmount("100"), TransactionTime: instant, PostedTime: instant, Enabled: true, Source: "user"},
		},
		Evaluations: types.EmptyEvaluationTables(),
	}
	replay, err := replayChronologicalHistory(document, "2026-03-10")
	if err != nil {
		t.Fatal(err)
	}
	corrections := replay.snapshots[0].CheckpointCorrections
	if len(corrections) != 1 {
		t.Fatalf("expected one correction, got %+v", corrections)
	}
	if corrections[0].ModeledBalance != -100 || corrections[0].Adjustment != 1100 {
		t.Fatalf("observation at t must include events at t (postings first): %+v", corrections[0])
	}
}

// Owner-authored observations win only at the same instant.
func TestTimestampedOwnerWinsSameInstantOnly(t *testing.T) {
	account := "checking"
	instant := unixAt(10, 12)
	document := &types.FinancialModelDocument{
		Accounts: []types.Account{cashAccount(account)},
		Checkpoints: []types.Checkpoint{
			{AccountID: account, Balance: 700, Source: "simplefin", ObservedAt: instant},
			{AccountID: account, Balance: 800, Source: "user", ObservedAt: instant},
		},
		Evaluations: types.EmptyEvaluationTables(),
	}
	replay, err := replayChronologicalHistory(document, "2026-03-10")
	if err != nil {
		t.Fatal(err)
	}
	if got := replay.state.Balances[account]; got != 800 {
		t.Fatalf("owner observation must win at the same instant, got %v", got)
	}
}

// Transfer legs anchor independently per account; other-account effects
// are preserved.
func TestTransferLegsAnchorIndependently(t *testing.T) {
	a, b := "checking", "savings"
	source := a
	document := &types.FinancialModelDocument{
		Accounts: []types.Account{cashAccount(a), cashAccount(b)},
		Checkpoints: []types.Checkpoint{
			{AccountID: a, Balance: 1000, Source: "user", ObservedAt: unixAt(10, 9)},
			{AccountID: b, Balance: 200, Source: "user", ObservedAt: unixAt(10, 9)},
			{AccountID: a, Balance: 1000, Source: "simplefin", ObservedAt: unixAt(10, 12)},
		},
		Postings: []types.Posting{
			{ID: "transfer", Name: "Move", SourceAccountID: &source, Destinations: []string{b}, Amount: expenseAmount("50"), TransactionTime: unixAt(10, 11), PostedTime: unixAt(10, 11), Enabled: true, Source: "user"},
		},
		Evaluations: types.EmptyEvaluationTables(),
	}
	replay, err := replayChronologicalHistory(document, "2026-03-10")
	if err != nil {
		t.Fatal(err)
	}
	// A leg: 1000 - 50 executed, anchored back to 1000 by the bank.
	if got := replay.state.Balances[a]; got != 1000 {
		t.Fatalf("account A balance = %v, want the bank anchor 1000", got)
	}
	// B leg: the destination effect stands with no later anchor.
	if got := replay.state.Balances[b]; got != 250 {
		t.Fatalf("account B balance = %v, want 250", got)
	}
}

func TestPendingAndVoidHaveNoBalanceEffect(t *testing.T) {
	account := "checking"
	source := account
	document := &types.FinancialModelDocument{
		Accounts: []types.Account{cashAccount(account)},
		Checkpoints: []types.Checkpoint{
			{AccountID: account, Balance: 1000, Source: "user", ObservedAt: unixAt(10, 9)},
		},
		Postings: []types.Posting{
			{ID: "pending", Name: "Pending", SourceAccountID: &source, Amount: expenseAmount("100"), TransactionTime: unixAt(10, 11), PostedTime: unixAt(10, 11), Enabled: true, Source: "simplefin", Pending: true},
			{ID: "voided", Name: "Voided", SourceAccountID: &source, Amount: expenseAmount("100"), TransactionTime: unixAt(10, 11), PostedTime: unixAt(10, 11), Enabled: true, Source: "simplefin", Void: true},
			// An owner-disabled settled bank row is a deliberate
			// exclusion and stays out of balances like any disabled row.
			{ID: "owner-disabled-bank", Name: "BankSettled", SourceAccountID: &source, Amount: expenseAmount("100"), TransactionTime: unixAt(10, 11), PostedTime: unixAt(10, 11), Enabled: false, Source: "simplefin"},
		},
		Evaluations: types.EmptyEvaluationTables(),
	}
	replay, err := replayChronologicalHistory(document, "2026-03-10")
	if err != nil {
		t.Fatal(err)
	}
	if got := replay.state.Balances[account]; got != 1000 {
		t.Fatalf("pending/void/owner-disabled-bank rows must not move balances, got %v", got)
	}
}

func TestPositionAndProjectionBaselineAgree(t *testing.T) {
	account := "checking"
	document := observerFixture()
	position, err := ResolveCurrentPosition(document, "2026-03-10", types.ModelOverrides{})
	if err != nil {
		t.Fatal(err)
	}
	settings := &types.ProjectionRuntimeSettings{FallbackProjectionStartDate: "2026-03-10", HorizonYears: 1}
	prepared, err := PrepareSimulationRequest(document, settings, types.ModelOverrides{}, nil)
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
	_, projection, err := ProjectRawFinancialModelDocument(document, settings, types.ModelOverrides{}, nil)
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
	document := observerFixture()
	document.Checkpoints = document.Checkpoints[:1]
	cut := "2026-03-10T10:00:00Z"
	position, err := ResolveCurrentPosition(document, cut, types.ModelOverrides{})
	if err != nil {
		t.Fatal(err)
	}
	instant := unixAt(10, 10)
	settings := &types.ProjectionRuntimeSettings{FallbackProjectionStartDate: "2026-03-10", HorizonYears: 1, AsOfInstant: &instant}
	prepared, err := PrepareSimulationRequest(document, settings, types.ModelOverrides{}, nil)
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
		if event.Origin.PostingID == "manual" {
			manualMoves++
			if event.Date != "2026-03-10" {
				t.Fatalf("afternoon actual must simulate on the start date, got %s", event.Date)
			}
		}
	}
	if manualMoves != 1 {
		t.Fatalf("11:00 actual simulated %d times, want exactly once", manualMoves)
	}
	base := BaseDocumentHash(document, types.ModelOverrides{}, &types.ProjectionRuntimeSettings{FallbackProjectionStartDate: "2026-03-10", HorizonYears: 1}, nil)
	if got := BaseDocumentHash(document, types.ModelOverrides{}, settings, nil); got == base {
		t.Fatalf("exact cut must change the cache identity")
	}
}

func TestExactCutSuppressesReplayedMorningInSimulation(t *testing.T) {
	account := "checking"
	document := &types.FinancialModelDocument{
		Accounts: []types.Account{cashAccount(account)},
		Checkpoints: []types.Checkpoint{
			{AccountID: account, Balance: 1000, Source: "simplefin", ObservedAt: unixAt(10, 9)},
		},
		Postings: []types.Posting{
			{ID: "morning", Name: "Morning", SourceAccountID: &account, Amount: expenseAmount("100"), TransactionTime: unixAt(10, 9) + 1800, PostedTime: unixAt(10, 9) + 1800, Enabled: true, Source: "user"},
			{ID: "afternoon", Name: "Afternoon", SourceAccountID: &account, Amount: expenseAmount("50"), TransactionTime: unixAt(10, 11), PostedTime: unixAt(10, 11), Enabled: true, Source: "user"},
		},
		Evaluations: types.EmptyEvaluationTables(),
	}
	cut := unixAt(10, 10)
	settings := &types.ProjectionRuntimeSettings{FallbackProjectionStartDate: "2026-03-10", HorizonYears: 1, AsOfInstant: &cut}
	prepared, err := PrepareSimulationRequest(document, settings, types.ModelOverrides{}, nil)
	if err != nil {
		t.Fatal(err)
	}
	if got := prepared.Request.InitialState.Balances[account]; got != 900 {
		t.Fatalf("baseline at 10:00 cut = %v, want 900 (09:00 anchor minus 09:30 actual)", got)
	}
	if prepared.Request.HistoryCutInstant != cut {
		t.Fatalf("simulation request must carry the history cut, got %v", prepared.Request.HistoryCutInstant)
	}
	position, err := ResolveCurrentPosition(document, "2026-03-10T10:00:00Z", types.ModelOverrides{})
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
			counts[event.Origin.PostingID]++
		}
	}
	if counts["morning"] != 0 || counts["afternoon"] != 1 {
		t.Fatalf("simulation must skip replayed morning and run afternoon once: %+v", counts)
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
	document := &types.FinancialModelDocument{
		Accounts: []types.Account{accountRow},
		Checkpoints: []types.Checkpoint{
			{AccountID: account, Balance: 1000, Source: "user", ObservedAt: unixAt(10, 9)},
		},
		RecurrenceRules: []types.RecurrenceRule{
			{ID: "payout", Name: "Payout", SourceAccountID: &account, Amount: expenseAmount("100"), Frequency: types.FrequencyMonthly, StartDate: "2026-03-10", Priority: 1, Enabled: true, AnnualCap: &cap},
		},
		Evaluations: types.EmptyEvaluationTables(),
	}
	drain := account
	document.Postings = []types.Posting{
		{ID: "drain", Name: "Drain", SourceAccountID: &drain, Amount: expenseAmount("1500"), TransactionTime: unixAt(10, 10), PostedTime: unixAt(10, 10), Enabled: true, Source: "user"},
	}
	replay, err := replayChronologicalHistory(document, "2026-03-10")
	if err != nil {
		t.Fatal(err)
	}
	// 1000 anchored, then 1500 recorded actual = -500 (actuals ignore the
	// floor); the day-close rule requests 100 from below the floor and
	// realizes nothing.
	if got := replay.state.Balances[account]; got != -500 {
		t.Fatalf("recorded actual must ignore the floor while the rule clamps: balance = %v, want -500", got)
	}
	if got := replay.state.RealizedPostingAmountsByYear["payout"]["2026"]; got != 0 {
		t.Fatalf("clamped rule realized = %v, want 0", got)
	}
}

func TestExactCutDoesNotExecuteDayCloseRuleEarly(t *testing.T) {
	document := observerFixture()
	document.Checkpoints = document.Checkpoints[:1]
	document.Postings = nil
	document.RecurrenceRules = []types.RecurrenceRule{
		{ID: "income", Name: "Income", Destinations: []string{"checking"}, Amount: expenseAmount("10"), Frequency: types.FrequencyMonthly, StartDate: "2026-03-10", Priority: 1, Enabled: true},
	}
	position, err := ResolveCurrentPosition(document, "2026-03-10T10:00:00Z", types.ModelOverrides{})
	if err != nil {
		t.Fatal(err)
	}
	if got := position.Accounts[0].Balance; got != 1000 {
		t.Fatalf("day-close rule must not execute by a 10:00 cut, got %v", got)
	}
}

// Settled bank actuals replay through the same actual path as manual
// actuals: a 09:00 observation plus an 11:00 settled import is 900 at a
// noon cut, in position and projection baseline alike.
func TestSettledBankActualParticipatesLikeManual(t *testing.T) {
	account := "checking"
	source := account
	document := &types.FinancialModelDocument{
		Accounts: []types.Account{cashAccount(account)},
		Checkpoints: []types.Checkpoint{
			{AccountID: account, Balance: 1000, Source: "simplefin", ObservedAt: unixAt(10, 9)},
		},
		Postings: []types.Posting{
			{ID: "bank-expense", Name: "Groceries", SourceAccountID: &source, Amount: expenseAmount("100"), TransactionTime: unixAt(10, 11), PostedTime: unixAt(10, 11), Enabled: true, Source: "simplefin"},
		},
		Evaluations: types.EmptyEvaluationTables(),
	}
	position, err := ResolveCurrentPosition(document, "2026-03-10T12:00:00Z", types.ModelOverrides{})
	if err != nil {
		t.Fatal(err)
	}
	if got := position.Accounts[0].Balance; got != 900 {
		t.Fatalf("12:00 balance = %v, want 900 (settled bank actual applies)", got)
	}
	settings := &types.ProjectionRuntimeSettings{FallbackProjectionStartDate: "2026-03-10", HorizonYears: 1, AsOfInstant: &[]int64{unixAt(10, 12)}[0]}
	prepared, err := PrepareSimulationRequest(document, settings, types.ModelOverrides{}, nil)
	if err != nil {
		t.Fatal(err)
	}
	if got := prepared.Request.InitialState.Balances[account]; got != 900 {
		t.Fatalf("projection baseline = %v, want 900 (agrees with position)", got)
	}
}

// A bank actual before the latest anchor is absorbed exactly once: the
// later anchor overwrites without replaying the movement again.
func TestBankActualBeforeLatestAnchorAbsorbedOnce(t *testing.T) {
	account := "checking"
	source := account
	document := &types.FinancialModelDocument{
		Accounts: []types.Account{cashAccount(account)},
		Checkpoints: []types.Checkpoint{
			{AccountID: account, Balance: 1000, Source: "simplefin", ObservedAt: unixAt(10, 9)},
			{AccountID: account, Balance: 850, Source: "simplefin", ObservedAt: unixAt(10, 15)},
		},
		Postings: []types.Posting{
			{ID: "bank-expense", Name: "Groceries", SourceAccountID: &source, Amount: expenseAmount("100"), TransactionTime: unixAt(10, 11), PostedTime: unixAt(10, 11), Enabled: true, Source: "simplefin"},
		},
		Evaluations: types.EmptyEvaluationTables(),
	}
	replay, err := replayChronologicalHistory(document, "2026-03-10")
	if err != nil {
		t.Fatal(err)
	}
	if got := replay.state.Balances[account]; got != 850 {
		t.Fatalf("balance = %v, want 850 (later anchor absorbs the actual)", got)
	}
	corrections := replay.snapshots[0].CheckpointCorrections
	if len(corrections) != 2 {
		t.Fatalf("corrections = %+v, want both anchors recorded once", corrections)
	}
	if corrections[1].ModeledBalance != 900 || corrections[1].Adjustment != -50 {
		t.Fatalf("later anchor must absorb the 11:00 actual exactly once: %+v", corrections[1])
	}
}

// Two bank actuals straddling an anchor: the earlier one is absorbed, the
// later one applies. No link or recognition layer is involved.
func TestBankActualsBeforeAndAfterAnchor(t *testing.T) {
	account := "checking"
	source := account
	document := &types.FinancialModelDocument{
		Accounts: []types.Account{cashAccount(account)},
		Checkpoints: []types.Checkpoint{
			{AccountID: account, Balance: 1000, Source: "simplefin", ObservedAt: unixAt(10, 10)},
		},
		Postings: []types.Posting{
			{ID: "early", Name: "Early", SourceAccountID: &source, Amount: expenseAmount("100"), TransactionTime: unixAt(10, 9), PostedTime: unixAt(10, 9), Enabled: true, Source: "simplefin"},
			{ID: "late", Name: "Late", SourceAccountID: &source, Amount: expenseAmount("100"), TransactionTime: unixAt(10, 11), PostedTime: unixAt(10, 11), Enabled: true, Source: "simplefin"},
		},
		Evaluations: types.EmptyEvaluationTables(),
	}
	position, err := ResolveCurrentPosition(document, "2026-03-10T12:00:00Z", types.ModelOverrides{})
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
	document := &types.FinancialModelDocument{
		Accounts: []types.Account{cashAccount(a), cashAccount(b)},
		Checkpoints: []types.Checkpoint{
			{AccountID: a, Balance: 1000, Source: "simplefin", ObservedAt: unixAt(10, 9)},
			{AccountID: b, Balance: 200, Source: "simplefin", ObservedAt: unixAt(10, 12)},
		},
		Postings: []types.Posting{
			{ID: "transfer", Name: "Move", SourceAccountID: &source, Destinations: []string{b}, Amount: expenseAmount("50"), TransactionTime: unixAt(10, 11), PostedTime: unixAt(10, 11), Enabled: true, Source: "simplefin"},
		},
		Evaluations: types.EmptyEvaluationTables(),
	}
	position, err := ResolveCurrentPosition(document, "2026-03-10T13:00:00Z", types.ModelOverrides{})
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
