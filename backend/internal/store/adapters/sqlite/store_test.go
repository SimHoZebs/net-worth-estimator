package sqlite

import (
	"github.com/simhozebs/net-worth-estimator/backend/internal/store"
	"os"
	"path/filepath"
	"reflect"
	"testing"

	"github.com/simhozebs/net-worth-estimator/backend/internal/types"
)

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

func openTestStore(t *testing.T) store.Store {
	t.Helper()
	return openSQLiteStore(t)
}

func seedAccount(t *testing.T, store store.Store, id string) {
	t.Helper()
	if _, err := store.CreateAccount(types.Account{ID: id, Name: id, Enabled: true}); err != nil {
		t.Fatal(err)
	}
}

// openSQLiteStore opens the embedded-SQLite backend directly. Tests that
// assert on SQL-level details (raw scripts) use this;
// behavioral tests go through storetest.Run with the interface instead.
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
	return filepath.Clean(filepath.Join(workingDirectory, "..", "..", "..", "..", ".."))
}
