package store

import (
	"context"
	"path/filepath"
	"testing"
	"time"

	"github.com/google/uuid"

	"github.com/simhozebs/net-worth-estimator/backend/internal/types"
)

const syncTestAmountJSON = `{"resolver":"expression","config":{"expression":"50"},"inputs":{}}`
const ownerPostingID = "01900000-0000-7000-8000-000000000010"
const rawSyncedPostingID = "01900000-0000-7000-8000-000000000011"
const otherSyncedPostingID = "01900000-0000-7000-8000-000000000012"

func testSyncStateDefaultsEmptyAndRoundTrips(t *testing.T, newStore func(*testing.T) Store) {
	t.Helper()
	database := newStore(t)
	if got, err := database.GetLastSyncTime(); err != nil || got != "" {
		t.Fatalf("fresh last sync = %q, err %v, want empty", got, err)
	}
	if err := database.SetLastSyncTime("2026-10-18T14:30:00Z"); err != nil {
		t.Fatalf("record last sync: %v", err)
	}
	if got, err := database.GetLastSyncTime(); err != nil || got != "2026-10-18T14:30:00Z" {
		t.Fatalf("last sync = %q, err %v, want recorded time", got, err)
	}
	if err := database.Clear(); err != nil {
		t.Fatalf("clear: %v", err)
	}
	if got, err := database.GetLastSyncTime(); err != nil || got != "" {
		t.Fatalf("cleared last sync = %q, err %v, want empty", got, err)
	}
}

func withSourceUser(checkpoints []types.Checkpoint) []types.Checkpoint {
	out := make([]types.Checkpoint, len(checkpoints))
	for i, checkpoint := range checkpoints {
		checkpoint.Source = SourceUser
		out[i] = checkpoint
	}
	return out
}

func execSyncSetup(t *testing.T, store *sqliteStore, statements []string) {
	t.Helper()
	tx, err := store.db.Begin()
	if err != nil {
		t.Fatalf("begin sync setup: %v", err)
	}
	defer tx.Rollback()
	for _, statement := range statements {
		if _, err := tx.Exec(statement); err != nil {
			t.Fatalf("sync setup %q: %v", statement, err)
		}
	}
	if err := tx.Commit(); err != nil {
		t.Fatalf("commit sync setup: %v", err)
	}
}

func seedSyncRows(t *testing.T, store *sqliteStore) {
	t.Helper()
	execSyncSetup(t, store, []string{
		`INSERT INTO accounts (id, position, name, enabled, plan_id) VALUES ('prime_card', 1, 'Prime', 1, :plan_id)`,
		`INSERT INTO entity_ids (id, kind, plan_id) VALUES ('prime_card', 'account', :plan_id)`,
		`INSERT INTO checkpoints (id, position, date, account_id, balance, source, plan_id) VALUES (10, 10, '2026-08-01', 'checking', 111, 'simplefin', :plan_id)`,
		`INSERT INTO postings (id, position, name, source_account_id, destinations, amount_resolution_json, posted_time, transaction_time, enabled, source, pending, plan_id)
		 VALUES ('` + rawSyncedPostingID + `', 10, 'Pending charge', 'prime_card', 'null', '` + syncTestAmountJSON + `', 1785628800, 1785628800, 0, 'simplefin', 1, :plan_id)`,
		`INSERT INTO entity_ids (id, kind, plan_id) VALUES ('` + rawSyncedPostingID + `', 'posting', :plan_id)`,
		`INSERT INTO posting_sync_keys (provider, account_id, transaction_id, posting_id, plan_id) VALUES ('simplefin', 'bridge-prime', 'tx1', '` + rawSyncedPostingID + `', :plan_id)`,
	})
}

// seedOwnerDocument writes the owner fixture through row CRUD, replacing
// the retired whole-document save in tests.
func seedOwnerDocument(t *testing.T, store Store) {
	t.Helper()
	document := ownerDocument()
	for _, account := range document.Accounts {
		if _, err := store.CreateAccount(account); err != nil {
			t.Fatalf("seed account %s: %v", account.ID, err)
		}
	}
	for _, checkpoint := range document.Checkpoints {
		if _, err := store.SaveCheckpoint(checkpoint); err != nil {
			t.Fatalf("seed checkpoint: %v", err)
		}
	}
	for _, posting := range document.Postings {
		if _, err := store.CreatePosting(posting); err != nil {
			t.Fatalf("seed posting %s: %v", posting.ID, err)
		}
	}
}

func ownerDocument() *types.FinancialModelDocument {
	checking := "checking"
	return &types.FinancialModelDocument{
		SourcePath: "test-source",
		Accounts: []types.Account{{
			ID: "checking", Name: "Checking", Enabled: true,
		}},
		Checkpoints: []types.Checkpoint{
			{Date: "2026-07-01", AccountID: "checking", Balance: 500},
		},
		Evaluations: types.EmptyEvaluationTables(),
		Postings: []types.Posting{{
			ID: ownerPostingID, Name: "Owner", SourceAccountID: &checking,
			Amount:     types.PostingAmountResolution{Resolver: "expression", Config: map[string]any{"expression": "10"}, Inputs: map[string]types.AmountInputBinding{}},
			PostedTime: 1782950400, TransactionTime: 1782950400,
		}},
	}
}

// seedSyncState creates one synced checkpoint plus one synced pending
// posting through the public API, so conformance tests never depend on SQL.
func seedSyncState(t *testing.T, store Store) {
	t.Helper()
	if _, err := store.CreateAccount(types.Account{ID: "prime_card", Name: "Prime", Enabled: true}); err != nil {
		t.Fatalf("seed card account: %v", err)
	}
	summary, err := store.ApplySyncPlan(
		[]SyncCheckpoint{{AccountID: "checking", Date: "2026-08-01", Balance: 111}},
		[]SyncPosting{syncPendingPosting("tx1", "prime_card", "2026-08-02")},
		nil,
		[]string{"prime_card"})
	if err != nil || summary.CheckpointsInserted != 1 || summary.PendingInserted != 1 {
		t.Fatalf("seed sync state = %+v, err %v", summary, err)
	}
}

func loadPostingIDs(t *testing.T, store Store) (ids []string, sources map[string]string) {
	t.Helper()
	loaded, err := store.LoadDocument()
	if err != nil {
		t.Fatalf("load document: %v", err)
	}
	return postingIDsFromDocument(loaded)
}

func postingIDsFromDocument(document *types.FinancialModelDocument) (ids []string, sources map[string]string) {
	sources = map[string]string{}
	if document == nil {
		return ids, sources
	}
	for _, posting := range document.Postings {
		ids = append(ids, posting.ID)
		sources[posting.ID] = posting.Source
	}
	return ids, sources
}

func TestDeleteReferencedAccountFailsWithoutChangingSyncRows(t *testing.T) {
	store := openTestStore(t)
	seedOwnerDocument(t, store)
	seedSyncState(t, store)
	if _, err := store.SaveAccountLink(AccountLink{BridgeAccountID: "bridge-checking", ModelAccountID: "checking", BridgeName: "College"}); err != nil {
		t.Fatalf("seed link: %v", err)
	}
	if err := store.DeleteAccount("checking"); err == nil {
		t.Fatal("deleted an account referenced by financial rows")
	}
	loaded, err := store.LoadDocument()
	if err != nil || loaded == nil {
		t.Fatalf("load after account delete = %+v, err %v", loaded, err)
	}
	if len(loaded.Accounts) != 2 {
		t.Fatal("failed deletion changed accounts")
	}
	if _, ok := findCheckpoint(loaded, "checking", "2026-08-01"); !ok {
		t.Fatalf("sync checkpoint was garbage-collected: %+v", loaded.Checkpoints)
	}
	if len(syncedPendingIDs(loaded)) != 1 {
		t.Fatal("sync pending posting was garbage-collected")
	}
	links, err := store.ListAccountLinks()
	if err != nil {
		t.Fatalf("list links: %v", err)
	}
	// The link survives the account delete: it is the memory of the
	// mapping, and recreating the account resumes sync flow.
	foundLink := false
	for _, link := range links {
		if link.BridgeAccountID == "bridge-checking" && link.ModelAccountID == "checking" {
			foundLink = true
		}
	}
	if !foundLink {
		t.Fatalf("link was garbage-collected with its account: %+v", links)
	}
}

func TestRowWritesUseStoredSyncOwnership(t *testing.T) {
	testRowWritesUseStoredSyncOwnership(t, openTestStore)
}

func testRowWritesUseStoredSyncOwnership(t *testing.T, newStore func(*testing.T) Store) {
	t.Helper()
	store := newStore(t)
	seedOwnerDocument(t, store)
	seedSyncState(t, store)

	// UUIDs carry no ownership meaning. Owner writes cannot assert sync metadata.
	forged := testPostingFixture("01900000-0000-7000-8000-000000000013")
	forged.Source, forged.Pending = SourceSimpleFIN, true
	created, err := store.CreatePosting(forged)
	if err != nil || created.Source != SourceUser || created.Pending {
		t.Fatalf("owner posting metadata = %+v, err %v", created, err)
	}

	// Sync-owned rows refuse owner updates and deletes.
	stored, err := store.LoadDocument()
	if err != nil {
		t.Fatalf("load document: %v", err)
	}
	var synced types.Posting
	for _, posting := range stored.Postings {
		if posting.Source == SourceSimpleFIN {
			synced = posting
		}
	}
	synced.Name = "Edited"
	if _, err := store.UpdatePosting(synced); !IsSyncOwned(err) {
		t.Fatalf("update sync posting err = %v, want sync-owned", err)
	}
	if err := store.DeletePosting(synced.ID); !IsSyncOwned(err) {
		t.Fatalf("delete sync posting err = %v, want sync-owned", err)
	}

	// A checkpoint save with a forged source flag still stores owner rows.
	correction := types.Checkpoint{Date: "2026-07-01", AccountID: "checking", Balance: 500, Source: SourceSimpleFIN}
	saved, err := store.SaveCheckpoint(correction)
	if err != nil {
		t.Fatalf("save checkpoint: %v", err)
	}
	if saved.Source != SourceUser {
		t.Fatalf("checkpoint source = %q, want recomputed owner", saved.Source)
	}
	loaded, err := store.LoadDocument()
	if err != nil {
		t.Fatalf("load document: %v", err)
	}
	if len(loaded.Checkpoints) != 2 {
		t.Fatalf("checkpoints = %+v, want owner + synced", loaded.Checkpoints)
	}
	for _, checkpoint := range loaded.Checkpoints {
		if checkpoint.AccountID == "checking" && checkpoint.Date == "2026-07-01" && checkpoint.Source != SourceUser {
			t.Fatalf("forged checkpoint flag persisted: %+v", checkpoint)
		}
	}
	_, sources := loadPostingIDs(t, store)
	if sources[synced.ID] != SourceSimpleFIN {
		t.Fatalf("stored sync posting lost flag: %v", sources)
	}
	if sources[ownerPostingID] != SourceUser || sources[created.ID] != SourceUser {
		t.Fatalf("owner posting flags = %v", sources)
	}
}

func TestPostingIDsMustBeUUIDs(t *testing.T) {
	store := openTestStore(t)
	for _, id := range []string{"owner-charge", "sync-pending-card-tx1", "sfin-pending-card-tx1"} {
		if _, err := store.CreatePosting(testPostingFixture(id)); !IsInvalidID(err) {
			t.Fatalf("create %q err = %v, want invalid-id", id, err)
		}
	}
}

func TestRemergePreservesProviderSources(t *testing.T) {
	// A second bank-data provider (stand-in "plaid") coexists with SimpleFIN
	// rows. Document replace must keep every provider's source value so
	// metrics and debugging can tell origins apart.
	store := openSQLiteStore(t)
	seedOwnerDocument(t, store)
	seedSyncRows(t, store)
	execSyncSetup(t, store, []string{
		`INSERT INTO checkpoints (id, position, date, account_id, balance, source, plan_id) VALUES (11, 11, '2026-08-02', 'checking', 222, 'plaid', :plan_id)`,
		`INSERT INTO postings (id, position, name, source_account_id, destinations, amount_resolution_json, posted_time, transaction_time, enabled, source, pending, plan_id)
		 VALUES ('` + otherSyncedPostingID + `', 11, 'Plaid pending', 'checking', 'null', '` + syncTestAmountJSON + `', 1785628800, 1785628800, 0, 'plaid', 1, :plan_id)`,
		`INSERT INTO entity_ids (id, kind, plan_id) VALUES ('` + otherSyncedPostingID + `', 'posting', :plan_id)`,
	})
	tx, err := store.db.Begin()
	if err != nil {
		t.Fatalf("begin replace: %v", err)
	}
	defer tx.Rollback()
	if err := replaceDocument(tx, ownerDocument()); err != nil {
		t.Fatalf("replace: %v", err)
	}
	if err := tx.Commit(); err != nil {
		t.Fatalf("commit replace: %v", err)
	}
	loaded, err := store.LoadDocument()
	if err != nil {
		t.Fatalf("load: %v", err)
	}
	sources := map[string]string{}
	for _, checkpoint := range loaded.Checkpoints {
		sources["checkpoint:"+checkpoint.AccountID+":"+checkpoint.Date] = checkpoint.Source
	}
	for _, posting := range loaded.Postings {
		sources["posting:"+posting.ID] = posting.Source
	}
	for key, want := range map[string]string{
		"checkpoint:checking:2026-08-01":  "simplefin",
		"checkpoint:checking:2026-08-02":  "plaid",
		"checkpoint:checking:2026-07-01":  "user",
		"posting:" + rawSyncedPostingID:   "simplefin",
		"posting:" + otherSyncedPostingID: "plaid",
		"posting:" + ownerPostingID:       "user",
	} {
		if sources[key] != want {
			t.Fatalf("source %q = %q, want %q (all rows: %v)", key, sources[key], want, sources)
		}
	}
}

func TestOwnerCheckpointWinsKeyCollision(t *testing.T) {
	testOwnerCheckpointWinsKeyCollision(t, openTestStore)
}

func testOwnerCheckpointWinsKeyCollision(t *testing.T, newStore func(*testing.T) Store) {
	t.Helper()
	store := newStore(t)
	seedOwnerDocument(t, store)
	seedSyncState(t, store)

	if _, err := store.SaveCheckpoint(types.Checkpoint{
		Date: "2026-08-01", AccountID: "checking", Balance: 222,
	}); err != nil {
		t.Fatalf("save correction: %v", err)
	}

	loaded, err := store.LoadDocument()
	if err != nil {
		t.Fatalf("load document: %v", err)
	}
	count := 0
	for _, checkpoint := range loaded.Checkpoints {
		if checkpoint.AccountID == "checking" && checkpoint.Date == "2026-08-01" {
			count++
			if checkpoint.Balance != 222 || checkpoint.Source != SourceUser {
				t.Fatalf("collision row = %+v, want owner correction", checkpoint)
			}
		}
	}
	if count != 1 {
		t.Fatalf("collision key rows = %d, want 1", count)
	}
}

func syncPendingPosting(id, accountID, day string) SyncPosting {
	stamp, err := time.ParseInLocation("2006-01-02", day, time.UTC)
	if err != nil {
		stamp = time.Unix(1785628800, 0).UTC()
	}
	return SyncPosting{
		ProviderAccountID: "bridge-" + accountID,
		TransactionID:     id,
		Posting: types.Posting{
			Name:            "Pending " + id,
			SourceAccountID: &accountID,
			Amount:          types.PostingAmountResolution{Resolver: "expression", Config: map[string]any{"expression": "10"}, Inputs: map[string]types.AmountInputBinding{}},
			PostedTime:      stamp.Unix(),
			TransactionTime: stamp.Unix(),
		},
	}
}

func countRows(t *testing.T, store *sqliteStore, table, where string) int {
	t.Helper()
	var count int
	query := `SELECT COUNT(*) FROM ` + table + ` WHERE plan_id = :plan_id`
	if where != "" {
		query += ` AND ` + where
	}
	if err := store.db.QueryRow(query).Scan(&count); err != nil {
		t.Fatalf("count %s: %v", table, err)
	}
	return count
}

// findCheckpoint locates one checkpoint in a loaded document for
// interface-level assertions (replacing raw SQL row checks).
func findCheckpoint(document *types.FinancialModelDocument, accountID string, date types.IsoDate) (types.Checkpoint, bool) {
	if document == nil {
		return types.Checkpoint{}, false
	}
	for _, checkpoint := range document.Checkpoints {
		if checkpoint.AccountID == accountID && checkpoint.Date == date {
			return checkpoint, true
		}
	}
	return types.Checkpoint{}, false
}

// syncedPendingIDs lists explicitly pending sync posting IDs in a loaded
// document, replacing raw COUNT queries over the postings table.
func syncedPendingIDs(document *types.FinancialModelDocument) []string {
	var ids []string
	if document == nil {
		return ids
	}
	for _, posting := range document.Postings {
		if posting.Pending && posting.Source != SourceUser {
			ids = append(ids, posting.ID)
		}
	}
	return ids
}

func TestApplySyncPlanCheckpointLifecycle(t *testing.T) {
	testApplySyncPlanCheckpointLifecycle(t, openTestStore)
}

func testApplySyncPlanCheckpointLifecycle(t *testing.T, newStore func(*testing.T) Store) {
	t.Helper()
	store := newStore(t)
	// An owner document first, mirroring production (seeded DB): sync rows
	// merge into the visible document instead of an empty store.
	seedOwnerDocument(t, store)
	cards := []string{"prime_card"}
	seedAccount(t, store, "prime_card")

	summary, err := store.ApplySyncPlan(
		[]SyncCheckpoint{{AccountID: "checking", Date: "2026-08-05", Balance: 100}},
		nil, nil, cards)
	if err != nil || summary.CheckpointsInserted != 1 {
		t.Fatalf("apply = %+v, err %v", summary, err)
	}

	again, err := store.ApplySyncPlan(
		[]SyncCheckpoint{{AccountID: "checking", Date: "2026-08-05", Balance: 100}},
		nil, nil, cards)
	if err != nil || again.CheckpointsUpdated != 1 || again.CheckpointsInserted != 0 {
		t.Fatalf("rerun = %+v, err %v", again, err)
	}

	changed, err := store.ApplySyncPlan(
		[]SyncCheckpoint{{AccountID: "checking", Date: "2026-08-05", Balance: 150}},
		nil, nil, cards)
	if err != nil || changed.CheckpointsUpdated != 1 {
		t.Fatalf("update = %+v, err %v", changed, err)
	}
	loaded, err := store.LoadDocument()
	if err != nil {
		t.Fatalf("load: %v", err)
	}
	_ = loaded
	checkpoint, ok := findCheckpoint(loaded, "checking", "2026-08-05")
	if !ok || checkpoint.Balance != 150 || checkpoint.Source != SourceSimpleFIN {
		t.Fatalf("checkpoint = %+v, want balance 150 source simplefin", checkpoint)
	}
}

func TestApplySyncPlanSkipsUserCheckpoint(t *testing.T) {
	testApplySyncPlanSkipsUserCheckpoint(t, openTestStore)
}

func testApplySyncPlanSkipsUserCheckpoint(t *testing.T, newStore func(*testing.T) Store) {
	t.Helper()
	store := newStore(t)
	seedOwnerDocument(t, store)
	extra, err := store.SaveCheckpoint(types.Checkpoint{
		Date: "2026-08-05", AccountID: "checking", Balance: 999,
	})
	if err != nil {
		t.Fatalf("save user checkpoint: %v", err)
	}
	_ = extra
	summary, err := store.ApplySyncPlan(
		[]SyncCheckpoint{{AccountID: "checking", Date: "2026-08-05", Balance: 100}},
		nil, nil, []string{"checking"})
	if err != nil || summary.CheckpointsSkipped != 1 {
		t.Fatalf("apply = %+v, err %v", summary, err)
	}
	loaded, err := store.LoadDocument()
	if err != nil {
		t.Fatalf("load: %v", err)
	}
	checkpoint, ok := findCheckpoint(loaded, "checking", "2026-08-05")
	if !ok || checkpoint.Balance != 999 {
		t.Fatalf("user checkpoint overwritten: %+v", checkpoint)
	}
}

func TestApplySyncPlanRefreshesPendingSnapshot(t *testing.T) {
	testApplySyncPlanRefreshesPendingSnapshot(t, openTestStore)
}

func testApplySyncPlanRefreshesPendingSnapshot(t *testing.T, newStore func(*testing.T) Store) {
	t.Helper()
	store := newStore(t)
	seedOwnerDocument(t, store)
	seedAccount(t, store, "prime_card")
	cards := []string{"prime_card"}

	first, err := store.ApplySyncPlan(nil, []SyncPosting{
		syncPendingPosting("a", "prime_card", "2026-08-02"),
		syncPendingPosting("b", "prime_card", "2026-08-02"),
	}, nil, cards)
	if err != nil || first.PendingInserted != 2 {
		t.Fatalf("first apply = %+v, err %v", first, err)
	}

	second, err := store.ApplySyncPlan(nil, []SyncPosting{
		syncPendingPosting("b", "prime_card", "2026-08-03"),
		syncPendingPosting("c", "prime_card", "2026-08-03"),
	}, nil, cards)
	if err != nil || second.PendingDeleted != 1 || second.PendingInserted != 1 || second.PendingUpdated != 1 {
		t.Fatalf("second apply = %+v, err %v", second, err)
	}
	loaded, err := store.LoadDocument()
	if err != nil {
		t.Fatalf("load: %v", err)
	}
	got := syncedPendingIDs(loaded)
	if len(got) != 2 {
		t.Fatalf("pending rows = %+v, want b and c", got)
	}
	for _, id := range got {
		if _, err := uuid.Parse(id); err != nil {
			t.Fatalf("pending identity is not a UUID: %v", got)
		}
	}
	var voided types.Posting
	for _, posting := range loaded.Postings {
		if posting.Source != SourceUser && !posting.Pending {
			voided = posting
		}
	}
	if voided.ID == "" {
		t.Fatal("vanished pending charge was deleted instead of voided")
	}
	if voided.Enabled {
		t.Fatalf("void row enabled: %+v", voided)
	}
}

func TestApplySyncPlanPendingDeleteSparesUserRows(t *testing.T) {
	// Ownership, not lifecycle state or ID formatting, protects owner rows.
	store := openSQLiteStore(t)
	seedAccount(t, store, "prime_card")
	execSyncSetup(t, store, []string{
		`INSERT INTO postings (id, position, name, source_account_id, destinations, amount_resolution_json, posted_time, transaction_time, enabled, source, pending, plan_id)
		 VALUES ('` + ownerPostingID + `', 0, 'Manual', 'prime_card', 'null', '` + syncTestAmountJSON + `', 1785628800, 1785628800, 1, 'user', 1, :plan_id)`,
	})
	summary, err := store.ApplySyncPlan(nil, []SyncPosting{
		syncPendingPosting("a", "prime_card", "2026-08-02"),
	}, nil, []string{"prime_card"})
	if err != nil || summary.PendingInserted != 1 {
		t.Fatalf("apply = %+v, err %v", summary, err)
	}
	if got := countRows(t, store, "postings", "id = '"+ownerPostingID+"'"); got != 1 {
		t.Fatal("owner row was deleted")
	}
}

func syncSettledPosting(id, accountID, name, day string) SyncPosting {
	stamp, err := time.ParseInLocation("2006-01-02", day, time.UTC)
	if err != nil {
		stamp = time.Unix(1785628800, 0).UTC()
	}
	return SyncPosting{
		ProviderAccountID: "bridge-" + accountID,
		TransactionID:     id,
		Posting: types.Posting{
			Name:            name,
			SourceAccountID: &accountID,
			Amount:          types.PostingAmountResolution{Resolver: "expression", Config: map[string]any{"expression": "10"}, Inputs: map[string]types.AmountInputBinding{}},
			PostedTime:      stamp.Unix(),
			TransactionTime: stamp.Unix(),
		},
	}
}

func TestApplySyncPlanConvertsVanishedPendingOnUniqueStrictMatch(t *testing.T) {
	store := openSQLiteStore(t)
	seedAccount(t, store, "prime_card")
	cards := []string{"prime_card"}
	first, err := store.ApplySyncPlan(nil, []SyncPosting{syncPendingPosting("a", "prime_card", "2026-08-02")}, nil, cards)
	if err != nil || first.PendingInserted != 1 {
		t.Fatalf("seed pending = %+v, err %v", first, err)
	}
	document, err := store.LoadDocument()
	if err != nil || len(syncedPendingIDs(document)) != 1 {
		t.Fatalf("seeded pending rows = %+v, err %v", document, err)
	}
	pendingID := syncedPendingIDs(document)[0]
	second, err := store.ApplySyncPlan(nil, nil, []SyncPosting{
		syncSettledPosting("posted-a", "prime_card", "Pending a", "2026-08-03"),
	}, cards)
	if err != nil || second.SettledConverted != 1 || second.PendingDeleted != 0 {
		t.Fatalf("convert = %+v, err %v", second, err)
	}
	converted, err := store.LoadDocument()
	if err != nil {
		t.Fatal(err)
	}
	var row types.Posting
	for _, posting := range converted.Postings {
		if posting.ID == pendingID {
			row = posting
		}
	}
	if row.ID == "" {
		t.Fatal("conversion changed the posting UUID")
	}
	if row.Source != SourceSimpleFIN || row.Pending || row.Void || row.Enabled {
		t.Fatalf("converted row = %+v, want settled bank row pending review", row)
	}
	if row.Name != "Pending a" {
		t.Fatalf("converted name = %q", row.Name)
	}
	if countRows(t, store, "posting_sync_keys", "posting_id = '"+pendingID+"'") != 0 {
		t.Fatal("conversion left the pending sync key behind")
	}
	// The settled charge stays in later feeds without duplicating or deleting.
	third, err := store.ApplySyncPlan(nil, nil, []SyncPosting{
		syncSettledPosting("posted-a", "prime_card", "Pending a", "2026-08-03"),
	}, cards)
	if err != nil || third.SettledConverted != 0 || third.PendingDeleted != 0 {
		t.Fatalf("repeat = %+v, err %v", third, err)
	}
	if got := countRows(t, store, "postings", "id = '"+pendingID+"'"); got != 1 {
		t.Fatal("repeat sync duplicated or removed the settled row")
	}
}

func TestApplySyncPlanDeletesVanishedPendingWithoutUniqueMatch(t *testing.T) {
	store := openSQLiteStore(t)
	seedAccount(t, store, "prime_card")
	cards := []string{"prime_card"}
	if _, err := store.ApplySyncPlan(nil, []SyncPosting{syncPendingPosting("a", "prime_card", "2026-08-02")}, nil, cards); err != nil {
		t.Fatal(err)
	}
	// Two same-amount candidates on consecutive days: ambiguous, so no conversion.
	summary, err := store.ApplySyncPlan(nil, nil, []SyncPosting{
		syncSettledPosting("posted-a", "prime_card", "Pending a", "2026-08-03"),
		syncSettledPosting("posted-b", "prime_card", "Pending a (2)", "2026-08-04"),
	}, cards)
	if err != nil || summary.SettledConverted != 0 || summary.PendingDeleted != 1 {
		t.Fatalf("ambiguous = %+v, err %v", summary, err)
	}
	if _, err := store.ApplySyncPlan(nil, []SyncPosting{syncPendingPosting("b", "prime_card", "2026-08-02")}, nil, cards); err != nil {
		t.Fatal(err)
	}
	// Wrong amount: no match, so the row deletes as before.
	other := syncSettledPosting("posted-c", "prime_card", "Pending b", "2026-08-03")
	other.Amount = types.PostingAmountResolution{Resolver: "expression", Config: map[string]any{"expression": "99"}, Inputs: map[string]types.AmountInputBinding{}}
	unmatched, err := store.ApplySyncPlan(nil, nil, []SyncPosting{other}, cards)
	if err != nil || unmatched.SettledConverted != 0 || unmatched.PendingDeleted != 1 {
		t.Fatalf("unmatched = %+v, err %v", unmatched, err)
	}
}

func TestApplySyncPlanInsertsUnmatchedPostedAsDisabledOwnerRows(t *testing.T) {
	store := openSQLiteStore(t)
	seedAccount(t, store, "prime_card")
	cards := []string{"prime_card"}
	first, err := store.ApplySyncPlan(nil, nil, []SyncPosting{
		syncSettledPosting("posted-a", "prime_card", "Corner Store", "2026-08-03"),
	}, cards)
	if err != nil || first.SettledInserted != 1 {
		t.Fatalf("insert = %+v, err %v", first, err)
	}
	document, err := store.LoadDocument()
	if err != nil {
		t.Fatal(err)
	}
	var row types.Posting
	for _, posting := range document.Postings {
		if posting.Name == "Corner Store" {
			row = posting
		}
	}
	if row.ID == "" {
		t.Fatal("inserted settled row missing")
	}
	if row.Source != SourceSimpleFIN || row.Pending || row.Void || row.Enabled {
		t.Fatalf("inserted row = %+v, want disabled settled bank row", row)
	}
	if _, err := uuid.Parse(row.ID); err != nil {
		t.Fatalf("inserted identity is not a UUID: %v", row.ID)
	}
	// Repeat feeds with the same posted charge insert nothing.
	again, err := store.ApplySyncPlan(nil, nil, []SyncPosting{
		syncSettledPosting("posted-a", "prime_card", "Corner Store", "2026-08-03"),
	}, cards)
	if err != nil || again.SettledInserted != 0 {
		t.Fatalf("repeat = %+v, err %v", again, err)
	}
	if got := countRows(t, store, "postings", "name = 'Corner Store'"); got != 1 {
		t.Fatal("repeat feed duplicated the settled row")
	}
}

func TestApplySyncPlanDefersPostedMatchingPresentPending(t *testing.T) {
	store := openSQLiteStore(t)
	seedAccount(t, store, "prime_card")
	cards := []string{"prime_card"}
	if _, err := store.ApplySyncPlan(nil, []SyncPosting{syncPendingPosting("a", "prime_card", "2026-08-02")}, nil, cards); err != nil {
		t.Fatal(err)
	}
	// The same charge is still pending and now also posted: no duplicate row.
	// Conversion happens once the pending row vanishes instead.
	summary, err := store.ApplySyncPlan(nil, []SyncPosting{syncPendingPosting("a", "prime_card", "2026-08-02")}, []SyncPosting{
		syncSettledPosting("posted-a", "prime_card", "Pending a", "2026-08-02"),
	}, cards)
	if err != nil || summary.SettledInserted != 0 || summary.SettledConverted != 0 || summary.PendingDeleted != 0 {
		t.Fatalf("deferred = %+v, err %v", summary, err)
	}
	if got := countRows(t, store, "postings", ""); got != 1 {
		t.Fatalf("pending plus posted duplicated the charge: %d rows", got)
	}
}

func TestCSVReplacementPreservesBankRowsAndTheirReceipts(t *testing.T) {
	database := openSQLiteStore(t)
	seedAccount(t, database, "prime_card")
	cards := []string{"prime_card"}
	if _, err := database.ApplySyncPlan(nil, nil, []SyncPosting{
		syncSettledPosting("posted-a", "prime_card", "Corner Store", "2026-08-03"),
	}, cards); err != nil {
		t.Fatal(err)
	}
	document, err := database.LoadDocument()
	if err != nil {
		t.Fatal(err)
	}
	var id string
	for _, posting := range document.Postings {
		if posting.Name == "Corner Store" {
			id = posting.ID
		}
	}
	if id == "" {
		t.Fatal("inserted settled row missing")
	}
	receipt, err := database.CreateReceipt(context.Background(), id, "corner.png", types.ReceiptImage{Bytes: []byte("pixels"), MediaType: "image/png"})
	if err != nil {
		t.Fatal(err)
	}
	if _, err := database.ImportCSV(filepath.Join(projectRoot(t), "frontend", "tests", "fixtures", "model")); err != nil {
		t.Fatal(err)
	}
	restored, err := database.GetReceipt(receipt.ID)
	if err != nil || restored.PostingID != id {
		t.Fatalf("replacement dropped bank evidence: %+v, %v", restored, err)
	}
	links, err := database.ListPostingReceiptIDs()
	if err != nil || len(links[id]) != 1 || links[id][0] != receipt.ID {
		t.Fatalf("replacement dropped posting field: %+v, %v", links, err)
	}
}

func TestApplySyncPlanVoidsVanishedPendingWithoutDeleting(t *testing.T) {
	store := openSQLiteStore(t)
	seedAccount(t, store, "prime_card")
	cards := []string{"prime_card"}
	if _, err := store.ApplySyncPlan(nil, []SyncPosting{syncPendingPosting("a", "prime_card", "2026-08-02")}, nil, cards); err != nil {
		t.Fatal(err)
	}
	document, err := store.LoadDocument()
	if err != nil || len(syncedPendingIDs(document)) != 1 {
		t.Fatal("seed pending missing")
	}
	voided, err := store.ApplySyncPlan(nil, nil, nil, cards)
	if err != nil || voided.PendingDeleted != 1 {
		t.Fatalf("void mark = %+v, err %v", voided, err)
	}
	restored, err := store.LoadDocument()
	if err != nil {
		t.Fatal(err)
	}
	if len(syncedPendingIDs(restored)) != 0 {
		t.Fatal("voided row still reports pending")
	}
	var row types.Posting
	for _, posting := range restored.Postings {
		if posting.Source != SourceUser {
			row = posting
		}
	}
	if row.ID == "" || row.Pending || row.Enabled {
		t.Fatalf("void row = %+v", row)
	}
	// Repeat feeds with no match are a stable no-op, not repeated work.
	again, err := store.ApplySyncPlan(nil, nil, nil, cards)
	if err != nil || again.PendingDeleted != 0 {
		t.Fatalf("repeat = %+v, err %v", again, err)
	}
}

func TestApplySyncPlanHealsVoidRowWhenAuthorizationReappears(t *testing.T) {
	store := openSQLiteStore(t)
	seedAccount(t, store, "prime_card")
	cards := []string{"prime_card"}
	if _, err := store.ApplySyncPlan(nil, []SyncPosting{syncPendingPosting("a", "prime_card", "2026-08-02")}, nil, cards); err != nil {
		t.Fatal(err)
	}
	if _, err := store.ApplySyncPlan(nil, nil, nil, cards); err != nil {
		t.Fatal(err)
	}
	healed, err := store.ApplySyncPlan(nil, []SyncPosting{syncPendingPosting("a", "prime_card", "2026-08-04")}, nil, cards)
	if err != nil || healed.PendingUpdated != 1 || healed.PendingInserted != 0 {
		t.Fatalf("heal = %+v, err %v", healed, err)
	}
	document, err := store.LoadDocument()
	if err != nil || len(syncedPendingIDs(document)) != 1 {
		t.Fatalf("healed pending rows = %+v, err %v", document, err)
	}
}

func TestApplySyncPlanConvertsVoidRowOnLatePostedMatch(t *testing.T) {
	store := openSQLiteStore(t)
	seedAccount(t, store, "prime_card")
	cards := []string{"prime_card"}
	if _, err := store.ApplySyncPlan(nil, []SyncPosting{syncPendingPosting("a", "prime_card", "2026-08-02")}, nil, cards); err != nil {
		t.Fatal(err)
	}
	if _, err := store.ApplySyncPlan(nil, nil, nil, cards); err != nil {
		t.Fatal(err)
	}
	late, err := store.ApplySyncPlan(nil, nil, []SyncPosting{
		syncSettledPosting("posted-a", "prime_card", "Pending a", "2026-08-03"),
	}, cards)
	if err != nil || late.SettledConverted != 1 {
		t.Fatalf("late convert = %+v, err %v", late, err)
	}
	document, err := store.LoadDocument()
	if err != nil {
		t.Fatal(err)
	}
	pending := 0
	for _, posting := range document.Postings {
		if posting.Pending {
			pending++
		}
		if posting.Void {
			t.Fatalf("void row remains after late conversion: %+v", posting)
		}
	}
	if pending != 0 {
		t.Fatalf("pending rows remain after late conversion: %+v", document.Postings)
	}
}

func TestApplySyncPlanSeedsPendingOnNonCardAccounts(t *testing.T) {
	store := openSQLiteStore(t)
	seedAccount(t, store, "checking")
	if _, err := store.ApplySyncPlan(nil, []SyncPosting{syncPendingPosting("a", "checking", "2026-08-02")}, nil, []string{"checking"}); err != nil {
		t.Fatal(err)
	}
	document, err := store.LoadDocument()
	if err != nil || len(syncedPendingIDs(document)) != 1 {
		t.Fatalf("non-card pending rows = %+v, err %v", document, err)
	}
}

func TestSetupRenamesOwnerSourceValue(t *testing.T) {
	path := t.TempDir() + "/source-rename.db"
	database, err := SetupDatabase(path)
	if err != nil {
		t.Fatal(err)
	}
	privateTestPlan(t, database, "other")
	account := "checking"
	plan, err := database.Plan("plans/other")
	if err != nil {
		t.Fatal(err)
	}
	if _, err := plan.CreateAccount(types.Account{ID: account, Name: "Checking", Kind: types.AccountKindCash, Enabled: true}); err != nil {
		t.Fatal(err)
	}
	if _, err := database.SQL().Exec(`INSERT INTO postings (id, position, name, source_account_id, amount_resolution_json, posted_time, transaction_time, enabled, source, pending, plan_id) VALUES ('row', 0, 'Legacy', 'checking', '{}', 1, 1, 1, 'model', 0, 'plans/other')`); err != nil {
		t.Fatal(err)
	}
	database.Close()
	database, err = SetupDatabase(path)
	if err != nil {
		t.Fatal(err)
	}
	defer database.Close()
	var source string
	if err := database.SQL().QueryRow(`SELECT source FROM postings WHERE id = 'row'`).Scan(&source); err != nil || source != "user" {
		t.Fatalf("source = %q, %v", source, err)
	}
}
