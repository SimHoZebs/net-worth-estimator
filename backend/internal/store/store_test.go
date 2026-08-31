package store

import (
	"database/sql"
	"os"
	"path/filepath"
	"reflect"
	"testing"

	"github.com/simhozebs/net-worth-estimator/backend/internal/types"
)

func TestStoreRoundTripsCanonicalDocumentMetadataAndOrder(t *testing.T) {
	store := openTestStore(t)
	var version int
	if err := store.db.QueryRow(`SELECT MAX(version) FROM schema_version`).Scan(&version); err != nil || version != latestSchemaVersion {
		t.Fatalf("fresh schema version = %d, err %v", version, err)
	}
	document := &types.FinancialModelDocument{
		SourcePath: "test-source",
		Accounts: []types.Account{{
			ID: "checking", Label: "Checking", Enabled: true,
		}},
		Checkpoints: []types.Checkpoint{
			{Date: "2026-04-30", AccountID: "checking", Balance: 200},
			{Date: "2026-04-06", AccountID: "checking", Balance: 100},
		},
		Evaluations: types.EmptyEvaluationTables(),
		Postings:    []types.Posting{},
	}

	if err := store.SaveDocument(document); err != nil {
		t.Fatalf("save document: %v", err)
	}
	loaded, err := store.LoadDocument()
	if err != nil {
		t.Fatalf("load document: %v", err)
	}
	if loaded == nil {
		t.Fatal("loaded document is nil")
	}
	if loaded.SourcePath != document.SourcePath {
		t.Fatalf("source path = %q, want %q", loaded.SourcePath, document.SourcePath)
	}
	if !reflect.DeepEqual(loaded.Checkpoints, document.Checkpoints) {
		t.Fatalf("checkpoint order changed: got %+v, want %+v", loaded.Checkpoints, document.Checkpoints)
	}
	if loaded.Accounts[0].MinBalance == nil || *loaded.Accounts[0].MinBalance != types.NoFloor {
		t.Fatalf("minimum balance was not normalized: %+v", loaded.Accounts[0].MinBalance)
	}
	if loaded.Accounts[0].MaxBalance == nil || *loaded.Accounts[0].MaxBalance != types.NoCeiling {
		t.Fatalf("maximum balance was not normalized: %+v", loaded.Accounts[0].MaxBalance)
	}

	empty := &types.FinancialModelDocument{
		SourcePath:  "empty-source",
		Accounts:    []types.Account{},
		Checkpoints: []types.Checkpoint{},
		Evaluations: types.EmptyEvaluationTables(),
		Postings:    []types.Posting{},
	}
	if err := store.SaveDocument(empty); err != nil {
		t.Fatalf("save empty document: %v", err)
	}
	exists, err := store.DocumentExists()
	if err != nil || !exists {
		t.Fatalf("empty document presence = %v, err %v", exists, err)
	}
	loaded, err = store.LoadDocument()
	if err != nil || loaded == nil || loaded.SourcePath != "empty-source" {
		t.Fatalf("load empty document = %+v, err %v", loaded, err)
	}
	if loaded.Accounts == nil || loaded.Checkpoints == nil || loaded.Postings == nil {
		t.Fatalf("empty collections were not normalized: %+v", loaded)
	}

	if err := store.Clear(); err != nil {
		t.Fatalf("clear document: %v", err)
	}
	exists, err = store.DocumentExists()
	if err != nil || exists {
		t.Fatalf("cleared document presence = %v, err %v", exists, err)
	}
	loaded, err = store.LoadDocument()
	if err != nil || loaded != nil {
		t.Fatalf("cleared document = %+v, err %v", loaded, err)
	}
}

func TestStorePersistsEffectiveDatedIncomeRowsWithSharedID(t *testing.T) {
	store := openTestStore(t)
	juneEnd := types.IsoDate("2026-06-30")
	snapshot := &types.IncomeDataSnapshot{
		IncomeSources: []types.IncomeSourceDefinition{
			{ID: "salary", Label: "First", EffectiveFrom: "2026-01-01", EffectiveTo: &juneEnd, AnnualGrossIncome: 100},
			{ID: "salary", Label: "Second", EffectiveFrom: "2026-07-01", AnnualGrossIncome: 200},
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
	store := openTestStore(t)
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
	duplicateSources := "id,label,effectiveFrom,effectiveTo,annualGrossIncome\n" +
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
	if _, err := db.Exec(`CREATE TABLE schema_version (version INTEGER NOT NULL)`); err != nil {
		t.Fatalf("create schema version: %v", err)
	}
	if _, err := db.Exec(`INSERT INTO schema_version (version) VALUES (?)`, latestSchemaVersion+1); err != nil {
		t.Fatalf("insert future version: %v", err)
	}
	if err := db.Close(); err != nil {
		t.Fatalf("close future database: %v", err)
	}
	if store, err := Open(path); err == nil {
		store.Close()
		t.Fatal("expected future schema version to be rejected")
	}
}

func openTestStore(t *testing.T) *Store {
	t.Helper()
	store, err := Open(filepath.Join(t.TempDir(), "store.db"))
	if err != nil {
		t.Fatalf("open test store: %v", err)
	}
	t.Cleanup(func() { _ = store.Close() })
	return store
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
	if _, err := tx.Exec(`CREATE TABLE schema_version (version INTEGER NOT NULL)`); err != nil {
		t.Fatalf("create version table: %v", err)
	}
	if err := migrateV1(tx); err != nil {
		t.Fatalf("create version one schema: %v", err)
	}
	statements := []string{
		`INSERT INTO schema_version (version) VALUES (1)`,
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
