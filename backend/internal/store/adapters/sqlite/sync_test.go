package sqlite

import (
	"context"
	"github.com/simhozebs/net-worth-estimator/backend/internal/store"
	"github.com/simhozebs/net-worth-estimator/backend/internal/testseed"
	"path/filepath"
	"strconv"
	"testing"
	"time"

	"github.com/simhozebs/net-worth-estimator/backend/internal/types"
)

const syncTestAmountJSON = `{"resolver":"expression","config":{"expression":"50"},"inputs":{}}`
const ownerPostingID = "01900000-0000-7000-8000-000000000010"
const rawSyncedPostingID = "01900000-0000-7000-8000-000000000011"
const otherSyncedPostingID = "01900000-0000-7000-8000-000000000012"

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
		`INSERT INTO accounts (id, position, name, enabled, user_id) VALUES ('prime_card', 1, 'Prime', 1, :user_id)`,
		`INSERT INTO entity_ids (id, kind, user_id) VALUES ('prime_card', 'account', :user_id)`,
		`INSERT INTO checkpoints (id, position, model_account_id, balance, source, observed_at, user_id) VALUES (10, 10, 'checking', 111, 'simplefin', 1785628799, :user_id)`,
		`INSERT INTO postings (id, position, name, source_account_id, destinations, amount_resolution_json, posted_time, transaction_time, enabled, source, pending, user_id)
		 VALUES ('` + rawSyncedPostingID + `', 10, 'Pending charge', 'prime_card', 'null', '` + syncTestAmountJSON + `', 1785628800, 1785628800, 0, 'simplefin', 1, :user_id)`,
		`INSERT INTO entity_ids (id, kind, user_id) VALUES ('` + rawSyncedPostingID + `', 'posting', :user_id)`,
		`INSERT INTO posting_sync_keys (provider, bridge_account_id, transaction_id, posting_id, user_id) VALUES ('simplefin', 'bridge-prime', 'tx1', '` + rawSyncedPostingID + `', :user_id)`,
	})
}

// seedOwnerDocument writes the owner fixture through row CRUD, replacing
// the retired whole-document save in tests.
func seedOwnerDocument(t *testing.T, store store.Store) {
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
			{AccountID: "checking", Balance: 500, ObservedAt: 1782950399},
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
func seedSyncState(t *testing.T, store store.Store) {
	t.Helper()
	if _, err := store.CreateAccount(types.Account{ID: "prime_card", Name: "Prime", Enabled: true}); err != nil {
		t.Fatalf("seed card account: %v", err)
	}
	seed := syncPendingPosting("tx1", "prime_card", "2026-08-02")
	summary, err := store.ApplySyncPlan(
		[]SyncCheckpoint{{AccountID: "checking", Balance: 111, ObservedAt: 1785628799}},
		[]BankDirective{syncPendingDirective(seed)})
	if err != nil || summary.CheckpointsInserted != 1 || summary.PendingInserted != 1 {
		t.Fatalf("seed sync state = %+v, err %v", summary, err)
	}
}

func loadPostingIDs(t *testing.T, store store.Store) (ids []string, sources map[string]string) {
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
	if _, ok := findCheckpoint(loaded, "checking", 1785628799); !ok {
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
		`INSERT INTO checkpoints (id, position, model_account_id, balance, source, observed_at, user_id) VALUES (11, 11, 'checking', 222, 'plaid', 1785715199, :user_id)`,
		`INSERT INTO postings (id, position, name, source_account_id, destinations, amount_resolution_json, posted_time, transaction_time, enabled, source, pending, user_id)
		 VALUES ('` + otherSyncedPostingID + `', 11, 'Plaid pending', 'checking', 'null', '` + syncTestAmountJSON + `', 1785628800, 1785628800, 0, 'plaid', 1, :user_id)`,
		`INSERT INTO entity_ids (id, kind, user_id) VALUES ('` + otherSyncedPostingID + `', 'posting', :user_id)`,
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
		sources["checkpoint:"+checkpoint.AccountID+":"+strconv.FormatInt(checkpoint.ObservedAt, 10)] = checkpoint.Source
	}
	for _, posting := range loaded.Postings {
		sources["posting:"+posting.ID] = posting.Source
	}
	for key, want := range map[string]string{
		"checkpoint:checking:1785628799":  "simplefin",
		"checkpoint:checking:1785715199":  "plaid",
		"checkpoint:checking:1782950399":  "user",
		"posting:" + rawSyncedPostingID:   "simplefin",
		"posting:" + otherSyncedPostingID: "plaid",
		"posting:" + ownerPostingID:       "user",
	} {
		if sources[key] != want {
			t.Fatalf("source %q = %q, want %q (all rows: %v)", key, sources[key], want, sources)
		}
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
	query := `SELECT COUNT(*) FROM ` + table + ` WHERE user_id = :user_id`
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
func findCheckpoint(document *types.FinancialModelDocument, accountID string, observedAt int64) (types.Checkpoint, bool) {
	if document == nil {
		return types.Checkpoint{}, false
	}
	for _, checkpoint := range document.Checkpoints {
		if checkpoint.AccountID == accountID && checkpoint.ObservedAt == observedAt {
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

// syncPendingDirective mirrors what adapters emit for a pending seed:
// bank source with explicit pending lifecycle.
func syncPendingDirective(item SyncPosting) BankDirective {
	item.Source = SourceSimpleFIN
	item.Pending = true
	return BankDirective{Upsert: &BankUpsert{
		Posting: item.Posting,
		Keys:    []BankKey{{Provider: SourceSimpleFIN, AccountID: item.ProviderAccountID, TransactionID: item.TransactionID}},
	}}
}

func TestApplySyncPlanPendingDeleteSparesUserRows(t *testing.T) {
	// Ownership, not lifecycle state or ID formatting, protects owner rows.
	store := openSQLiteStore(t)
	seedAccount(t, store, "prime_card")
	execSyncSetup(t, store, []string{
		`INSERT INTO postings (id, position, name, source_account_id, destinations, amount_resolution_json, posted_time, transaction_time, enabled, source, pending, user_id)
		 VALUES ('` + ownerPostingID + `', 0, 'Manual', 'prime_card', 'null', '` + syncTestAmountJSON + `', 1785628800, 1785628800, 1, 'user', 1, :user_id)`,
	})
	summary, err := store.ApplySyncPlan(nil, []BankDirective{
		syncPendingDirective(syncPendingPosting("a", "prime_card", "2026-08-02")),
	})
	if err != nil || summary.PendingInserted != 1 {
		t.Fatalf("apply = %+v, err %v", summary, err)
	}
	if got := countRows(t, store, "postings", "id = '"+ownerPostingID+"'"); got != 1 {
		t.Fatal("owner row was deleted")
	}
}

func TestApplySyncPlanConvertsNamedRowKeepingUUID(t *testing.T) {
	store := openSQLiteStore(t)
	seedAccount(t, store, "prime_card")
	seed := syncPendingPosting("a", "prime_card", "2026-08-02")
	if _, err := store.ApplySyncPlan(nil, []BankDirective{syncPendingDirective(seed)}); err != nil {
		t.Fatal(err)
	}
	document, err := store.LoadDocument()
	if err != nil || len(document.Postings) != 1 {
		t.Fatal("seed pending missing")
	}
	id := document.Postings[0].ID
	settled := syncSettledPosting("posted-a", "prime_card", "Pending a", "2026-08-03")
	settled.Source = SourceSimpleFIN
	summary, err := store.ApplySyncPlan(nil, []BankDirective{{Convert: &BankConvert{
		ID:      id,
		Posting: settled.Posting,
		AddKeys: []BankKey{{Provider: SourceSimpleFIN, AccountID: "bridge-prime_card", TransactionID: "posted-a"}},
	}}})
	if err != nil || summary.SettledConverted != 1 {
		t.Fatalf("convert = %+v, err %v", summary, err)
	}
	converted, err := store.LoadDocument()
	if err != nil || len(converted.Postings) != 1 {
		t.Fatal("convert changed row count")
	}
	row := converted.Postings[0]
	if row.ID != id || row.Source != SourceSimpleFIN || row.Pending || row.Void || !row.Enabled {
		t.Fatalf("converted row = %+v, want enabled settled participant", row)
	}
	rows, err := store.LoadBankPostings()
	if err != nil || len(rows) != 1 || len(rows[0].Keys) != 1 || rows[0].Keys[0].TransactionID != "posted-a" {
		t.Fatalf("keys after rotation = %+v, %v", rows, err)
	}
}

func TestCSVReplacementPreservesBankRowsAndTheirReceipts(t *testing.T) {
	database := openSQLiteStore(t)
	seedAccount(t, database, "prime_card")
	settled := syncSettledPosting("posted-a", "prime_card", "Corner Store", "2026-08-03")
	settled.Source = SourceSimpleFIN
	if _, err := database.ApplySyncPlan(nil, []BankDirective{{Upsert: &BankUpsert{
		Posting: settled.Posting,
		Keys:    []BankKey{{Provider: SourceSimpleFIN, AccountID: "bridge-prime_card", TransactionID: "posted-a"}},
	}}}); err != nil {
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
	if _, err := testseed.Seed(database, filepath.Join(projectRoot(t), "frontend", "tests", "fixtures", "model")); err != nil {
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
			Enabled:         true,
		},
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
	plan, err := database.User("other")
	if err != nil {
		t.Fatal(err)
	}
	if _, err := plan.CreateAccount(types.Account{ID: account, Name: "Checking", Kind: types.AccountKindCash, Enabled: true}); err != nil {
		t.Fatal(err)
	}
	if _, err := database.SQL().Exec(`INSERT INTO postings (id, position, name, source_account_id, amount_resolution_json, posted_time, transaction_time, enabled, source, pending, user_id) VALUES ('row', 0, 'Legacy', 'checking', '{}', 1, 1, 1, 'model', 0, 'other')`); err != nil {
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
