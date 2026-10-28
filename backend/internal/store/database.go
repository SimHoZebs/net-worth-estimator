package store

import (
	"database/sql"
	"errors"
	"fmt"

	"github.com/simhozebs/net-worth-estimator/backend/internal/blobstore"
	blobsqlite "github.com/simhozebs/net-worth-estimator/backend/internal/blobstore/adapters/sqlite"
)

const sharedSchemaVersion = "shared-plans-v1"

// ErrLegacyDatabase identifies a pre-shared-schema database. No migration
// path exists: start from a current application database.
var ErrLegacyDatabase = errors.New("unsupported legacy database: start from a current application database")

// ErrSetupRequired identifies a missing or incomplete current database.
var ErrSetupRequired = errors.New("database setup required: run setupdb before starting the server")

// Database owns the shared SQLite connection. Financial operations use a Store
// returned for an explicit plan.
type Database struct {
	db    *sql.DB
	blobs blobstore.Store
}

// OpenDatabase opens an existing, fully provisioned database. It never creates
// files, repairs permissions, or changes the schema.
func OpenDatabase(path string, options ...DatabaseOption) (*Database, error) {
	dsn, err := existingDatabaseFile(path, false)
	if err != nil {
		return nil, err
	}
	return connectDatabase(dsn, options...)
}

// SetupDatabase provisions the current application schema for deployment or
// tests. Existing shared databases are supported; legacy databases are
// rejected. Setup never provisions accounts or plans.
func SetupDatabase(path string, options ...DatabaseOption) (*Database, error) {
	dsn, err := setupDatabaseFile(path)
	if err != nil {
		return nil, err
	}
	d, err := connectDatabase(dsn, options...)
	if err != nil {
		return nil, err
	}
	if err := d.setupSchema(); err != nil {
		d.Close()
		return nil, err
	}
	return d, nil
}

func connectDatabase(dsn string, options ...DatabaseOption) (*Database, error) {
	db, err := sql.Open("sqlite", dsn+"?mode=rw&_pragma=busy_timeout(5000)&_pragma=foreign_keys(1)")
	if err != nil {
		return nil, fmt.Errorf("open sqlite: %w", err)
	}
	db.SetMaxOpenConns(1)
	d := &Database{db: db, blobs: blobsqlite.New(db)}
	for _, option := range options {
		if err := option(d); err != nil {
			db.Close()
			return nil, err
		}
	}
	if err := db.Ping(); err != nil {
		db.Close()
		return nil, err
	}
	return d, nil
}

func (d *Database) Close() error { return d.db.Close() }
func (d *Database) SQL() *sql.DB { return d.db }

func (d *Database) setupSchema() error {
	tx, err := d.db.Begin()
	if err != nil {
		return err
	}
	defer tx.Rollback()
	var tableCount int
	if err := tx.QueryRow(`SELECT COUNT(*) FROM sqlite_master WHERE type = 'table' AND name NOT LIKE 'sqlite_%'`).Scan(&tableCount); err != nil {
		return err
	}
	if tableCount != 0 {
		if err := checkSharedSchemaMarker(tx); err != nil {
			return err
		}
	}
	for _, statement := range schemaStatements() {
		if _, err := tx.Exec(statement); err != nil {
			return fmt.Errorf("ensure shared schema: %w", err)
		}
	}
	_, defaultSQLite := d.blobs.(*blobsqlite.Store)
	if err := migrateInlineReceiptImages(tx, defaultSQLite); err != nil {
		return fmt.Errorf("migrate receipt blobs: %w", err)
	}
	if err := migratePostingReceiptIDs(tx); err != nil {
		return fmt.Errorf("migrate posting receipt fields: %w", err)
	}
	if err := migratePostingVoidFlag(tx); err != nil {
		return fmt.Errorf("migrate posting void flag: %w", err)
	}
	for _, statement := range receiptBlobSchemaObjects {
		if _, err := tx.Exec(statement); err != nil {
			return err
		}
	}
	if _, err := tx.Exec(`INSERT OR IGNORE INTO schema_migrations(name) VALUES ('receipt-blobs-v1')`); err != nil {
		return err
	}
	if _, err := tx.Exec(`INSERT OR IGNORE INTO schema_migrations(name) VALUES (?)`, sharedSchemaVersion); err != nil {
		return err
	}
	if err := checkExistingSchema(tx); err != nil {
		return err
	}
	if err := tx.Commit(); err != nil {
		return err
	}
	_, err = d.db.Exec(`PRAGMA journal_mode=WAL`)
	return err
}

func (d *Database) HasPlan(planID string) (bool, error) {
	var count int
	err := d.db.QueryRow(`SELECT COUNT(*) FROM plans WHERE id = ?`, planID).Scan(&count)
	return count == 1, err
}

func (d *Database) Plan(planID string) (Store, error) {
	exists, err := d.HasPlan(planID)
	if err != nil {
		return nil, err
	}
	if !exists {
		return nil, fmt.Errorf("plan %q: %w", planID, sql.ErrNoRows)
	}
	return &sqliteStore{db: &planDB{DB: d.db, planID: planID}, application: d}, nil
}

func (d *Database) EnsurePrivatePlan(planID, accountID, issuer, subject string) (Store, error) {
	if planID == "" || planID == "plans/sample" || planID == "plans/fixture" || accountID == "" || issuer == "" || subject == "" {
		return nil, fmt.Errorf("private plan requires a plan, account, issuer, and subject")
	}
	return d.ensurePlan(planID, "private", accountID, issuer, subject)
}

func (d *Database) EnsureSamplePlan() (Store, error) {
	return d.ensurePlan("plans/sample", "sample", "", "", "")
}

func (d *Database) ensurePlan(planID, kind, accountID, issuer, subject string) (Store, error) {
	tx, err := d.db.Begin()
	if err != nil {
		return nil, err
	}
	defer tx.Rollback()
	if kind == "private" {
		if _, err := tx.Exec(`INSERT INTO app_accounts(id, issuer, subject) VALUES (?, ?, ?) ON CONFLICT(id) DO NOTHING`, accountID, issuer, subject); err != nil {
			return nil, fmt.Errorf("ensure account: %w", err)
		}
		var storedIssuer, storedSubject string
		if err := tx.QueryRow(`SELECT issuer, subject FROM app_accounts WHERE id = ?`, accountID).Scan(&storedIssuer, &storedSubject); err != nil {
			return nil, err
		}
		if issuer != storedIssuer || subject != storedSubject {
			return nil, fmt.Errorf("account identity conflict")
		}
	}
	result, err := tx.Exec(`INSERT INTO plans(id, kind, owner_account_id) VALUES (?, ?, ?) ON CONFLICT(id) DO NOTHING`, planID, kind, nilIfEmpty(accountID))
	if err != nil {
		return nil, fmt.Errorf("ensure plan: %w", err)
	}
	var storedKind string
	var owner sql.NullString
	if err := tx.QueryRow(`SELECT kind, owner_account_id FROM plans WHERE id = ?`, planID).Scan(&storedKind, &owner); err != nil {
		return nil, err
	}
	if storedKind != kind || owner.String != accountID {
		return nil, fmt.Errorf("plan ownership conflict")
	}
	created, err := result.RowsAffected()
	if err != nil {
		return nil, err
	}
	if created != 0 {
		if err := seedPlan(&planTx{Tx: tx, planID: planID}); err != nil {
			return nil, err
		}
	}
	if err := tx.Commit(); err != nil {
		return nil, err
	}
	return &sqliteStore{db: &planDB{DB: d.db, planID: planID}, application: d}, nil
}

func nilIfEmpty(value string) any {
	if value == "" {
		return nil
	}
	return value
}
