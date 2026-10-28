package store

import (
	"os"
	"path/filepath"
	"reflect"
	"testing"

	"github.com/simhozebs/net-worth-estimator/backend/internal/types"
)

func TestStoreRoundTripsCanonicalDocumentMetadataAndOrder(t *testing.T) {
	testStoreRoundTripsCanonicalDocumentMetadataAndOrder(t, openTestStore)
}

func TestRowWritesMarkDocumentPresent(t *testing.T) {
	store := openTestStore(t)
	exists, err := store.DocumentExists()
	if err != nil || exists {
		t.Fatalf("fresh presence = %v, err %v", exists, err)
	}
	if _, err := store.CreateAccount(types.Account{ID: "checking", Name: "Checking"}); err != nil {
		t.Fatalf("create account: %v", err)
	}
	exists, err = store.DocumentExists()
	if err != nil || !exists {
		t.Fatalf("presence after write = %v, err %v", exists, err)
	}
	if err := store.Clear(); err != nil {
		t.Fatalf("clear: %v", err)
	}
	exists, err = store.DocumentExists()
	if err != nil || exists {
		t.Fatalf("presence after clear = %v, err %v", exists, err)
	}
	if _, err := store.CreateAccount(types.Account{ID: "checking", Name: "Checking"}); err != nil {
		t.Fatalf("recreate after clear: %v", err)
	}
}

func TestOpenCreatesExpectedTables(t *testing.T) {
	store := openSQLiteStore(t)
	tables := map[string]bool{}
	rows, err := store.db.Query(`SELECT name FROM sqlite_master WHERE type = 'table'`)
	if err != nil {
		t.Fatalf("list tables: %v", err)
	}
	for rows.Next() {
		var name string
		if err := rows.Scan(&name); err != nil {
			rows.Close()
			t.Fatalf("scan table: %v", err)
		}
		tables[name] = true
	}
	rows.Close()
	if err := rows.Err(); err != nil {
		t.Fatalf("iterate tables: %v", err)
	}
	for _, want := range expectedSchemaTables() {
		if !tables[want] {
			t.Fatalf("missing table %q: %v", want, tables)
		}
	}
}

func testStoreRoundTripsCanonicalDocumentMetadataAndOrder(t *testing.T, newStore func(*testing.T) Store) {
	t.Helper()
	store := newStore(t)
	if _, err := store.CreateAccount(types.Account{ID: "checking", Name: "Checking", Enabled: true}); err != nil {
		t.Fatalf("create account: %v", err)
	}
	for _, checkpoint := range []types.Checkpoint{
		{Date: "2026-04-30", AccountID: "checking", Balance: 200},
		{Date: "2026-04-06", AccountID: "checking", Balance: 100},
	} {
		if _, err := store.SaveCheckpoint(checkpoint); err != nil {
			t.Fatalf("save checkpoint: %v", err)
		}
	}
	loaded, err := store.LoadDocument()
	if err != nil {
		t.Fatalf("load document: %v", err)
	}
	if loaded == nil {
		t.Fatal("loaded document is nil")
	}
	if !reflect.DeepEqual(loaded.Checkpoints, withSourceUser([]types.Checkpoint{
		{Date: "2026-04-30", AccountID: "checking", Balance: 200},
		{Date: "2026-04-06", AccountID: "checking", Balance: 100},
	})) {
		t.Fatalf("checkpoint order changed: got %+v", loaded.Checkpoints)
	}
	if loaded.Accounts[0].MinBalance == nil || *loaded.Accounts[0].MinBalance != types.NoFloor {
		t.Fatalf("minimum balance was not normalized: %+v", loaded.Accounts[0].MinBalance)
	}
	if loaded.Accounts[0].MaxBalance == nil || *loaded.Accounts[0].MaxBalance != types.NoCeiling {
		t.Fatalf("maximum balance was not normalized: %+v", loaded.Accounts[0].MaxBalance)
	}

	empty, err := store.LoadDocument()
	if err != nil || empty == nil {
		t.Fatalf("load document = %+v, err %v", empty, err)
	}
	if empty.Accounts == nil || empty.Checkpoints == nil || empty.Postings == nil {
		t.Fatalf("empty collections were not normalized: %+v", empty)
	}

	if err := store.Clear(); err != nil {
		t.Fatalf("clear document: %v", err)
	}
	exists, err := store.DocumentExists()
	if err != nil || exists {
		t.Fatalf("cleared document presence = %v, err %v", exists, err)
	}
	loaded, err = store.LoadDocument()
	if err != nil || loaded != nil {
		t.Fatalf("cleared document = %+v, err %v", loaded, err)
	}
}

func TestStoreRoundTripsPaymentTerms(t *testing.T) {
	store := openTestStore(t)
	percent := 0.02
	statementDay := 15
	if _, err := store.CreateAccount(types.Account{ID: "prime_card", Name: "Prime Card", Enabled: true}); err != nil {
		t.Fatalf("create prime: %v", err)
	}
	if _, err := store.CreateAccount(types.Account{ID: "checking", Name: "Checking", Enabled: true}); err != nil {
		t.Fatalf("create checking: %v", err)
	}
	want := []types.PaymentTerms{
		{AccountID: "prime_card", MinimumFixed: 25, MinimumPercent: &percent, DueDay: 10, StatementDay: &statementDay},
		{AccountID: "checking", MinimumFixed: 0, DueDay: 1},
	}
	for _, terms := range want {
		if _, err := store.SavePaymentTerms(terms); err != nil {
			t.Fatalf("save terms: %v", err)
		}
	}
	loaded, err := store.LoadDocument()
	if err != nil {
		t.Fatalf("load document: %v", err)
	}
	if !reflect.DeepEqual(loaded.PaymentTerms, want) {
		t.Fatalf("payment terms changed: got %+v, want %+v", loaded.PaymentTerms, want)
	}
}

func openTestStore(t *testing.T) Store {
	t.Helper()
	return openSQLiteStore(t)
}

func seedAccount(t *testing.T, store Store, id string) {
	t.Helper()
	if _, err := store.CreateAccount(types.Account{ID: id, Name: id, Enabled: true}); err != nil {
		t.Fatal(err)
	}
}

// openSQLiteStore opens the embedded-SQLite backend directly. Tests that
// assert on SQL-level details (raw scripts) use this;
// behavioral tests go through RunConformance with the interface instead.
func openSQLiteStore(t *testing.T) *sqliteStore {
	t.Helper()
	return openSQLiteStoreAt(t, filepath.Join(t.TempDir(), "store.db"))
}

func openSQLiteStoreAt(t *testing.T, path string) *sqliteStore {
	t.Helper()
	store, err := Open(path)
	if err != nil {
		t.Fatalf("open test store: %v", err)
	}
	implementation, ok := store.(*sqliteStore)
	if !ok {
		t.Fatalf("Open returned %T, want *sqliteStore", store)
	}
	t.Cleanup(func() { _ = store.Close() })
	return implementation
}

func projectRoot(t *testing.T) string {
	t.Helper()
	workingDirectory, err := os.Getwd()
	if err != nil {
		t.Fatalf("get working directory: %v", err)
	}
	return filepath.Clean(filepath.Join(workingDirectory, "..", "..", ".."))
}
