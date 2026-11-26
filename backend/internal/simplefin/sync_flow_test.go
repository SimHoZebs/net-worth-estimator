package simplefin

import (
	"context"
	"testing"
	"time"

	"github.com/simhozebs/net-worth-estimator/backend/internal/domain"
	"github.com/simhozebs/net-worth-estimator/backend/internal/store"
	"github.com/simhozebs/net-worth-estimator/backend/internal/types"
)

// flowTransaction builds adapter-shaped sync transactions: settled rows participate
// (enabled), pending seeds stay disabled, exactly as the translation emits them.
func flowTransaction(id, name, account, amount string, pending bool, day string) store.SyncTransaction {
	stamp, err := time.ParseInLocation("2006-01-02", day, time.UTC)
	if err != nil {
		stamp = time.Unix(1785628800, 0).UTC()
	}
	posted := stamp.Unix()
	if pending {
		posted = 0
	}
	return store.SyncTransaction{
		ProviderAccountID: testAccountKey("bridge-" + account),
		TransactionID:     id,
		Transaction: types.Transaction{
			Name:            name,
			Source:          store.SourceBankSync,
			SourceAccountID: &account,
			Amount:          types.TransactionAmountResolution{Resolver: "expression", Config: map[string]any{"expression": amount}, Inputs: map[string]types.AmountInputBinding{}},
			PostedTime:      posted,
			TransactionTime: stamp.Unix(),
			Enabled:         !pending,
			Pending:         pending,
		},
	}
}

func flowSettledTransaction(id, name, account, amount, occurredDay, postedDay string) store.SyncTransaction {
	transaction := flowTransaction(id, name, account, amount, false, occurredDay)
	posted, err := time.ParseInLocation("2006-01-02", postedDay, time.UTC)
	if err != nil {
		panic(err)
	}
	transaction.PostedTime = posted.Unix()
	return transaction
}

func applyFlow(t *testing.T, database store.Store, pending, settled []store.SyncTransaction) store.SyncApplySummary {
	t.Helper()
	bank, err := database.LoadBankTransactions()
	if err != nil {
		t.Fatal(err)
	}
	covered := map[string]bool{"checking": true, "prime_card": true}
	summary, err := database.ApplySync(nil, Reconcile(pending, settled, bank, covered))
	if err != nil {
		t.Fatalf("apply = %v", err)
	}
	return summary
}

func bankRowIDs(t *testing.T, database store.Store) map[string]types.Transaction {
	t.Helper()
	rows, err := database.LoadBankTransactions()
	if err != nil {
		t.Fatal(err)
	}
	out := map[string]types.Transaction{}
	for _, row := range rows {
		out[row.Transaction.ID] = row.Transaction
	}
	return out
}

func TestSyncFlowPendingConvertsToSettled(t *testing.T) {
	database := openRunnerStore(t)
	seedRunnerAccounts(t, database)
	first := applyFlow(t, database,
		[]store.SyncTransaction{flowTransaction("pend-a", "Corner Store", "prime_card", "42.10", true, "2026-08-02")}, nil)
	if first.PendingInserted != 1 {
		t.Fatalf("seed = %+v", first)
	}
	rows := bankRowIDs(t, database)
	if len(rows) != 1 {
		t.Fatalf("pending rows = %v", rows)
	}
	// The posted charge arrives under a new id: the hold itself becomes
	// the posted charge, keeping its UUID and original occurred date.
	second := applyFlow(t, database, nil,
		[]store.SyncTransaction{flowSettledTransaction("post-a", "Corner Store", "prime_card", "42.10", "2026-08-02", "2026-08-03")})
	if second.SettledConverted != 1 || second.SettledInserted != 0 || second.PendingDeleted != 0 {
		t.Fatalf("settle = %+v, want one convert of the hold", second)
	}
	after := bankRowIDs(t, database)
	if len(after) != 1 {
		t.Fatalf("settle rows = %v, want the hold updated to posted", after)
	}
	var pendingID string
	for id := range rows {
		pendingID = id
	}
	row, ok := after[pendingID]
	if !ok {
		t.Fatalf("settle id = %v, want the hold's id %s", after, pendingID)
	}
	if row.Pending || row.Void || !row.Enabled || row.TransactionTime != 1785628800 || row.PostedTime != 1785715200 {
		t.Fatalf("settled row = %+v, want occurred 2026-08-02 and posted 2026-08-03", row)
	}
	// The settled charge stays in later feeds without duplicating.
	third := applyFlow(t, database, nil,
		[]store.SyncTransaction{flowSettledTransaction("post-a", "Corner Store", "prime_card", "42.10", "2026-08-02", "2026-08-03")})
	if third.SettledConverted != 0 || third.SettledInserted != 0 || third.PendingDeleted != 0 || third.PendingUpdated != 0 {
		t.Fatalf("repeat = %+v", third)
	}
	if len(bankRowIDs(t, database)) != 1 {
		t.Fatal("repeat feed duplicated the settled row")
	}
}

func TestSyncFlowClaimedHoldSettlesInPlace(t *testing.T) {
	database := openRunnerStore(t)
	seedRunnerAccounts(t, database)
	first := applyFlow(t, database,
		[]store.SyncTransaction{flowTransaction("auth-a", "Corner Store", "prime_card", "42.10", true, "2026-08-02")}, nil)
	if first.PendingInserted != 1 {
		t.Fatalf("seed = %+v", first)
	}
	rows := bankRowIDs(t, database)
	if len(rows) != 1 {
		t.Fatalf("pending rows = %v", rows)
	}
	var id string
	for rowID := range rows {
		id = rowID
	}
	if _, err := database.CreateSchedule(types.Schedule{
		ID: "corner", Name: "Corner Store", Recurrence: types.Recurrence{Unit: types.RecurrenceMonth, Interval: 1, MonthlyMode: types.RecurrenceMonthlyByDate},
		StartDate: "2026-08-01", Enabled: true,
		Amount: types.TransactionAmountResolution{Resolver: "expression", Config: map[string]any{"expression": "42.10"}, Inputs: map[string]types.AmountInputBinding{}},
	}); err != nil {
		t.Fatalf("rule = %v", err)
	}
	if _, err := database.SetTransactionClaims([]types.TransactionClaimUpdate{{
		TransactionID: id,
		Claim:         types.TransactionClaim{ScheduleID: "corner", OccurrenceDate: "2026-08-01"},
	}}); err != nil {
		t.Fatalf("claim = %v", err)
	}
	// The posted charge arrives under a new id: it joins the claimed hold
	// instead of inserting beside it, and the claim survives.
	second := applyFlow(t, database, nil,
		[]store.SyncTransaction{flowTransaction("post-a", "Corner Store", "prime_card", "42.10", false, "2026-08-03")})
	if second.SettledConverted != 1 || second.SettledInserted != 0 || second.PendingDeleted != 0 {
		t.Fatalf("settle = %+v, want one convert of the claimed hold", second)
	}
	after := bankRowIDs(t, database)
	if len(after) != 1 {
		t.Fatalf("settle rows = %v, want the hold updated to posted", after)
	}
	row, ok := after[id]
	if !ok {
		t.Fatalf("convert changed identity: %v", after)
	}
	if row.Pending || !row.Enabled {
		t.Fatalf("settled row = %+v", row)
	}
	if row.TransactionTime != 1785628800 || row.PostedTime != 1785715200 {
		t.Fatalf("settled occurred/posted = %d/%d, want 1785628800/1785715200", row.TransactionTime, row.PostedTime)
	}
	if row.Claim == nil || row.Claim.ScheduleID != "corner" {
		t.Fatalf("claim lost on settle: %+v", row)
	}
}

func TestSyncFlowClaimedConversionTargetsRequireProvisionalPosting(t *testing.T) {
	t.Run("settled owner-edited claim is not a conversion target", func(t *testing.T) {
		database := openRunnerStore(t)
		seedRunnerAccounts(t, database)
		if first := applyFlow(t, database, nil, []store.SyncTransaction{
			flowTransaction("post-a", "Corner Store", "prime_card", "42.10", false, "2026-08-02"),
		}); first.SettledInserted != 1 {
			t.Fatalf("settled seed = %+v", first)
		}
		rows := bankRowIDs(t, database)
		var id string
		for rowID := range rows {
			id = rowID
		}
		if _, err := database.CreateSchedule(types.Schedule{
			ID: "corner", Name: "Corner Store", Recurrence: types.Recurrence{Unit: types.RecurrenceMonth, Interval: 1, MonthlyMode: types.RecurrenceMonthlyByDate},
			StartDate: "2026-08-01", Enabled: true,
			Amount: types.TransactionAmountResolution{Resolver: "expression", Config: map[string]any{"expression": "43.00"}, Inputs: map[string]types.AmountInputBinding{}},
		}); err != nil {
			t.Fatalf("rule = %v", err)
		}
		claimed, err := database.SetTransactionClaims([]types.TransactionClaimUpdate{{
			TransactionID: id,
			Claim:         types.TransactionClaim{ScheduleID: "corner", OccurrenceDate: "2026-08-01"},
		}})
		if err != nil || len(claimed) != 1 || claimed[0].PostedTimeProvisional {
			t.Fatalf("settled claim = %+v, err %v", claimed, err)
		}
		edited := claimed[0]
		edited.Name = "Corner Store owner confirmed"
		edited.Amount = types.TransactionAmountResolution{Resolver: "expression", Config: map[string]any{"expression": "43.00"}, Inputs: map[string]types.AmountInputBinding{}}
		edited.Enabled = false
		if _, err := database.UpdateTransaction(edited); err != nil {
			t.Fatalf("owner edit = %v", err)
		}

		summary := applyFlow(t, database, nil, []store.SyncTransaction{
			flowSettledTransaction("post-b", "Corner Store", "prime_card", "43.00", "2026-08-02", "2026-08-03"),
		})
		if summary.SettledConverted != 0 || summary.SettledInserted != 1 {
			t.Fatalf("new-key candidate = %+v, want a separate insert rather than conversion", summary)
		}
		after := bankRowIDs(t, database)
		row, ok := after[id]
		if !ok || row.Name != edited.Name || row.Enabled || row.PostedTimeProvisional || row.Claim == nil || row.TransactionTime != 1785628800 || row.PostedTime != 1785628800 {
			t.Fatalf("settled owner-edited claim changed: before %+v after %+v", edited, row)
		}
		if expression, _ := row.Amount.Config["expression"].(string); expression != "43.00" {
			t.Fatalf("settled owner-edited amount changed: %q", expression)
		}
	})

	t.Run("provisional claimed hold still converts and preserves occurred time", func(t *testing.T) {
		database := openRunnerStore(t)
		seedRunnerAccounts(t, database)
		if first := applyFlow(t, database, []store.SyncTransaction{
			flowTransaction("auth-a", "Corner Store", "prime_card", "42.10", true, "2026-08-02"),
		}, nil); first.PendingInserted != 1 {
			t.Fatalf("pending seed = %+v", first)
		}
		rows := bankRowIDs(t, database)
		var id string
		for rowID := range rows {
			id = rowID
		}
		if _, err := database.CreateSchedule(types.Schedule{
			ID: "corner", Name: "Corner Store", Recurrence: types.Recurrence{Unit: types.RecurrenceMonth, Interval: 1, MonthlyMode: types.RecurrenceMonthlyByDate},
			StartDate: "2026-08-01", Enabled: true,
			Amount: types.TransactionAmountResolution{Resolver: "expression", Config: map[string]any{"expression": "42.10"}, Inputs: map[string]types.AmountInputBinding{}},
		}); err != nil {
			t.Fatalf("rule = %v", err)
		}
		claimed, err := database.SetTransactionClaims([]types.TransactionClaimUpdate{{
			TransactionID: id,
			Claim:         types.TransactionClaim{ScheduleID: "corner", OccurrenceDate: "2026-08-01"},
		}})
		if err != nil || len(claimed) != 1 || !claimed[0].PostedTimeProvisional {
			t.Fatalf("provisional claim = %+v, err %v", claimed, err)
		}

		summary := applyFlow(t, database, nil, []store.SyncTransaction{
			flowSettledTransaction("post-b", "Corner Store", "prime_card", "42.10", "2026-08-02", "2026-08-03"),
		})
		if summary.SettledConverted != 1 || summary.SettledInserted != 0 {
			t.Fatalf("new-key settlement = %+v, want one conversion", summary)
		}
		after := bankRowIDs(t, database)
		row, ok := after[id]
		if !ok || row.Pending || row.Void || !row.Enabled || row.PostedTimeProvisional || row.Claim == nil || row.TransactionTime != 1785628800 || row.PostedTime != 1785715200 {
			t.Fatalf("provisional claim conversion = %+v, want stable id and occurred 2026-08-02", row)
		}
	})
}

func TestSyncFlowTipAdjustedSettleConverts(t *testing.T) {
	database := openRunnerStore(t)
	seedRunnerAccounts(t, database)
	// Dinner authorizes $50, then posts at $58 with the tip: the hold
	// itself becomes the posted charge, keeping its UUID.
	first := applyFlow(t, database,
		[]store.SyncTransaction{flowTransaction("auth-a", "Bistro", "prime_card", "50.00", true, "2026-08-02")}, nil)
	if first.PendingInserted != 1 {
		t.Fatalf("seed = %+v", first)
	}
	second := applyFlow(t, database, nil,
		[]store.SyncTransaction{flowTransaction("post-a", "Bistro", "prime_card", "58.00", false, "2026-08-03")})
	if second.SettledConverted != 1 || second.SettledInserted != 0 || second.PendingDeleted != 0 {
		t.Fatalf("tip settle = %+v, want one convert of the hold", second)
	}
	after := bankRowIDs(t, database)
	if len(after) != 1 {
		t.Fatalf("tip settle rows = %+v, want the hold updated to posted", after)
	}
	for _, row := range after {
		if row.Pending {
			t.Fatalf("live hold remains = %+v", row)
		}
	}
	// A repeat of the identical feed is a stable no-op.
	third := applyFlow(t, database, nil,
		[]store.SyncTransaction{flowTransaction("post-a", "Bistro", "prime_card", "58.00", false, "2026-08-03")})
	if third.SettledConverted != 0 || third.SettledInserted != 0 || third.PendingDeleted != 0 {
		t.Fatalf("repeat = %+v", third)
	}
}

func TestSyncFlowVanishedPendingVoidsAndHeals(t *testing.T) {
	database := openRunnerStore(t)
	seedRunnerAccounts(t, database)
	applyFlow(t, database,
		[]store.SyncTransaction{flowTransaction("pend-a", "Corner Store", "prime_card", "42.10", true, "2026-08-02")}, nil)
	voided := applyFlow(t, database, nil, nil)
	if voided.PendingDeleted != 1 {
		t.Fatalf("void = %+v", voided)
	}
	rows := bankRowIDs(t, database)
	if len(rows) != 1 {
		t.Fatalf("void deleted the row: %+v", rows)
	}
	for _, row := range rows {
		if row.Pending || !row.Void {
			t.Fatalf("void state = %+v", row)
		}
	}
	healed := applyFlow(t, database,
		[]store.SyncTransaction{flowTransaction("pend-a", "Corner Store", "prime_card", "42.10", true, "2026-08-04")}, nil)
	if healed.PendingUpdated != 1 || healed.PendingInserted != 0 {
		t.Fatalf("heal = %+v", healed)
	}
	if len(bankRowIDs(t, database)) != 1 {
		t.Fatal("heal duplicated the row")
	}
}

func TestSyncFlowAmbiguousSettleVoidsAndInsertsBoth(t *testing.T) {
	database := openRunnerStore(t)
	seedRunnerAccounts(t, database)
	applyFlow(t, database,
		[]store.SyncTransaction{flowTransaction("pend-a", "Corner Store", "prime_card", "42.10", true, "2026-08-02")}, nil)
	summary := applyFlow(t, database, nil, []store.SyncTransaction{
		flowTransaction("post-a", "Corner Store", "prime_card", "42.10", false, "2026-08-03"),
		flowTransaction("post-b", "Corner Store late", "prime_card", "42.10", false, "2026-08-04"),
	})
	if summary.SettledConverted != 0 || summary.SettledInserted != 2 || summary.PendingDeleted != 1 {
		t.Fatalf("ambiguous = %+v", summary)
	}
	if len(bankRowIDs(t, database)) != 3 {
		t.Fatal("ambiguous settle lost a real charge")
	}
}

func TestSyncFlowPreservesOwnerDisabledSettledBankRow(t *testing.T) {
	database := openRunnerStore(t)
	seedRunnerAccounts(t, database)
	// Settle one posted charge through the normal path.
	first := applyFlow(t, database, nil,
		[]store.SyncTransaction{flowTransaction("post-a", "Corner Store", "prime_card", "42.10", false, "2026-08-03")})
	if first.SettledInserted != 1 {
		t.Fatalf("seed = %+v", first)
	}
	rows := bankRowIDs(t, database)
	var id string
	for rowID := range rows {
		id = rowID
	}
	// The owner explicitly excludes the settled row. UpdateTransaction persists
	// Enabled for settled bank rows while keeping their provenance.
	disabled := rows[id]
	disabled.Enabled = false
	updated, err := database.UpdateTransaction(disabled)
	if err != nil || updated.Enabled {
		t.Fatalf("owner disable = %+v, err %v", updated, err)
	}
	// A repeat of the identical feed is a stable no-op: the recorded key
	// is never reprocessed, so the explicit exclusion is not reactivated
	// and no duplicate appears.
	second := applyFlow(t, database, nil,
		[]store.SyncTransaction{flowTransaction("post-a", "Corner Store", "prime_card", "42.10", false, "2026-08-03")})
	if second.SettledInserted != 0 || second.SettledConverted != 0 || second.PendingUpdated != 0 {
		t.Fatalf("repeat = %+v, want no directives", second)
	}
	after := bankRowIDs(t, database)
	if len(after) != 1 {
		t.Fatalf("repeat duplicated the bank row: %+v", after)
	}
	if after[id].Enabled {
		t.Fatalf("repeat reactivated the owner exclusion: %+v", after[id])
	}
}

func settledFeed(t *testing.T, posted, transacted int64) AccountSet {
	t.Helper()
	transactedAt := transacted
	return AccountSet{Accounts: []Account{{
		ID: "bridge-checking", ConnID: testConnID, Name: "Checking", Currency: "USD",
		Balance: "1000.00", BalanceDate: 1773133200, // 09:00 observation
		Transactions: []Transaction{{
			ID: "exp1", Posted: posted, Amount: "-100.00",
			Description: "Groceries", TransactedAt: &transactedAt,
		}},
	}}}
}

func pendingFlowFeed(id string, occurred int64) *AccountSet {
	pending := true
	return &AccountSet{Accounts: []Account{{
		ID: "bridge-checking", ConnID: testConnID, Name: "Checking", Currency: "USD",
		Balance: "1000.00", BalanceDate: 1773133200,
		Transactions: []Transaction{{
			ID: id, Posted: 0, Amount: "-100.00", Description: "Groceries", Pending: &pending, TransactedAt: &occurred,
		}},
	}}}
}

func settledFlowFeedWithoutTransactedAt(id string, posted int64) *AccountSet {
	return &AccountSet{Accounts: []Account{{
		ID: "bridge-checking", ConnID: testConnID, Name: "Checking", Currency: "USD",
		Balance: "1000.00", BalanceDate: 1773133200,
		Transactions: []Transaction{{
			ID: id, Posted: posted, Amount: "-100.00", Description: "Groceries",
		}},
	}}}
}

func seedFlowChecking(t *testing.T, database store.Store) {
	t.Helper()
	if _, err := database.CreateAccount(types.Account{ID: "checking", Name: "Checking", Kind: types.AccountKindCash, Enabled: true}); err != nil {
		t.Fatalf("seed account: %v", err)
	}
	if _, err := database.SaveAccountLink(store.AccountLink{BridgeAccountID: testAccountKey("bridge-checking"), ModelAccountID: "checking", Origin: store.LinkOriginManual}); err != nil {
		t.Fatalf("seed link: %v", err)
	}
}

func applyProviderFeed(t *testing.T, database store.Store, set *AccountSet, now time.Time) (store.SyncApplySummary, *types.FinancialModel) {
	t.Helper()
	translation, err := Translate(set, map[string]string{testAccountKey("bridge-checking"): "checking"}, now)
	if err != nil {
		t.Fatalf("translate: %v", err)
	}
	var checkpoints []store.SyncCheckpoint
	for _, checkpoint := range translation.Checkpoints {
		checkpoints = append(checkpoints, store.SyncCheckpoint{AccountID: checkpoint.AccountID, Balance: checkpoint.Balance, Source: store.SourceBankSync, Provider: store.ProviderSimpleFIN, ObservedAt: checkpoint.ObservedAt})
	}
	bank, err := database.LoadBankTransactions()
	if err != nil {
		t.Fatal(err)
	}
	summary, err := database.ApplySync(checkpoints, Reconcile(translation.Pending, translation.Settled, bank, map[string]bool{"checking": true}))
	if err != nil {
		t.Fatalf("apply: %v", err)
	}
	model, err := database.LoadModel()
	if err != nil {
		t.Fatal(err)
	}
	return summary, model
}

// First sync against a blank model provisions the account and imports the
// checkpoint and the settled transaction together. Provisioning runs
// before translation, so the snapshot is final when rows are emitted and
// the first sync drops nothing as unmapped. 09:00 observation 1000,
// settled -100 posted 11:00; the 12:00 position is 900 on the first sync,
// not only the second.
func TestFirstSyncImportsCheckpointAndSettledTogether(t *testing.T) {
	database := openRunnerStore(t)
	if err := database.InitializeModel(); err != nil {
		t.Fatal(err)
	}
	runner := NewRunner(database, Config{}, nil)
	runner.now = func() time.Time { return time.Unix(1773144000, 0).UTC() }
	runner.fetch = func(context.Context, time.Time, time.Time) (*AccountSet, error) {
		set := settledFeed(t, 1773140400, 1773129600)
		return &set, nil
	}
	assertPosition := func(sync string) {
		t.Helper()
		model, err := database.LoadModel()
		if err != nil {
			t.Fatal(err)
		}
		if len(model.Transactions) != 1 {
			t.Fatalf("%s: transactions = %d, want 1 translated settled row", sync, len(model.Transactions))
		}
		position, err := domain.ResolveCurrentPosition(model, "2026-03-10T12:00:00Z", types.ModelOverrides{})
		if err != nil {
			t.Fatal(err)
		}
		if got := position.NetWorth; got != 900 {
			t.Fatalf("%s: 12:00 position = %v, want 900 (09:00 anchor 1000 minus 11:00 actual)", sync, got)
		}
	}
	if err := runner.Sync(context.Background()); err != nil {
		t.Fatalf("first sync: %v", err)
	}
	applied, err := database.LoadModel()
	if err != nil {
		t.Fatal(err)
	}
	if len(applied.Accounts) != 1 || len(applied.Checkpoints) != 1 {
		t.Fatalf("first sync applied = %+v, want 1 provisioned account + 1 checkpoint", applied)
	}
	assertPosition("first sync")
	if err := runner.Sync(context.Background()); err != nil {
		t.Fatalf("second sync: %v", err)
	}
	assertPosition("second sync")
}

// End-to-end provider feed: a settled posted expense participates as an
// ordinary actual from Translate through projection. 09:00 observation 1000,
// purchase 08:00 but posted 11:00, cut 12:00 => 900.
func TestSettledBankActualEndToEndFromProviderFeed(t *testing.T) {
	database := openRunnerStore(t)
	seedFlowChecking(t, database)
	now := time.Unix(1773140400, 0).UTC()
	set := settledFeed(t, 1773140400, 1773129600)
	translation, err := Translate(&set, map[string]string{testAccountKey("bridge-checking"): "checking"}, now)
	if err != nil {
		t.Fatalf("translate: %v", err)
	}
	if len(translation.Settled) != 1 {
		t.Fatalf("settled = %+v, want 1", translation.Settled)
	}
	if !translation.Settled[0].Transaction.Enabled {
		t.Fatalf("settled bank actual must participate: %+v", translation.Settled[0].Transaction)
	}
	if translation.Settled[0].Transaction.TransactionTime != 1773129600 || translation.Settled[0].Transaction.PostedTime != 1773140400 {
		t.Fatalf("settled occurred/posted = %d/%d, want 1773129600/1773140400", translation.Settled[0].Transaction.TransactionTime, translation.Settled[0].Transaction.PostedTime)
	}
	_, model := applyProviderFeed(t, database, &set, now)
	position, err := domain.ResolveCurrentPosition(model, "2026-03-10T12:00:00Z", types.ModelOverrides{})
	if err != nil {
		t.Fatal(err)
	}
	if got := position.Accounts[0].Balance; got != 900 {
		t.Fatalf("12:00 position = %v, want 900", got)
	}
	_, result, err := domain.ProjectRawFinancialModel(model,
		&types.ProjectionRuntimeSettings{FallbackProjectionStartDate: "2026-03-10", HorizonYears: 1},
		types.ModelOverrides{}, nil)
	if err != nil {
		t.Fatal(err)
	}
	if result.Summary.CurrentNetWorth != position.NetWorth {
		t.Fatalf("projection net worth %v != position net worth %v", result.Summary.CurrentNetWorth, position.NetWorth)
	}
	// A repeat of the identical feed is a stable no-op: one transaction held,
	// balances unchanged.
	bank, err := database.LoadBankTransactions()
	if err != nil {
		t.Fatal(err)
	}
	repeat, err := database.ApplySync(nil, Reconcile(nil, translation.Settled, bank, map[string]bool{"checking": true}))
	if err != nil {
		t.Fatalf("repeat: %v", err)
	}
	if repeat.SettledInserted != 0 || repeat.SettledConverted != 0 || repeat.PendingUpdated != 0 || repeat.PendingDeleted != 0 || repeat.CheckpointsInserted != 0 {
		t.Fatalf("repeat feed must be a no-op: %+v", repeat)
	}
	again, err := database.LoadModel()
	if err != nil {
		t.Fatal(err)
	}
	if len(again.Transactions) != 1 {
		t.Fatalf("repeat feed duplicated the bank row: %+v", again.Transactions)
	}
	position, err = domain.ResolveCurrentPosition(again, "2026-03-10T12:00:00Z", types.ModelOverrides{})
	if err != nil {
		t.Fatal(err)
	}
	if got := position.Accounts[0].Balance; got != 900 {
		t.Fatalf("12:00 position after repeat = %v, want 900", got)
	}
}

func TestPendingSeedSettlementPreservesDatesForSameAndNewKeys(t *testing.T) {
	const occurred = int64(1773129600)
	const posted = int64(1773140400)
	for _, test := range []struct {
		name     string
		sameKey  bool
		postedID string
	}{
		{name: "same key", sameKey: true, postedID: "auth1"},
		{name: "unique new key", postedID: "post1"},
	} {
		t.Run(test.name, func(t *testing.T) {
			database := openRunnerStore(t)
			seedFlowChecking(t, database)
			first, pendingModel := applyProviderFeed(t, database, pendingFlowFeed("auth1", occurred), time.Unix(1773133200, 0).UTC())
			if first.PendingInserted != 1 || len(pendingModel.Transactions) != 1 {
				t.Fatalf("pending seed = %+v, rows = %+v", first, pendingModel.Transactions)
			}
			id := pendingModel.Transactions[0].ID
			if pendingModel.Transactions[0].TransactionTime != occurred || pendingModel.Transactions[0].PostedTime != 0 {
				t.Fatalf("pending dates = %+v, want occurred %d and no posted date", pendingModel.Transactions[0], occurred)
			}

			feed := settledFlowFeedWithoutTransactedAt(test.postedID, posted)
			second, model := applyProviderFeed(t, database, feed, time.Unix(1773140400, 0).UTC())
			if test.sameKey {
				if second.PendingUpdated != 1 || second.SettledInserted != 0 || second.SettledConverted != 0 || second.PendingDeleted != 0 {
					t.Fatalf("same-key settlement = %+v, want one upsert", second)
				}
			} else if second.SettledConverted != 1 || second.SettledInserted != 0 || second.PendingUpdated != 0 || second.PendingDeleted != 0 {
				t.Fatalf("new-key settlement = %+v, want one conversion", second)
			}
			if len(model.Transactions) != 1 {
				t.Fatalf("settlement rows = %+v, want exactly one", model.Transactions)
			}
			row := model.Transactions[0]
			if row.ID != id || row.Pending || row.Void || !row.Enabled || row.TransactionTime != occurred || row.PostedTime != posted {
				t.Fatalf("settled row = %+v, want stable UUID %s, occurred %d, posted %d", row, id, occurred, posted)
			}
			bank, err := database.LoadBankTransactions()
			if err != nil || len(bank) != 1 || len(bank[0].Keys) != 1 || bank[0].Keys[0].TransactionID != test.postedID {
				t.Fatalf("settled bank rows = %+v, err %v, want posted key %s", bank, err, test.postedID)
			}
			position, err := domain.ResolveCurrentPosition(model, "2026-03-10T12:00:00Z", types.ModelOverrides{})
			if err != nil || position.Accounts[0].Balance != 900 {
				t.Fatalf("12:00 position = %+v, err %v, want 900", position, err)
			}

			translation, err := Translate(feed, map[string]string{testAccountKey("bridge-checking"): "checking"}, time.Unix(1773144000, 0).UTC())
			if err != nil {
				t.Fatal(err)
			}
			directives := Reconcile(translation.Pending, translation.Settled, bank, map[string]bool{"checking": true})
			upserts, converts, voids := directivesByAction(directives)
			if upserts != 0 || converts != 0 || len(voids) != 0 {
				t.Fatalf("repeat directives = %+v, want no financial writes", directives)
			}
			repeat, err := database.ApplySync(nil, directives)
			if err != nil || repeat != (store.SyncApplySummary{}) {
				t.Fatalf("repeat = %+v, err %v, want no churn", repeat, err)
			}
			again, err := database.LoadBankTransactions()
			if err != nil || len(again) != 1 {
				t.Fatalf("repeat rows = %+v, err %v", again, err)
			}
			repeated := again[0].Transaction
			if repeated.ID != id || repeated.TransactionTime != occurred || repeated.PostedTime != posted || repeated.Pending || repeated.Void {
				t.Fatalf("repeat changed settled row: %+v", repeated)
			}
		})
	}
}

func TestSameKeyClaimedHoldReceivesRealPostingEndToEnd(t *testing.T) {
	const occurred = int64(1773129600)
	const posted = int64(1773140400)
	database := openRunnerStore(t)
	seedFlowChecking(t, database)
	first, model := applyProviderFeed(t, database, pendingFlowFeed("auth1", occurred), time.Unix(1773133200, 0).UTC())
	if first.PendingInserted != 1 || len(model.Transactions) != 1 {
		t.Fatalf("pending seed = %+v, rows = %+v", first, model.Transactions)
	}
	id := model.Transactions[0].ID
	if _, err := database.CreateSchedule(types.Schedule{
		ID: "corner", Name: "Corner Store", Recurrence: types.Recurrence{Unit: types.RecurrenceMonth, Interval: 1, MonthlyMode: types.RecurrenceMonthlyByDate},
		StartDate: "2026-08-01", Enabled: true,
		Amount: types.TransactionAmountResolution{Resolver: "expression", Config: map[string]any{"expression": "100.00"}, Inputs: map[string]types.AmountInputBinding{}},
	}); err != nil {
		t.Fatalf("rule = %v", err)
	}
	claimed := model.Transactions[0]
	claimed.Claim = &types.TransactionClaim{ScheduleID: "corner", OccurrenceDate: "2026-08-01"}
	if _, err := database.UpdateTransaction(claimed); err != nil {
		t.Fatalf("claim = %v", err)
	}
	claimedModel, err := database.LoadModel()
	if err != nil || len(claimedModel.Transactions) != 1 {
		t.Fatalf("claimed rows = %+v, err %v", claimedModel, err)
	}
	claimedRow := claimedModel.Transactions[0]
	if claimedRow.ID != id || claimedRow.Pending || !claimedRow.Enabled || claimedRow.Claim == nil || claimedRow.PostedTime != occurred || !claimedRow.PostedTimeProvisional {
		t.Fatalf("claimed row = %+v, want stable UUID %s and provisional posted time %d", claimedRow, id, occurred)
	}

	feed := settledFlowFeedWithoutTransactedAt("auth1", posted)
	second, settledModel := applyProviderFeed(t, database, feed, time.Unix(1773140400, 0).UTC())
	if second.PendingUpdated != 1 || second.SettledInserted != 0 || second.SettledConverted != 0 || second.PendingDeleted != 0 {
		t.Fatalf("real posting = %+v, want one same-key upsert", second)
	}
	bank, err := database.LoadBankTransactions()
	if err != nil || len(bank) != 1 {
		t.Fatalf("settled bank rows = %+v, err %v, want exactly one", bank, err)
	}
	row := bank[0].Transaction
	if row.ID != id || row.Pending || row.Void || !row.Enabled || row.TransactionTime != occurred || row.PostedTime != posted || row.PostedTimeProvisional {
		t.Fatalf("real posted row = %+v, want stable UUID %s, occurred %d, posted %d", row, id, occurred, posted)
	}
	if row.Claim == nil || row.Claim.ScheduleID != "corner" || row.Claim.OccurrenceDate != "2026-08-01" {
		t.Fatalf("claim lost on real posting: %+v", row.Claim)
	}
	if len(settledModel.Transactions) != 1 {
		t.Fatalf("settled model rows = %+v, want exactly one", settledModel.Transactions)
	}

	translation, err := Translate(feed, map[string]string{testAccountKey("bridge-checking"): "checking"}, time.Unix(1773144000, 0).UTC())
	if err != nil {
		t.Fatal(err)
	}
	directives := Reconcile(translation.Pending, translation.Settled, bank, map[string]bool{"checking": true})
	upserts, converts, voids := directivesByAction(directives)
	if upserts != 0 || converts != 0 || len(voids) != 0 {
		t.Fatalf("repeat directives = %+v, want no financial writes", directives)
	}
	repeat, err := database.ApplySync(nil, directives)
	if err != nil || repeat != (store.SyncApplySummary{}) {
		t.Fatalf("repeat = %+v, err %v, want no churn", repeat, err)
	}
	again, err := database.LoadBankTransactions()
	if err != nil || len(again) != 1 {
		t.Fatalf("repeat rows = %+v, err %v", again, err)
	}
	repeated := again[0].Transaction
	if repeated.ID != id || repeated.TransactionTime != occurred || repeated.PostedTime != posted || repeated.Claim == nil || repeated.Claim.ScheduleID != "corner" {
		t.Fatalf("repeat changed claimed settlement: %+v", repeated)
	}
}

func TestAutoClaimedHoldReceivesSameInstantFinalPostingEndToEnd(t *testing.T) {
	const occurred = int64(1773129600)
	database := openRunnerStore(t)
	seedFlowChecking(t, database)
	if _, err := database.CreateSchedule(types.Schedule{
		ID: "groceries", Name: "Groceries", SourceAccountID: &[]string{"checking"}[0], Recurrence: types.Recurrence{Unit: types.RecurrenceMonth, Interval: 1, MonthlyMode: types.RecurrenceMonthlyByDate},
		StartDate: "2026-03-10", Enabled: true,
		Amount: types.TransactionAmountResolution{Resolver: "expression", Config: map[string]any{"expression": "100.00"}, Inputs: map[string]types.AmountInputBinding{}},
	}); err != nil {
		t.Fatalf("rule = %v", err)
	}
	first, model := applyProviderFeed(t, database, pendingFlowFeed("auth1", occurred), time.Unix(1773133200, 0).UTC())
	if first.PendingInserted != 1 || len(model.Transactions) != 1 {
		t.Fatalf("pending seed = %+v, rows = %+v", first, model.Transactions)
	}
	claimed := model.Transactions[0]
	if claimed.Claim == nil || claimed.Claim.ScheduleID != "groceries" || claimed.Pending || !claimed.Enabled {
		t.Fatalf("auto-claimed hold = %+v", claimed)
	}
	if claimed.PostedTime != occurred || !claimed.PostedTimeProvisional {
		t.Fatalf("auto-claimed hold posted time = %d, want provisional occurred instant %d", claimed.PostedTime, occurred)
	}

	finalFeed := settledFlowFeedWithoutTransactedAt("auth1", occurred)
	finalFeed.Accounts[0].Transactions[0].Amount = "-125.00"
	finalFeed.Accounts[0].Transactions[0].Description = "GROCERIES FINAL"
	second, settledModel := applyProviderFeed(t, database, finalFeed, time.Unix(1773140400, 0).UTC())
	if second.PendingUpdated != 1 || second.SettledInserted != 0 || second.SettledConverted != 0 || second.PendingDeleted != 0 {
		t.Fatalf("same-instant final posting = %+v, want one same-key upsert", second)
	}
	if len(settledModel.Transactions) != 1 {
		t.Fatalf("settled rows = %+v, want exactly one", settledModel.Transactions)
	}
	row := settledModel.Transactions[0]
	if row.ID != claimed.ID || row.TransactionTime != occurred || row.PostedTime != occurred || row.Pending || row.Void || !row.Enabled || row.PostedTimeProvisional {
		t.Fatalf("same-instant settled row = %+v", row)
	}
	if expression, _ := row.Amount.Config["expression"].(string); expression != "125.00" || row.Name != "GROCERIES FINAL" {
		t.Fatalf("final values not applied: amount %q name %q", expression, row.Name)
	}
	if row.Claim == nil || row.Claim.ScheduleID != "groceries" {
		t.Fatalf("claim lost on final posting: %+v", row.Claim)
	}

	bank, err := database.LoadBankTransactions()
	if err != nil || len(bank) != 1 {
		t.Fatalf("bank rows = %+v, err %v", bank, err)
	}
	translation, err := Translate(finalFeed, map[string]string{testAccountKey("bridge-checking"): "checking"}, time.Unix(1773144000, 0).UTC())
	if err != nil {
		t.Fatal(err)
	}
	directives := Reconcile(translation.Pending, translation.Settled, bank, map[string]bool{"checking": true})
	upserts, converts, voids := directivesByAction(directives)
	if upserts != 0 || converts != 0 || len(voids) != 0 {
		t.Fatalf("repeat directives = %+v, want no financial writes", directives)
	}
	if repeat, err := database.ApplySync(nil, directives); err != nil || repeat != (store.SyncApplySummary{}) {
		t.Fatalf("repeat = %+v, err %v, want no churn", repeat, err)
	}
}

func TestOwnerEditedPostedDateEqualToOccurredIsNotOverwritten(t *testing.T) {
	const occurred = int64(1773129600)
	database := openRunnerStore(t)
	seedFlowChecking(t, database)
	feed := settledFlowFeedWithoutTransactedAt("post1", occurred)
	first, model := applyProviderFeed(t, database, feed, time.Unix(1773140400, 0).UTC())
	if first.SettledInserted != 1 || len(model.Transactions) != 1 {
		t.Fatalf("settled seed = %+v, rows = %+v", first, model.Transactions)
	}
	if _, err := database.CreateSchedule(types.Schedule{
		ID: "groceries", Name: "Groceries", Recurrence: types.Recurrence{Unit: types.RecurrenceMonth, Interval: 1, MonthlyMode: types.RecurrenceMonthlyByDate},
		StartDate: "2026-03-10", Enabled: true,
		Amount: types.TransactionAmountResolution{Resolver: "expression", Config: map[string]any{"expression": "100.00"}, Inputs: map[string]types.AmountInputBinding{}},
	}); err != nil {
		t.Fatalf("rule = %v", err)
	}
	claimed, err := database.SetTransactionClaims([]types.TransactionClaimUpdate{{
		TransactionID: model.Transactions[0].ID,
		Claim:         types.TransactionClaim{ScheduleID: "groceries", OccurrenceDate: "2026-03-10"},
	}})
	if err != nil || len(claimed) != 1 {
		t.Fatalf("claim = %+v, err %v", claimed, err)
	}
	edited := claimed[0]
	edited.Name = "Owner edited grocer"
	edited.PostedTime = occurred
	edited, err = database.UpdateTransaction(edited)
	if err != nil {
		t.Fatalf("owner edit = %v", err)
	}
	if edited.PostedTime != occurred || edited.Name != "Owner edited grocer" || edited.PostedTimeProvisional {
		t.Fatalf("owner edit not preserved: %+v", edited)
	}

	bank, err := database.LoadBankTransactions()
	if err != nil || len(bank) != 1 {
		t.Fatalf("bank rows = %+v, err %v", bank, err)
	}
	later := settledFlowFeedWithoutTransactedAt("post1", occurred+3600)
	later.Accounts[0].Transactions[0].Amount = "-110.00"
	translation, err := Translate(later, map[string]string{testAccountKey("bridge-checking"): "checking"}, time.Unix(1773144000, 0).UTC())
	if err != nil {
		t.Fatal(err)
	}
	directives := Reconcile(translation.Pending, translation.Settled, bank, map[string]bool{"checking": true})
	upserts, converts, voids := directivesByAction(directives)
	if upserts != 0 || converts != 0 || len(voids) != 0 {
		t.Fatalf("owner-edited posted date was overwritten: %+v", directives)
	}
	after, err := database.LoadBankTransactions()
	if err != nil || len(after) != 1 || after[0].Transaction.PostedTime != occurred || after[0].Transaction.Name != edited.Name {
		t.Fatalf("owner-edited row changed: %+v, err %v", after, err)
	}
}

// End-to-end pending lifecycle: the authorization never moves balances;
// once posted under a new id the hold itself becomes the posted charge,
// keeping its UUID, and participates exactly once.
func TestPendingSeedConvertsToSettledEndToEnd(t *testing.T) {
	database := openRunnerStore(t)
	seedFlowChecking(t, database)
	now := time.Unix(1773133200, 0).UTC()
	pending := &[]bool{true}[0]
	feed := &AccountSet{Accounts: []Account{{
		ID: "bridge-checking", ConnID: testConnID, Name: "Checking", Currency: "USD",
		Balance: "1000.00", BalanceDate: 1773133200,
		Transactions: []Transaction{{
			ID: "auth1", Posted: 0, Amount: "-100.00",
			Description: "Groceries", Pending: pending, TransactedAt: &[]int64{1773129600}[0],
		}},
	}}}
	summary, model := applyProviderFeed(t, database, feed, now)
	if summary.PendingInserted != 1 {
		t.Fatalf("pending seed = %+v", summary)
	}
	position, err := domain.ResolveCurrentPosition(model, "2026-03-10T12:00:00Z", types.ModelOverrides{})
	if err != nil {
		t.Fatal(err)
	}
	if got := position.Accounts[0].Balance; got != 1000 {
		t.Fatalf("pending authorization must not move balances, got %v", got)
	}
	settled := settledFeed(t, 1773140400, 1773129600)
	second, converted := applyProviderFeed(t, database, &settled, time.Unix(1773140400, 0).UTC())
	if second.SettledConverted != 1 || second.SettledInserted != 0 || second.PendingDeleted != 0 {
		t.Fatalf("settlement = %+v, want one convert of the hold", second)
	}
	if len(converted.Transactions) != 1 {
		t.Fatalf("settlement rows = %d, want the hold updated to posted", len(converted.Transactions))
	}
	if converted.Transactions[0].Pending {
		t.Fatalf("settled row is still pending: %+v", converted.Transactions[0])
	}
	position, err = domain.ResolveCurrentPosition(converted, "2026-03-10T12:00:00Z", types.ModelOverrides{})
	if err != nil {
		t.Fatal(err)
	}
	if got := position.Accounts[0].Balance; got != 900 {
		t.Fatalf("12:00 position after settlement = %v, want 900 exactly once", got)
	}
}
