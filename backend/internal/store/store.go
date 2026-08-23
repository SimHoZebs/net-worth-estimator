package store

import (
	"database/sql"
	"fmt"

	_ "modernc.org/sqlite"
)

// Store wraps the SQLite database implementing the canonical persistence.
type Store struct {
	db *sql.DB
}

// Open opens (creating if needed) the database and applies migrations.
func Open(path string) (*Store, error) {
	db, err := sql.Open("sqlite", path+"?_pragma=journal_mode(WAL)&_pragma=busy_timeout(5000)&_pragma=foreign_keys(1)")
	if err != nil {
		return nil, fmt.Errorf("open sqlite: %w", err)
	}
	db.SetMaxOpenConns(1) // single-writer discipline; reads are cheap at this scale
	store := &Store{db: db}
	if err := store.migrate(); err != nil {
		db.Close()
		return nil, err
	}
	return store, nil
}

// Close closes the database.
func (s *Store) Close() error { return s.db.Close() }

func (s *Store) migrate() error {
	statements := []string{
		`CREATE TABLE IF NOT EXISTS schema_version (
			version INTEGER NOT NULL
		)`,
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
		if _, err := s.db.Exec(statement); err != nil {
			return fmt.Errorf("migrate: %w", err)
		}
	}
	var version int64
	row := s.db.QueryRow(`SELECT COALESCE(MAX(version), 0) FROM schema_version`)
	if err := row.Scan(&version); err == nil && version < 1 {
		_, _ = s.db.Exec(`INSERT INTO schema_version (version) VALUES (1)`)
	}
	return nil
}

// Clear removes all canonical model rows (used by reset/import).
func (s *Store) Clear() error {
	tables := []string{"accounts", "checkpoints", "postings", "evaluations"}
	for _, table := range tables {
		if _, err := s.db.Exec(`DELETE FROM ` + table); err != nil {
			return fmt.Errorf("clear %s: %w", table, err)
		}
	}
	return nil
}
