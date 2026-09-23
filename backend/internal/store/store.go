package store

import (
	"database/sql"
	"fmt"

	"github.com/simhozebs/net-worth-estimator/backend/internal/types"

	_ "modernc.org/sqlite"
)

// Store is the persistence seam behind the canonical model, income data,
// projection artifacts, and SimpleFIN sync state. The server, API handlers,
// and sync runner depend only on this interface; the SQLite file backend
// below is one implementation. A replacement backend (Turso, Postgres, …)
// implements these twelve methods plus a constructor, then runs the
// conformance suite (RunConformance) to prove it.
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

const latestSchemaVersion = 3

// Open opens (creating if needed) the SQLite database and applies
// migrations. It returns the Store interface so callers never name the
// implementation.
func Open(path string) (Store, error) {
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
