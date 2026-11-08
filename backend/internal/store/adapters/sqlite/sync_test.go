package sqlite

import (
	"context"
	"github.com/simhozebs/net-worth-estimator/backend/internal/store"
	"strconv"
	"testing"
	"time"

	"github.com/simhozebs/net-worth-estimator/backend/internal/types"
)

const syncTestAmountJSON = `{"resolver":"expression","config":{"expression":"50"},"inputs":{}}`
const ownerTransactionID = "01900000-0000-7000-8000-000000000010"
const rawSyncedTransactionID = "01900000-0000-7000-8000-000000000011"
const otherSyncedTransactionID = "01900000-0000-7000-8000-000000000012"

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
		`INSERT INTO checkpoints (id, position, model_account_id, balance, source, provider, observed_at, user_id) VALUES (10, 10, 'checking', 111, 'banksync', 'simplefin', 1785628799, :user_id)`,
		`INSERT INTO transactions (id, name, source_account_id, destination_account_ids, amount_resolution_json, posted_time, transaction_time, source, pending, user_id)
		 VALUES ('` + rawSyncedTransactionID + `', 'Pending charge', 'prime_card', 'null', '` + syncTestAmountJSON + `', 1785628800, 1785628800, 'banksync', 1, :user_id)`,
		`INSERT INTO transaction_sim (transaction_id, position, enabled, execution_order, user_id)
		 VALUES ('` + rawSyncedTransactionID + `', 10, 0, 0, :user_id)`,
		`INSERT INTO entity_ids (id, kind, user_id) VALUES ('` + rawSyncedTransactionID + `', 'transaction', :user_id)`,
		`INSERT INTO transaction_sync_keys (provider, bridge_account_id, bank_transaction_id, transaction_id, user_id) VALUES ('simplefin', 'bridge-prime', 'tx1', '` + rawSyncedTransactionID + `', :user_id)`,
	})
}

// seedOwnerModel writes the owner fixture through row CRUD, replacing
// the retired whole-model save in tests.
func seedOwnerModel(t *testing.T, store store.Store) {
	t.Helper()
	model := ownerModel()
	for _, account := range model.Accounts {
		if _, err := store.CreateAccount(account); err != nil {
			t.Fatalf("seed account %s: %v", account.ID, err)
		}
	}
	for _, checkpoint := range model.Checkpoints {
		if _, err := store.SaveCheckpoint(checkpoint); err != nil {
			t.Fatalf("seed checkpoint: %v", err)
		}
	}
	for _, transaction := range model.Transactions {
		if _, err := store.CreateTransaction(transaction); err != nil {
			t.Fatalf("seed transaction %s: %v", transaction.ID, err)
		}
	}
}

func ownerModel() *types.FinancialModel {
	checking := "checking"
	return &types.FinancialModel{
		SourcePath: "test-source",
		Accounts: []types.Account{{
			ID: "checking", Name: "Checking", Enabled: true,
		}},
		Checkpoints: []types.Checkpoint{
			{AccountID: "checking", Balance: 500, ObservedAt: 1782950399},
		},
		Evaluations: types.EmptyEvaluationTables(),
		Transactions: []types.Transaction{{
			ID: ownerTransactionID, Name: "Owner", SourceAccountID: &checking,
			Amount:     types.TransactionAmountResolution{Resolver: "expression", Config: map[string]any{"expression": "10"}, Inputs: map[string]types.AmountInputBinding{}},
			PostedTime: 1782950400, TransactionTime: 1782950400,
		}},
	}
}

// seedSyncState creates one synced checkpoint plus one synced pending
// transaction through the public API, so conformance tests never depend on SQL.
func seedSyncState(t *testing.T, store store.Store) {
	t.Helper()
	if _, err := store.CreateAccount(types.Account{ID: "prime_card", Name: "Prime", Enabled: true}); err != nil {
		t.Fatalf("seed card account: %v", err)
	}
	seed := syncPendingTransaction("tx1", "prime_card", "2026-08-02")
	summary, err := store.ApplySync(
		[]SyncCheckpoint{{AccountID: "checking", Balance: 111, Source: SourceBankSync, Provider: ProviderSimpleFIN, ObservedAt: 1785628799}},
		[]BankDirective{syncPendingDirective(seed)})
	if err != nil || summary.CheckpointsInserted != 1 || summary.PendingInserted != 1 {
		t.Fatalf("seed sync state = %+v, err %v", summary, err)
	}
}

func loadTransactionIDs(t *testing.T, store store.Store) (ids []string, sources map[string]string) {
	t.Helper()
	loaded, err := store.LoadModel()
	if err != nil {
		t.Fatalf("load model: %v", err)
	}
	return transactionIDsFromModel(loaded)
}

func transactionIDsFromModel(model *types.FinancialModel) (ids []string, sources map[string]string) {
	sources = map[string]string{}
	if model == nil {
		return ids, sources
	}
	for _, transaction := range model.Transactions {
		ids = append(ids, transaction.ID)
		sources[transaction.ID] = transaction.Source
	}
	return ids, sources
}

func TestDeleteReferencedAccountFailsWithoutChangingSyncRows(t *testing.T) {
	store := openTestStore(t)
	seedOwnerModel(t, store)
	seedSyncState(t, store)
	if _, err := store.SaveAccountLink(AccountLink{BridgeAccountID: "bridge-checking", ModelAccountID: "checking", BridgeName: "College"}); err != nil {
		t.Fatalf("seed link: %v", err)
	}
	if err := store.DeleteAccount("checking"); err == nil {
		t.Fatal("deleted an account referenced by financial rows")
	}
	loaded, err := store.LoadModel()
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
		t.Fatal("sync pending transaction was garbage-collected")
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

func TestRemergePreservesProviderSources(t *testing.T) {
	// A second bank-data provider (stand-in "plaid") coexists with SimpleFIN
	// rows. Model replace must keep bank rows as bank facts with the
	// supplying provider on the checkpoint row so origins stay distinct.
	store := openSQLiteStore(t)
	seedOwnerModel(t, store)
	seedSyncRows(t, store)
	execSyncSetup(t, store, []string{
		`INSERT INTO checkpoints (id, position, model_account_id, balance, source, provider, observed_at, user_id) VALUES (11, 11, 'checking', 222, 'banksync', 'simplefin', 1785715199, :user_id)`,
		`INSERT INTO transactions (id, name, source_account_id, destination_account_ids, amount_resolution_json, posted_time, transaction_time, source, pending, user_id)
		 VALUES ('` + otherSyncedTransactionID + `', 'Plaid pending', 'checking', 'null', '` + syncTestAmountJSON + `', 1785628800, 1785628800, 'banksync', 1, :user_id)`,
		`INSERT INTO transaction_sim (transaction_id, position, enabled, execution_order, user_id)
		 VALUES ('` + otherSyncedTransactionID + `', 11, 0, 0, :user_id)`,
		`INSERT INTO entity_ids (id, kind, user_id) VALUES ('` + otherSyncedTransactionID + `', 'transaction', :user_id)`,
	})
	tx, err := store.db.Begin()
	if err != nil {
		t.Fatalf("begin replace: %v", err)
	}
	defer tx.Rollback()
	if err := replaceModel(tx, ownerModel()); err != nil {
		t.Fatalf("replace: %v", err)
	}
	if err := tx.Commit(); err != nil {
		t.Fatalf("commit replace: %v", err)
	}
	loaded, err := store.LoadModel()
	if err != nil {
		t.Fatalf("load: %v", err)
	}
	sources := map[string]string{}
	for _, checkpoint := range loaded.Checkpoints {
		sources["checkpoint:"+checkpoint.AccountID+":"+strconv.FormatInt(checkpoint.ObservedAt, 10)] = checkpoint.Source
	}
	for _, transaction := range loaded.Transactions {
		sources["transaction:"+transaction.ID] = transaction.Source
	}
	for key, want := range map[string]string{
		"checkpoint:checking:1785628799":          "banksync",
		"checkpoint:checking:1785715199":          "banksync",
		"checkpoint:checking:1782950399":          "user",
		"transaction:" + rawSyncedTransactionID:   "banksync",
		"transaction:" + otherSyncedTransactionID: "banksync",
		"transaction:" + ownerTransactionID:       "user",
	} {
		if sources[key] != want {
			t.Fatalf("source %q = %q, want %q (all rows: %v)", key, sources[key], want, sources)
		}
	}
}

func syncPendingTransaction(id, accountID, day string) SyncTransaction {
	stamp, err := time.ParseInLocation("2006-01-02", day, time.UTC)
	if err != nil {
		stamp = time.Unix(1785628800, 0).UTC()
	}
	return SyncTransaction{
		ProviderAccountID: "bridge-" + accountID,
		TransactionID:     id,
		Transaction: types.Transaction{
			Name:            "Pending " + id,
			SourceAccountID: &accountID,
			Amount:          types.TransactionAmountResolution{Resolver: "expression", Config: map[string]any{"expression": "10"}, Inputs: map[string]types.AmountInputBinding{}},
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

// findCheckpoint locates one checkpoint in a loaded model for
// interface-level assertions (replacing raw SQL row checks).
func findCheckpoint(model *types.FinancialModel, accountID string, observedAt int64) (types.Checkpoint, bool) {
	if model == nil {
		return types.Checkpoint{}, false
	}
	for _, checkpoint := range model.Checkpoints {
		if checkpoint.AccountID == accountID && checkpoint.ObservedAt == observedAt {
			return checkpoint, true
		}
	}
	return types.Checkpoint{}, false
}

// syncedPendingIDs lists explicitly pending sync transaction IDs in a loaded
// model, replacing raw COUNT queries over the transactions table.
func syncedPendingIDs(model *types.FinancialModel) []string {
	var ids []string
	if model == nil {
		return ids
	}
	for _, transaction := range model.Transactions {
		if transaction.Pending && transaction.Source != SourceUser {
			ids = append(ids, transaction.ID)
		}
	}
	return ids
}

// syncPendingDirective mirrors what adapters emit for a pending seed:
// bank source with explicit pending lifecycle.
func syncPendingDirective(item SyncTransaction) BankDirective {
	item.Source = SourceBankSync
	item.Pending = true
	return BankDirective{Upsert: &BankUpsert{
		Transaction: item.Transaction,
		Keys:        []BankKey{{Provider: ProviderSimpleFIN, AccountID: item.ProviderAccountID, TransactionID: item.TransactionID}},
	}}
}

func TestApplySyncPendingDeleteSparesUserRows(t *testing.T) {
	// Ownership, not lifecycle state or ID formatting, protects owner rows.
	store := openSQLiteStore(t)
	seedAccount(t, store, "prime_card")
	execSyncSetup(t, store, []string{
		`INSERT INTO transactions (id, name, source_account_id, destination_account_ids, amount_resolution_json, posted_time, transaction_time, source, pending, user_id)
		 VALUES ('` + ownerTransactionID + `', 'Manual', 'prime_card', 'null', '` + syncTestAmountJSON + `', 1785628800, 1785628800, 'user', 1, :user_id)`,
		`INSERT INTO transaction_sim (transaction_id, position, enabled, execution_order, user_id)
		 VALUES ('` + ownerTransactionID + `', 0, 1, 0, :user_id)`,
	})
	summary, err := store.ApplySync(nil, []BankDirective{
		syncPendingDirective(syncPendingTransaction("a", "prime_card", "2026-08-02")),
	})
	if err != nil || summary.PendingInserted != 1 {
		t.Fatalf("apply = %+v, err %v", summary, err)
	}
	if got := countRows(t, store, "transactions", "id = '"+ownerTransactionID+"'"); got != 1 {
		t.Fatal("owner row was deleted")
	}
}

func TestApplySyncConvertsNamedRowKeepingUUID(t *testing.T) {
	store := openSQLiteStore(t)
	seedAccount(t, store, "prime_card")
	seed := syncPendingTransaction("a", "prime_card", "2026-08-02")
	if _, err := store.ApplySync(nil, []BankDirective{syncPendingDirective(seed)}); err != nil {
		t.Fatal(err)
	}
	model, err := store.LoadModel()
	if err != nil || len(model.Transactions) != 1 {
		t.Fatal("seed pending missing")
	}
	id := model.Transactions[0].ID
	settled := syncSettledTransaction("posted-a", "prime_card", "Pending a", "2026-08-03")
	settled.Source = SourceBankSync
	summary, err := store.ApplySync(nil, []BankDirective{{Convert: &BankConvert{
		ID:          id,
		Transaction: settled.Transaction,
		AddKeys:     []BankKey{{Provider: ProviderSimpleFIN, AccountID: "bridge-prime_card", TransactionID: "posted-a"}},
	}}})
	if err != nil || summary.SettledConverted != 1 {
		t.Fatalf("convert = %+v, err %v", summary, err)
	}
	converted, err := store.LoadModel()
	if err != nil || len(converted.Transactions) != 1 {
		t.Fatal("convert changed row count")
	}
	row := converted.Transactions[0]
	if row.ID != id || row.Source != SourceBankSync || row.Pending || row.Void || !row.Enabled {
		t.Fatalf("converted row = %+v, want enabled settled participant", row)
	}
	rows, err := store.LoadBankTransactions()
	if err != nil || len(rows) != 1 || len(rows[0].Keys) != 1 || rows[0].Keys[0].TransactionID != "posted-a" {
		t.Fatalf("keys after rotation = %+v, %v", rows, err)
	}
}

func TestModelReplacementPreservesBankRowsAndTheirReceipts(t *testing.T) {
	database := openSQLiteStore(t)
	seedAccount(t, database, "prime_card")
	settled := syncSettledTransaction("posted-a", "prime_card", "Corner Store", "2026-08-03")
	settled.Source = SourceBankSync
	if _, err := database.ApplySync(nil, []BankDirective{{Upsert: &BankUpsert{
		Transaction: settled.Transaction,
		Keys:        []BankKey{{Provider: ProviderSimpleFIN, AccountID: "bridge-prime_card", TransactionID: "posted-a"}},
	}}}); err != nil {
		t.Fatal(err)
	}
	model, err := database.LoadModel()
	if err != nil {
		t.Fatal(err)
	}
	var id string
	for _, transaction := range model.Transactions {
		if transaction.Name == "Corner Store" {
			id = transaction.ID
		}
	}
	if id == "" {
		t.Fatal("inserted settled row missing")
	}
	receipt, err := database.CreateReceipt(context.Background(), id, "corner.png", types.ReceiptImage{Bytes: []byte("pixels"), MediaType: "image/png"})
	if err != nil {
		t.Fatal(err)
	}
	seedBaseline(t, database)
	restored, err := database.GetReceipt(receipt.ID)
	if err != nil || restored.TransactionID != id {
		t.Fatalf("replacement dropped bank evidence: %+v, %v", restored, err)
	}
	links, err := database.ListTransactionReceiptIDs()
	if err != nil || len(links[id]) != 1 || links[id][0] != receipt.ID {
		t.Fatalf("replacement dropped transaction field: %+v, %v", links, err)
	}
}

func syncSettledTransaction(id, accountID, name, day string) SyncTransaction {
	stamp, err := time.ParseInLocation("2006-01-02", day, time.UTC)
	if err != nil {
		stamp = time.Unix(1785628800, 0).UTC()
	}
	return SyncTransaction{
		ProviderAccountID: "bridge-" + accountID,
		TransactionID:     id,
		Transaction: types.Transaction{
			Name:            name,
			SourceAccountID: &accountID,
			Amount:          types.TransactionAmountResolution{Resolver: "expression", Config: map[string]any{"expression": "10"}, Inputs: map[string]types.AmountInputBinding{}},
			PostedTime:      stamp.Unix(),
			TransactionTime: stamp.Unix(),
			Enabled:         true,
		},
	}
}
