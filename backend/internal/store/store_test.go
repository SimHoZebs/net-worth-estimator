package store

import (
	"database/sql"
	"fmt"
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

func TestOpenCreatesCurrentSchemaVersion(t *testing.T) {
	store := openSQLiteStore(t)
	var version int
	if err := store.db.QueryRow(`PRAGMA user_version`).Scan(&version); err != nil || version != latestSchemaVersion {
		t.Fatalf("fresh schema version = %d, err %v", version, err)
	}
	var tableCount int
	if err := store.db.QueryRow(`SELECT COUNT(*) FROM sqlite_master WHERE type = 'table' AND name = 'schema_version'`).Scan(&tableCount); err != nil || tableCount != 0 {
		t.Fatalf("legacy schema_version table present = %d, err %v", tableCount, err)
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
	if !reflect.DeepEqual(loaded.Checkpoints, withSourceModel([]types.Checkpoint{
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

func TestStorePersistsEffectiveDatedIncomeRowsWithSharedID(t *testing.T) {
	testStorePersistsEffectiveDatedIncomeRowsWithSharedID(t, openTestStore)
}

func testStorePersistsEffectiveDatedIncomeRowsWithSharedID(t *testing.T, newStore func(*testing.T) Store) {
	t.Helper()
	store := newStore(t)
	juneEnd := types.IsoDate("2026-06-30")
	snapshot := &types.IncomeDataSnapshot{
		IncomeSources: []types.IncomeSourceDefinition{
			{ID: "salary", Name: "First", EffectiveFrom: "2026-01-01", EffectiveTo: &juneEnd, AnnualGrossIncome: 100},
			{ID: "salary", Name: "Second", EffectiveFrom: "2026-07-01", AnnualGrossIncome: 200},
		},
		TaxProfiles: []types.IncomeTaxProfile{},
	}

	if err := store.SaveIncomeData(snapshot); err != nil {
		t.Fatalf("save income data: %v", err)
	}
	loaded, err := store.LoadIncomeData()
	if err != nil {
		t.Fatalf("load income data: %v", err)
	}
	if !reflect.DeepEqual(loaded, snapshot) {
		t.Fatalf("income data changed: got %+v, want %+v", loaded, snapshot)
	}
}

func TestOpenMigratesVersionOneData(t *testing.T) {
	path := filepath.Join(t.TempDir(), "version-one.db")
	createVersionOneDatabase(t, path)

	store, err := Open(path)
	if err != nil {
		t.Fatalf("open migrated store: %v", err)
	}
	t.Cleanup(func() { _ = store.Close() })
	document, incomeData, err := store.LoadDocumentAndIncomeData()
	if err != nil {
		t.Fatalf("load migrated aggregate: %v", err)
	}
	if document == nil || document.SourcePath != "" {
		t.Fatalf("migrated document metadata = %+v", document)
	}
	wantDates := []types.IsoDate{"2026-04-30", "2026-04-06"}
	gotDates := []types.IsoDate{document.Checkpoints[0].Date, document.Checkpoints[1].Date}
	if !reflect.DeepEqual(gotDates, wantDates) {
		t.Fatalf("migrated checkpoint order = %v, want %v", gotDates, wantDates)
	}
	if len(incomeData.IncomeSources) != 1 || incomeData.IncomeSources[0].AnnualGrossIncome != 100 {
		t.Fatalf("migrated income data = %+v", incomeData)
	}

	juneEnd := types.IsoDate("2026-06-30")
	if err := store.SaveIncomeData(&types.IncomeDataSnapshot{
		IncomeSources: []types.IncomeSourceDefinition{
			{ID: "salary", EffectiveFrom: "2026-01-01", EffectiveTo: &juneEnd},
			{ID: "salary", EffectiveFrom: "2026-07-01"},
		},
		TaxProfiles: []types.IncomeTaxProfile{},
	}); err != nil {
		t.Fatalf("save effective periods after migration: %v", err)
	}
}

func TestImportCSVRollsBackModelWhenIncomeReplacementFails(t *testing.T) {
	testImportCSVRollsBackModelWhenIncomeReplacementFails(t, openTestStore)
}

func testImportCSVRollsBackModelWhenIncomeReplacementFails(t *testing.T, newStore func(*testing.T) Store) {
	t.Helper()
	store := newStore(t)
	root := projectRoot(t)
	modelPath := filepath.Join(root, "public", "configs")
	incomePath := filepath.Join(root, "public", "data", "income")
	baselineDocument, baselineIncome, err := store.ImportCSV(modelPath, incomePath)
	if err != nil {
		t.Fatalf("baseline import: %v", err)
	}
	if baselineDocument.SourcePath != "configs" {
		t.Fatalf("import source path = %q, want configs", baselineDocument.SourcePath)
	}

	invalidIncomePath := t.TempDir()
	duplicateSources := "id,name,effectiveFrom,effectiveTo,annualGrossIncome\n" +
		"salary,First,2026-01-01,,100\n" +
		"salary,Duplicate,2026-01-01,,200\n"
	if err := os.WriteFile(filepath.Join(invalidIncomePath, "income-sources.csv"), []byte(duplicateSources), 0o600); err != nil {
		t.Fatalf("write duplicate income sources: %v", err)
	}
	taxProfiles, err := os.ReadFile(filepath.Join(incomePath, "tax-profiles.csv"))
	if err != nil {
		t.Fatalf("read tax profiles: %v", err)
	}
	if err := os.WriteFile(filepath.Join(invalidIncomePath, "tax-profiles.csv"), taxProfiles, 0o600); err != nil {
		t.Fatalf("write tax profiles: %v", err)
	}

	if _, _, err := store.ImportCSV(modelPath, invalidIncomePath); err == nil {
		t.Fatal("expected duplicate effective period import to fail")
	}
	loadedDocument, loadedIncome, err := store.LoadDocumentAndIncomeData()
	if err != nil {
		t.Fatalf("load aggregate after rollback: %v", err)
	}
	if !reflect.DeepEqual(loadedDocument, baselineDocument) || !reflect.DeepEqual(loadedIncome, baselineIncome) {
		t.Fatalf("failed import changed aggregate")
	}
}

func TestOpenRejectsFutureSchemaVersion(t *testing.T) {
	path := filepath.Join(t.TempDir(), "future.db")
	db, err := sql.Open("sqlite", path)
	if err != nil {
		t.Fatalf("open future database: %v", err)
	}
	if _, err := db.Exec(fmt.Sprintf(`PRAGMA user_version = %d`, latestSchemaVersion+1)); err != nil {
		t.Fatalf("set future version: %v", err)
	}
	if err := db.Close(); err != nil {
		t.Fatalf("close future database: %v", err)
	}
	if store, err := Open(path); err == nil {
		store.Close()
		t.Fatal("expected future schema version to be rejected")
	}
}

func openTestStore(t *testing.T) Store {
	t.Helper()
	return openSQLiteStore(t)
}

// openSQLiteStore opens the embedded-SQLite backend directly. Tests that
// assert on SQL-level details (schema versions, raw scripts) use this;
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

func createVersionOneDatabase(t *testing.T, path string) {
	t.Helper()
	db, err := sql.Open("sqlite", path)
	if err != nil {
		t.Fatalf("open version one database: %v", err)
	}
	t.Cleanup(func() { _ = db.Close() })
	tx, err := db.Begin()
	if err != nil {
		t.Fatalf("begin version one database: %v", err)
	}
	if err := migrateV1(tx); err != nil {
		t.Fatalf("create version one schema: %v", err)
	}
	statements := []string{
		`INSERT INTO accounts (id, position, label, enabled) VALUES ('checking', 0, 'Checking', 1)`,
		`INSERT INTO checkpoints (date, account_id, balance) VALUES ('2026-04-30', 'checking', 200)`,
		`INSERT INTO checkpoints (date, account_id, balance) VALUES ('2026-04-06', 'checking', 100)`,
		`INSERT INTO income_sources (id, position, label, effective_from, annual_gross_income) VALUES ('salary', 0, 'Salary', '2026-01-01', 100)`,
	}
	for _, statement := range statements {
		if _, err := tx.Exec(statement); err != nil {
			t.Fatalf("seed version one database: %v", err)
		}
	}
	if err := tx.Commit(); err != nil {
		t.Fatalf("commit version one database: %v", err)
	}
	if _, err := db.Exec(`PRAGMA user_version = 1`); err != nil {
		t.Fatalf("set version one: %v", err)
	}
	if err := db.Close(); err != nil {
		t.Fatalf("close version one database: %v", err)
	}
}

func projectRoot(t *testing.T) string {
	t.Helper()
	workingDirectory, err := os.Getwd()
	if err != nil {
		t.Fatalf("get working directory: %v", err)
	}
	return filepath.Clean(filepath.Join(workingDirectory, "..", "..", ".."))
}
