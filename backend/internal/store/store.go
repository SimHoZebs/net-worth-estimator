package store

import (
	"database/sql"
	"fmt"
	"io"
	"os"

	"github.com/simhozebs/net-worth-estimator/backend/internal/types"

	_ "modernc.org/sqlite"
)

// Store is the persistence seam behind the canonical model, income data,
// projection artifacts, and SimpleFIN sync state. The server, API handlers,
// and sync runner depend only on this interface; the SQLite file backend
// below is one implementation. A replacement backend (Turso, Postgres, …)
// implements these methods plus a constructor, then runs the conformance
// suite (RunConformance) to prove it.
//
// Contract notes for implementers:
//   - Writes are single-threaded by the caller discipline (one server, one
//     instance); the backend must still serialize concurrent writes safely.
//   - Readers always see the latest committed state (no stale replicas).
//   - SQL must stay portable: plain DDL/DML plus ON CONFLICT only. No
//     SQLite pragmas, extensions, or file assumptions outside Open.
//   - An empty backend reports DocumentExists() == false so the server
//     seeds from CSVs on first boot; Open applies migrations itself.
//   - Clear resets all persisted state; the conformance suite relies on it.
type Store interface {
	LoadDocument() (*types.FinancialModelDocument, error)
	SaveDocument(document *types.FinancialModelDocument) error
	SaveDocumentIfUnchanged(document *types.FinancialModelDocument, expectedETag string) (bool, error)
	DocumentMatchesETag(expectedETag string) (bool, error)
	DocumentExists() (bool, error)
	LoadIncomeData() (*types.IncomeDataSnapshot, error)
	SaveIncomeData(snapshot *types.IncomeDataSnapshot) error
	LoadDocumentAndIncomeData() (*types.FinancialModelDocument, *types.IncomeDataSnapshot, error)
	ImportCSV(modelPath, incomePath string) (*types.FinancialModelDocument, *types.IncomeDataSnapshot, error)
	GetArtifact(identity string) (string, bool, error)
	PutArtifact(identity, kind, payload string) error
	ApplySyncPlan(checkpoints []SyncCheckpoint, pending []types.Posting, cardAccounts []string, dryRun bool) (SyncApplySummary, error)
	Clear() error
	Close() error
}

// sqliteStore is the embedded-SQLite Store implementation. Pure-Go driver
// (modernc), single file, WAL mode, one open connection.
type sqliteStore struct {
	db *sql.DB
}

const latestSchemaVersion = 7

// ruleMigrationBackupSuffix marks the pre-V7 database copy. V7 splits the
// postings table into dated postings plus recurrence rules; the copy lets an
// operator restore the exact pre-migration file with a single rename.
const ruleMigrationBackupSuffix = ".pre-v7-backup"

// Open opens (creating if needed) the SQLite database and applies
// migrations. It returns the Store interface so callers never name the
// implementation.
func Open(path string) (Store, error) {
	if err := backupBeforeRuleMigration(path); err != nil {
		return nil, err
	}
	db, err := sql.Open("sqlite", path+"?_pragma=journal_mode(WAL)&_pragma=busy_timeout(5000)&_pragma=foreign_keys(1)")
	if err != nil {
		return nil, fmt.Errorf("open sqlite: %w", err)
	}
	db.SetMaxOpenConns(1) // single-writer discipline; reads are cheap at this scale
	store := &sqliteStore{db: db}
	if err := store.migrate(); err != nil {
		db.Close()
		return nil, err
	}
	return store, nil
}

// backupBeforeRuleMigration copies the database file before V7 runs. It is
// a no-op for fresh databases, already-migrated ones, probe failures, and
// when a backup already exists.
func backupBeforeRuleMigration(path string) error {
	info, err := os.Stat(path)
	if err != nil || info.IsDir() {
		return nil
	}
	version, err := readSchemaVersionReadOnly(path)
	if err != nil || version >= 7 {
		return nil
	}
	backupPath := path + ruleMigrationBackupSuffix
	if _, err := os.Stat(backupPath); err == nil {
		return nil
	}
	source, err := os.Open(path)
	if err != nil {
		return fmt.Errorf("open database for backup: %w", err)
	}
	defer source.Close()
	destination, err := os.OpenFile(backupPath, os.O_WRONLY|os.O_CREATE|os.O_EXCL, 0600)
	if err != nil {
		return fmt.Errorf("create database backup: %w", err)
	}
	defer destination.Close()
	if _, err := io.Copy(destination, source); err != nil {
		return fmt.Errorf("copy database backup: %w", err)
	}
	return nil
}

// readSchemaVersionReadOnly probes the migration version without writing.
// Any failure (missing file, older layout, locked database) reports an
// error and the caller proceeds without a backup.
func readSchemaVersionReadOnly(path string) (int, error) {
	db, err := sql.Open("sqlite", path+"?mode=ro")
	if err != nil {
		return 0, err
	}
	defer db.Close()
	var version int
	if err := db.QueryRow(`SELECT COALESCE(MAX(version), 0) FROM schema_version`).Scan(&version); err != nil {
		return 0, err
	}
	return version, nil
}

// Close closes the database.
func (s *sqliteStore) Close() error { return s.db.Close() }

func (s *sqliteStore) migrate() error {
	tx, err := s.db.Begin()
	if err != nil {
		return fmt.Errorf("begin migration: %w", err)
	}
	defer tx.Rollback()
	if _, err := tx.Exec(`CREATE TABLE IF NOT EXISTS schema_version (version INTEGER NOT NULL)`); err != nil {
		return fmt.Errorf("create schema version: %w", err)
	}
	var version int
	if err := tx.QueryRow(`SELECT COALESCE(MAX(version), 0) FROM schema_version`).Scan(&version); err != nil {
		return fmt.Errorf("read schema version: %w", err)
	}
	if version > latestSchemaVersion {
		return fmt.Errorf("database schema version %d is newer than supported version %d", version, latestSchemaVersion)
	}
	if version < 1 {
		if err := migrateV1(tx); err != nil {
			return err
		}
		if _, err := tx.Exec(`INSERT INTO schema_version (version) VALUES (1)`); err != nil {
			return fmt.Errorf("record schema version 1: %w", err)
		}
		version = 1
	}
	if version < 2 {
		if err := migrateV2(tx); err != nil {
			return err
		}
		if _, err := tx.Exec(`INSERT INTO schema_version (version) VALUES (2)`); err != nil {
			return fmt.Errorf("record schema version 2: %w", err)
		}
		version = 2
	}
	if version < 3 {
		if err := migrateV3(tx); err != nil {
			return err
		}
		if _, err := tx.Exec(`INSERT INTO schema_version (version) VALUES (3)`); err != nil {
			return fmt.Errorf("record schema version 3: %w", err)
		}
		version = 3
	}
	if version < 4 {
		if err := migrateV4(tx); err != nil {
			return err
		}
		if _, err := tx.Exec(`INSERT INTO schema_version (version) VALUES (4)`); err != nil {
			return fmt.Errorf("record schema version 4: %w", err)
		}
		version = 4
	}
	if version < 5 {
		if err := migrateV5(tx); err != nil {
			return err
		}
		if _, err := tx.Exec(`INSERT INTO schema_version (version) VALUES (5)`); err != nil {
			return fmt.Errorf("record schema version 5: %w", err)
		}
		version = 5
	}
	if version < 6 {
		if err := migrateV6(tx); err != nil {
			return err
		}
		if _, err := tx.Exec(`INSERT INTO schema_version (version) VALUES (6)`); err != nil {
			return fmt.Errorf("record schema version 6: %w", err)
		}
		version = 6
	}
	if version < 7 {
		if err := migrateV7(tx); err != nil {
			return err
		}
		if _, err := tx.Exec(`INSERT INTO schema_version (version) VALUES (7)`); err != nil {
			return fmt.Errorf("record schema version 7: %w", err)
		}
	}
	if err := tx.Commit(); err != nil {
		return fmt.Errorf("commit migration: %w", err)
	}
	return nil
}

func migrateV1(tx *sql.Tx) error {
	statements := []string{
		`CREATE TABLE IF NOT EXISTS accounts (
			id TEXT PRIMARY KEY,
			position INTEGER NOT NULL,
			label TEXT NOT NULL,
			min_balance REAL,
			max_balance REAL,
			color TEXT,
			enabled INTEGER NOT NULL
		)`,
		`CREATE TABLE IF NOT EXISTS checkpoints (
			id INTEGER PRIMARY KEY AUTOINCREMENT,
			date TEXT NOT NULL,
			account_id TEXT NOT NULL,
			balance REAL NOT NULL,
			UNIQUE(account_id, date)
		)`,
		`CREATE TABLE IF NOT EXISTS postings (
			id TEXT PRIMARY KEY,
			position INTEGER NOT NULL,
			label TEXT NOT NULL,
			source_account_id TEXT,
			destinations TEXT,
			amount_json TEXT NOT NULL,
			frequency TEXT NOT NULL,
			annual_rate REAL NOT NULL,
			annual_growth_rate REAL NOT NULL,
			volatility REAL NOT NULL,
			start_date TEXT NOT NULL,
			end_date TEXT,
			annual_cap REAL,
			priority INTEGER NOT NULL,
			enabled INTEGER NOT NULL
		)`,
		`CREATE TABLE IF NOT EXISTS evaluations (
			type TEXT NOT NULL,
			instance_id TEXT NOT NULL,
			position INTEGER NOT NULL,
			label TEXT NOT NULL,
			enabled INTEGER NOT NULL,
			config_json TEXT NOT NULL,
			PRIMARY KEY (type, instance_id)
		)`,
		`CREATE TABLE IF NOT EXISTS income_sources (
			id TEXT PRIMARY KEY,
			position INTEGER NOT NULL,
			label TEXT NOT NULL,
			effective_from TEXT NOT NULL,
			effective_to TEXT,
			annual_gross_income REAL NOT NULL
		)`,
		`CREATE TABLE IF NOT EXISTS tax_profiles (
			id TEXT PRIMARY KEY,
			position INTEGER NOT NULL,
			label TEXT NOT NULL,
			deduction REAL NOT NULL,
			brackets_json TEXT NOT NULL,
			source_url TEXT
		)`,
		`CREATE TABLE IF NOT EXISTS projection_artifacts (
			identity TEXT PRIMARY KEY,
			kind TEXT NOT NULL,
			created_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now')),
			payload TEXT NOT NULL
		)`,
	}
	for _, statement := range statements {
		if _, err := tx.Exec(statement); err != nil {
			return fmt.Errorf("migrate schema version 1: %w", err)
		}
	}
	return nil
}

func migrateV2(tx *sql.Tx) error {
	statements := []string{
		`CREATE TABLE model_metadata (
			id INTEGER PRIMARY KEY CHECK (id = 1),
			source_path TEXT NOT NULL,
			document_present INTEGER NOT NULL CHECK (document_present IN (0, 1))
		)`,
		`INSERT INTO model_metadata (id, source_path, document_present)
		 SELECT 1, '', CASE WHEN
			EXISTS (SELECT 1 FROM accounts) OR
			EXISTS (SELECT 1 FROM checkpoints) OR
			EXISTS (SELECT 1 FROM postings) OR
			EXISTS (SELECT 1 FROM evaluations)
		 THEN 1 ELSE 0 END`,
		`CREATE TABLE checkpoints_v2 (
			id INTEGER PRIMARY KEY AUTOINCREMENT,
			position INTEGER NOT NULL,
			date TEXT NOT NULL,
			account_id TEXT NOT NULL,
			balance REAL NOT NULL,
			UNIQUE(account_id, date)
		)`,
		`INSERT INTO checkpoints_v2 (id, position, date, account_id, balance)
		 SELECT id, id, date, account_id, balance FROM checkpoints ORDER BY id`,
		`DROP TABLE checkpoints`,
		`ALTER TABLE checkpoints_v2 RENAME TO checkpoints`,
		`CREATE TABLE income_sources_v2 (
			id TEXT NOT NULL,
			position INTEGER NOT NULL,
			label TEXT NOT NULL,
			effective_from TEXT NOT NULL,
			effective_to TEXT,
			annual_gross_income REAL NOT NULL,
			PRIMARY KEY (id, effective_from)
		)`,
		`INSERT INTO income_sources_v2 (id, position, label, effective_from, effective_to, annual_gross_income)
		 SELECT id, position, label, effective_from, effective_to, annual_gross_income
		 FROM income_sources ORDER BY position`,
		`DROP TABLE income_sources`,
		`ALTER TABLE income_sources_v2 RENAME TO income_sources`,
	}
	for _, statement := range statements {
		if _, err := tx.Exec(statement); err != nil {
			return fmt.Errorf("migrate schema version 2: %w", err)
		}
	}
	return nil
}

func migrateV3(tx *sql.Tx) error {
	statements := []string{
		`ALTER TABLE checkpoints ADD COLUMN source TEXT NOT NULL DEFAULT 'model'`,
		`ALTER TABLE postings ADD COLUMN source TEXT NOT NULL DEFAULT 'model'`,
	}
	for _, statement := range statements {
		if _, err := tx.Exec(statement); err != nil {
			return fmt.Errorf("migrate schema version 3: %w", err)
		}
	}
	return nil
}

// Clear removes all canonical model rows (used by tests/import).
func (s *sqliteStore) Clear() error {
	tx, err := s.db.Begin()
	if err != nil {
		return fmt.Errorf("clear begin: %w", err)
	}
	defer tx.Rollback()
	if err := clearDocument(tx); err != nil {
		return err
	}
	if err := tx.Commit(); err != nil {
		return fmt.Errorf("clear commit: %w", err)
	}
	return nil
}

// migrateV4 renames the "label" column to "name" on every table that carried
// one, so the stored schema matches the CSV headers and the JSON contract.
func migrateV4(tx *sql.Tx) error {
	statements := []string{
		`ALTER TABLE accounts RENAME COLUMN label TO name`,
		`ALTER TABLE postings RENAME COLUMN label TO name`,
		`ALTER TABLE evaluations RENAME COLUMN label TO name`,
		`ALTER TABLE income_sources RENAME COLUMN label TO name`,
		`ALTER TABLE tax_profiles RENAME COLUMN label TO name`,
	}
	for _, statement := range statements {
		if _, err := tx.Exec(statement); err != nil {
			return fmt.Errorf("migrate schema version 4: %w", err)
		}
	}
	return nil
}

// migrateV5 adds the account kind column. Existing rows are classified from
// their balance sign, which is what the editor inferred before the column
// existed, so a migrated database opens with the same grouping the app
// derived. Re-running the model with an authored kind column replaces it.
func migrateV5(tx *sql.Tx) error {
	statements := []string{
		`ALTER TABLE accounts ADD COLUMN kind TEXT NOT NULL DEFAULT 'cash'`,
		`UPDATE accounts SET kind = CASE WHEN (
			SELECT COALESCE(SUM(balance), 0) FROM checkpoints
			WHERE checkpoints.account_id = accounts.id
		) < 0 THEN 'debt' ELSE 'cash' END`,
	}
	for _, statement := range statements {
		if _, err := tx.Exec(statement); err != nil {
			return fmt.Errorf("migrate schema version 5: %w", err)
		}
	}
	return nil
}

// migrateV7 splits repetition out of postings. Rows with frequency 'once'
// become dated postings; every other row becomes a recurrence rule carrying
// the schedule fields. Claim columns start empty: no historical row can
// reference a rule that did not exist yet.
func migrateV7(tx *sql.Tx) error {
	statements := []string{
		`CREATE TABLE recurrence_rules (
			id TEXT PRIMARY KEY,
			position INTEGER NOT NULL,
			name TEXT NOT NULL,
			source_account_id TEXT,
			destinations TEXT,
			amount_json TEXT NOT NULL,
			frequency TEXT NOT NULL,
			annual_rate REAL NOT NULL,
			annual_growth_rate REAL NOT NULL,
			volatility REAL NOT NULL,
			start_date TEXT NOT NULL,
			end_date TEXT,
			annual_cap REAL,
			priority INTEGER NOT NULL,
			enabled INTEGER NOT NULL
		)`,
		`INSERT INTO recurrence_rules (id, position, name, source_account_id, destinations, amount_json, frequency, annual_rate, annual_growth_rate, volatility, start_date, end_date, annual_cap, priority, enabled)
		 SELECT id, position, name, source_account_id, destinations, amount_json, frequency, annual_rate, annual_growth_rate, volatility, start_date, end_date, annual_cap, priority, enabled
		 FROM postings WHERE frequency != 'once' ORDER BY position`,
		`CREATE TABLE postings_v7 (
			id TEXT PRIMARY KEY,
			position INTEGER NOT NULL,
			name TEXT NOT NULL,
			source_account_id TEXT,
			destinations TEXT,
			amount_json TEXT NOT NULL,
			date TEXT NOT NULL,
			claim_rule_id TEXT,
			claim_occurrence_date TEXT,
			priority INTEGER NOT NULL,
			enabled INTEGER NOT NULL,
			source TEXT NOT NULL DEFAULT 'model'
		)`,
		`INSERT INTO postings_v7 (id, position, name, source_account_id, destinations, amount_json, date, claim_rule_id, claim_occurrence_date, priority, enabled, source)
		 SELECT id, position, name, source_account_id, destinations, amount_json, start_date, NULL, NULL, priority, enabled, source
		 FROM postings WHERE frequency = 'once' ORDER BY position`,
		`DROP TABLE postings`,
		`ALTER TABLE postings_v7 RENAME TO postings`,
	}
	for _, statement := range statements {
		if _, err := tx.Exec(statement); err != nil {
			return fmt.Errorf("migrate schema version 7: %w", err)
		}
	}
	return nil
}

// migrateV6 adds the payment-terms table. Terms are owner config keyed by
// account, so no backfill runs: existing databases open with no terms rows,
// exactly like a model with no evaluations.
func migrateV6(tx *sql.Tx) error {
	statements := []string{
		`CREATE TABLE payment_terms (
			account_id TEXT PRIMARY KEY,
			position INTEGER NOT NULL,
			minimum_fixed REAL NOT NULL,
			minimum_percent REAL,
			due_day INTEGER NOT NULL,
			statement_day INTEGER
		)`,
	}
	for _, statement := range statements {
		if _, err := tx.Exec(statement); err != nil {
			return fmt.Errorf("migrate schema version 6: %w", err)
		}
	}
	return nil
}
