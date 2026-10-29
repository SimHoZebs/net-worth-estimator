package sqlite

import (
	"context"
	"database/sql"
	"errors"
	"fmt"

	"github.com/simhozebs/net-worth-estimator/backend/internal/blobstore"
	blobsqlite "github.com/simhozebs/net-worth-estimator/backend/internal/blobstore/adapters/sqlite"
	"github.com/simhozebs/net-worth-estimator/backend/internal/store"
)

const sharedSchemaVersion = "shared-accounts-v1"

// ErrLegacyDatabase identifies a pre-account-scope database. No migration
// path exists: start from a current application database.
var ErrLegacyDatabase = errors.New("unsupported legacy database: start from a current application database")

// ErrSetupRequired identifies a missing or incomplete current database.
var ErrSetupRequired = errors.New("database setup required: run setupdb before starting the server")

// Synthetic account IDs for the explicit sample/fixture exceptions. They use
// placeholder issuer/subject identities so app_accounts FKs hold.
const (
	SampleAccountID  = "sample"
	FixtureAccountID = "fixture"
)

// Database owns the shared SQLite connection. Financial operations use a Store
// returned for an explicit account.
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
// rejected. Setup never provisions accounts.
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

func (d *Database) PingContext(ctx context.Context) error { return d.db.PingContext(ctx) }
func (d *Database) SQL() *sql.DB                          { return d.db }

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
	if err := migrateSourceUser(tx); err != nil {
		return fmt.Errorf("migrate row source names: %w", err)
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

func (d *Database) HasAccount(accountID string) (bool, error) {
	var count int
	err := d.db.QueryRow(`SELECT COUNT(*) FROM app_accounts WHERE id = ?`, accountID).Scan(&count)
	return count == 1, err
}

func (d *Database) Account(accountID string) (store.Store, error) {
	exists, err := d.HasAccount(accountID)
	if err != nil {
		return nil, err
	}
	if !exists {
		return nil, fmt.Errorf("account %q: %w", accountID, store.ErrNotFound)
	}
	return &sqliteStore{db: &accountDB{DB: d.db, accountID: accountID}, application: d}, nil
}

// EnsureAccount provisions the app account row and seeds financial tables on
// first create. Identity is verified: a reused account ID with a different
// issuer/subject fails, and a reused issuer/subject with a different account
// ID fails via UNIQUE(issuer, subject).
func (d *Database) EnsureAccount(accountID, issuer, subject string) (store.Store, error) {
	if accountID == "" || issuer == "" || subject == "" {
		return nil, fmt.Errorf("account requires an account, issuer, and subject")
	}
	return d.ensureAccount(accountID, issuer, subject)
}

func (d *Database) ensureAccount(accountID, issuer, subject string) (store.Store, error) {
	tx, err := d.db.Begin()
	if err != nil {
		return nil, err
	}
	defer tx.Rollback()
	result, err := tx.Exec(`INSERT INTO app_accounts(id, issuer, subject) VALUES (?, ?, ?) ON CONFLICT(id) DO NOTHING`, accountID, issuer, subject)
	if err != nil {
		return nil, fmt.Errorf("ensure account: %w", err)
	}
	var storedIssuer, storedSubject string
	if err := tx.QueryRow(`SELECT issuer, subject FROM app_accounts WHERE id = ?`, accountID).Scan(&storedIssuer, &storedSubject); err != nil {
		return nil, err
	}
	if issuer != storedIssuer || subject != storedSubject {
		return nil, fmt.Errorf("account identity conflict")
	}
	// Only the creator seeds: the app_accounts insert reports RowsAffected,
	// so concurrent ensures for one new ID seed exactly once. A row first
	// created by EnsureGroupAccount carries no financial tables yet; the
	// first EnsureAccount seeds it while its metadata row is still absent.
	// Seeding runs in the same transaction, so a commit means both account
	// and seed persist. Within this handle the single open connection
	// serializes concurrent ensures, so the check-and-seed cannot run twice
	// for one account through one Database.
	created, err := result.RowsAffected()
	if err != nil {
		return nil, err
	}
	seed := created != 0
	if !seed {
		var present int
		if err := tx.QueryRow(`SELECT COUNT(*) FROM model_metadata WHERE account_id = ?`, accountID).Scan(&present); err != nil {
			return nil, err
		}
		seed = present == 0
	}
	if seed {
		if err := seedAccountTables(&accountTx{Tx: tx, accountID: accountID}); err != nil {
			return nil, err
		}
	}
	if err := tx.Commit(); err != nil {
		return nil, err
	}
	return &sqliteStore{db: &accountDB{DB: d.db, accountID: accountID}, application: d}, nil
}

// EnsureSampleAccount provisions the synthetic sample account. The sample is
// an explicit exception to verified-identity provisioning: it uses
// placeholder identity values so app_accounts FKs hold.
func (d *Database) EnsureSampleAccount() (store.Store, error) {
	return d.ensureAccount(SampleAccountID, SampleAccountID, SampleAccountID)
}
