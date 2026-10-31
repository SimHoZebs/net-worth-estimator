package simplefin

import (
	"testing"
	"time"

	"github.com/simhozebs/net-worth-estimator/backend/internal/domain"
	"github.com/simhozebs/net-worth-estimator/backend/internal/store"
	"github.com/simhozebs/net-worth-estimator/backend/internal/types"
)

// flowPosting builds adapter-shaped sync postings: settled rows participate
// (enabled), pending seeds stay disabled, exactly as the mapper emits them.
func flowPosting(id, name, account, amount string, pending bool, day string) store.SyncPosting {
	stamp, err := time.ParseInLocation("2006-01-02", day, time.UTC)
	if err != nil {
		stamp = time.Unix(1785628800, 0).UTC()
	}
	return store.SyncPosting{
		ProviderAccountID: "bridge-" + account,
		TransactionID:     id,
		Posting: types.Posting{
			Name:            name,
			Source:          store.SourceSimpleFIN,
			SourceAccountID: &account,
			Amount:          types.PostingAmountResolution{Resolver: "expression", Config: map[string]any{"expression": amount}, Inputs: map[string]types.AmountInputBinding{}},
			PostedTime:      stamp.Unix(),
			TransactionTime: stamp.Unix(),
			Enabled:         !pending,
			Pending:         pending,
		},
	}
}

func applyFlow(t *testing.T, database store.Store, pending, settled []store.SyncPosting) store.SyncApplySummary {
	t.Helper()
	bank, err := database.LoadBankPostings()
	if err != nil {
		t.Fatal(err)
	}
	covered := map[string]bool{"checking": true, "prime_card": true}
	summary, err := database.ApplySyncPlan(nil, Reconcile(pending, settled, bank, covered))
	if err != nil {
		t.Fatalf("apply = %v", err)
	}
	return summary
}

func bankRowIDs(t *testing.T, database store.Store) map[string]types.Posting {
	t.Helper()
	rows, err := database.LoadBankPostings()
	if err != nil {
		t.Fatal(err)
	}
	out := map[string]types.Posting{}
	for _, row := range rows {
		out[row.Posting.ID] = row.Posting
	}
	return out
}

func TestSyncFlowPendingSettlesThroughConversion(t *testing.T) {
	database := openRunnerStore(t)
	seedRunnerAccounts(t, database)
	first := applyFlow(t, database,
		[]store.SyncPosting{flowPosting("pend-a", "Corner Store", "prime_card", "42.10", true, "2026-08-02")}, nil)
	if first.PendingInserted != 1 {
		t.Fatalf("seed = %+v", first)
	}
	rows := bankRowIDs(t, database)
	if len(rows) != 1 {
		t.Fatalf("pending rows = %v", rows)
	}
	var pendingID string
	for id := range rows {
		pendingID = id
	}
	second := applyFlow(t, database, nil,
		[]store.SyncPosting{flowPosting("post-a", "Corner Store", "prime_card", "42.10", false, "2026-08-03")})
	if second.SettledConverted != 1 || second.PendingDeleted != 0 {
		t.Fatalf("convert = %+v", second)
	}
	after := bankRowIDs(t, database)
	row, ok := after[pendingID]
	if !ok || row.Pending || row.Void || row.Source != store.SourceSimpleFIN || !row.Enabled {
		t.Fatalf("converted row = %+v, present %v", row, ok)
	}
	// The settled charge stays in later feeds without duplicating.
	third := applyFlow(t, database, nil,
		[]store.SyncPosting{flowPosting("post-a", "Corner Store", "prime_card", "42.10", false, "2026-08-03")})
	if third.SettledConverted != 0 || third.SettledInserted != 0 || third.PendingDeleted != 0 {
		t.Fatalf("repeat = %+v", third)
	}
	if len(bankRowIDs(t, database)) != 1 {
		t.Fatal("repeat feed duplicated the settled row")
	}
}

func TestSyncFlowVanishedPendingVoidsAndHeals(t *testing.T) {
	database := openRunnerStore(t)
	seedRunnerAccounts(t, database)
	applyFlow(t, database,
		[]store.SyncPosting{flowPosting("pend-a", "Corner Store", "prime_card", "42.10", true, "2026-08-02")}, nil)
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
		[]store.SyncPosting{flowPosting("pend-a", "Corner Store", "prime_card", "42.10", true, "2026-08-04")}, nil)
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
		[]store.SyncPosting{flowPosting("pend-a", "Corner Store", "prime_card", "42.10", true, "2026-08-02")}, nil)
	summary := applyFlow(t, database, nil, []store.SyncPosting{
		flowPosting("post-a", "Corner Store", "prime_card", "42.10", false, "2026-08-03"),
		flowPosting("post-b", "Corner Store late", "prime_card", "42.10", false, "2026-08-04"),
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
		[]store.SyncPosting{flowPosting("post-a", "Corner Store", "prime_card", "42.10", false, "2026-08-03")})
	if first.SettledInserted != 1 {
		t.Fatalf("seed = %+v", first)
	}
	rows := bankRowIDs(t, database)
	var id string
	for rowID := range rows {
		id = rowID
	}
	// The owner explicitly excludes the settled row. UpdatePosting persists
	// Enabled for settled bank rows while keeping their provenance.
	disabled := rows[id]
	disabled.Enabled = false
	updated, err := database.UpdatePosting(disabled)
	if err != nil || updated.Enabled {
		t.Fatalf("owner disable = %+v, err %v", updated, err)
	}
	// A repeat of the identical feed is a stable no-op: the recorded key
	// is never reprocessed, so the explicit exclusion is not reactivated
	// and no duplicate appears.
	second := applyFlow(t, database, nil,
		[]store.SyncPosting{flowPosting("post-a", "Corner Store", "prime_card", "42.10", false, "2026-08-03")})
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
		ID: "bridge-checking", Name: "Checking", Currency: "USD",
		Balance: "1000.00", BalanceDate: 1773133200, // 09:00 observation
		Transactions: []Transaction{{
			ID: "exp1", Posted: posted, Amount: "-100.00",
			Description: "Groceries", TransactedAt: &transactedAt,
		}},
	}}}
}

func seedFlowChecking(t *testing.T, database store.Store) {
	t.Helper()
	if _, err := database.CreateAccount(types.Account{ID: "checking", Name: "Checking", Kind: types.AccountKindCash, Enabled: true}); err != nil {
		t.Fatalf("seed account: %v", err)
	}
	if _, err := database.SaveAccountLink(store.AccountLink{BridgeAccountID: "bridge-checking", ModelAccountID: "checking", Origin: store.LinkOriginManual}); err != nil {
		t.Fatalf("seed link: %v", err)
	}
}

func applyProviderFeed(t *testing.T, database store.Store, set *AccountSet, now time.Time) (store.SyncApplySummary, *types.FinancialModel) {
	t.Helper()
	plan, err := Map(set, map[string]string{"bridge-checking": "checking"}, now)
	if err != nil {
		t.Fatalf("map: %v", err)
	}
	var checkpoints []store.SyncCheckpoint
	for _, checkpoint := range plan.Checkpoints {
		checkpoints = append(checkpoints, store.SyncCheckpoint{AccountID: checkpoint.AccountID, Balance: checkpoint.Balance, Source: store.SourceSimpleFIN, ObservedAt: checkpoint.ObservedAt})
	}
	bank, err := database.LoadBankPostings()
	if err != nil {
		t.Fatal(err)
	}
	summary, err := database.ApplySyncPlan(checkpoints, Reconcile(plan.Pending, plan.Settled, bank, map[string]bool{"checking": true}))
	if err != nil {
		t.Fatalf("apply: %v", err)
	}
	model, err := database.LoadModel()
	if err != nil {
		t.Fatal(err)
	}
	return summary, model
}

// End-to-end provider feed: a settled posted expense participates as an
// ordinary actual from Map through projection. 09:00 observation 1000,
// purchase 08:00 but posted 11:00, cut 12:00 => 900.
func TestSettledBankActualEndToEndFromProviderFeed(t *testing.T) {
	database := openRunnerStore(t)
	seedFlowChecking(t, database)
	now := time.Unix(1773140400, 0).UTC()
	set := settledFeed(t, 1773140400, 1773129600)
	plan, err := Map(&set, map[string]string{"bridge-checking": "checking"}, now)
	if err != nil {
		t.Fatalf("map: %v", err)
	}
	if len(plan.Settled) != 1 {
		t.Fatalf("settled = %+v, want 1", plan.Settled)
	}
	if !plan.Settled[0].Posting.Enabled {
		t.Fatalf("settled bank actual must participate: %+v", plan.Settled[0].Posting)
	}
	if plan.Settled[0].Posting.TransactionTime != 1773140400 {
		t.Fatalf("settled event time = %d, want posted instant 1773140400", plan.Settled[0].Posting.TransactionTime)
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
	// A repeat of the identical feed is a stable no-op: one posting held,
	// balances unchanged.
	bank, err := database.LoadBankPostings()
	if err != nil {
		t.Fatal(err)
	}
	repeat, err := database.ApplySyncPlan(nil, Reconcile(nil, plan.Settled, bank, map[string]bool{"checking": true}))
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
	if len(again.Postings) != 1 {
		t.Fatalf("repeat feed duplicated the bank row: %+v", again.Postings)
	}
	position, err = domain.ResolveCurrentPosition(again, "2026-03-10T12:00:00Z", types.ModelOverrides{})
	if err != nil {
		t.Fatal(err)
	}
	if got := position.Accounts[0].Balance; got != 900 {
		t.Fatalf("12:00 position after repeat = %v, want 900", got)
	}
}

// End-to-end pending lifecycle: the authorization never moves balances;
// once posted it converts in place and participates exactly once.
func TestPendingSeedConvertsToSettledEndToEnd(t *testing.T) {
	database := openRunnerStore(t)
	seedFlowChecking(t, database)
	now := time.Unix(1773133200, 0).UTC()
	pending := &[]bool{true}[0]
	feed := &AccountSet{Accounts: []Account{{
		ID: "bridge-checking", Name: "Checking", Currency: "USD",
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
	if second.SettledConverted != 1 {
		t.Fatalf("settlement = %+v, want one conversion", second)
	}
	if len(converted.Postings) != 1 {
		t.Fatalf("conversion duplicated the row: %+v", converted.Postings)
	}
	position, err = domain.ResolveCurrentPosition(converted, "2026-03-10T12:00:00Z", types.ModelOverrides{})
	if err != nil {
		t.Fatal(err)
	}
	if got := position.Accounts[0].Balance; got != 900 {
		t.Fatalf("12:00 position after settlement = %v, want 900 exactly once", got)
	}
}
