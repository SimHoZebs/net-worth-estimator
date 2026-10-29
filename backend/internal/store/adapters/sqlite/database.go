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

// ErrLegacyDatabase identifies a pre-user-scope database. No migration
// path exists: start from a current application database.
var ErrLegacyDatabase = errors.New("unsupported legacy database: start from a current application database")

// ErrSetupRequired identifies a missing or incomplete current database.
var ErrSetupRequired = errors.New("database setup required: run setupdb before starting the server")

// Synthetic user IDs for the explicit sample/fixture exceptions. They use
// placeholder issuer/subject identities so users FKs hold.
const (
	SampleUserID  = "sample"
	FixtureUserID = "fixture"
)

// Database owns the shared SQLite connection. Financial operations use a Store
// returned for an explicit user.
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
// rejected. Setup never provisions users.
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

func (d *Database) HasUser(userID string) (bool, error) {
	var count int
	err := d.db.QueryRow(`SELECT COUNT(*) FROM users WHERE id = ?`, userID).Scan(&count)
	return count == 1, err
}

func (d *Database) User(userID string) (store.Store, error) {
	exists, err := d.HasUser(userID)
	if err != nil {
		return nil, err
	}
	if !exists {
		return nil, fmt.Errorf("user %q: %w", userID, store.ErrNotFound)
	}
	return &sqliteStore{db: &userDB{DB: d.db, userID: userID}, application: d}, nil
}

// EnsureUser provisions the user row and seeds financial tables on
// first create. Identity is verified: a reused user ID with a different
// issuer/subject fails, and a reused issuer/subject with a different user
// ID fails via UNIQUE(issuer, subject).
func (d *Database) EnsureUser(userID, issuer, subject string) (store.Store, error) {
	if userID == "" || issuer == "" || subject == "" {
		return nil, fmt.Errorf("user requires a user, issuer, and subject")
	}
	return d.ensureUser(userID, issuer, subject)
}

func (d *Database) ensureUser(userID, issuer, subject string) (store.Store, error) {
	tx, err := d.db.Begin()
	if err != nil {
		return nil, err
	}
	defer tx.Rollback()
	result, err := tx.Exec(`INSERT INTO users(id, issuer, subject) VALUES (?, ?, ?) ON CONFLICT(id) DO NOTHING`, userID, issuer, subject)
	if err != nil {
		return nil, fmt.Errorf("ensure user: %w", err)
	}
	var storedIssuer, storedSubject string
	if err := tx.QueryRow(`SELECT issuer, subject FROM users WHERE id = ?`, userID).Scan(&storedIssuer, &storedSubject); err != nil {
		return nil, err
	}
	if issuer != storedIssuer || subject != storedSubject {
		return nil, fmt.Errorf("user identity conflict")
	}
	// Only the creator seeds: the users insert reports RowsAffected,
	// so concurrent ensures for one new ID seed exactly once. A row first
	// created by EnsureGroupUser carries no financial tables yet; the
	// first EnsureUser seeds it while its metadata row is still absent.
	// Seeding runs in the same transaction, so a commit means both user
	// and seed persist. Within this handle the single open connection
	// serializes concurrent ensures, so the check-and-seed cannot run twice
	// for one user through one Database.
	created, err := result.RowsAffected()
	if err != nil {
		return nil, err
	}
	seed := created != 0
	if !seed {
		var present int
		if err := tx.QueryRow(`SELECT COUNT(*) FROM model_metadata WHERE user_id = ?`, userID).Scan(&present); err != nil {
			return nil, err
		}
		seed = present == 0
	}
	if seed {
		if err := seedUserTables(&userTx{Tx: tx, userID: userID}); err != nil {
			return nil, err
		}
	}
	if err := tx.Commit(); err != nil {
		return nil, err
	}
	return &sqliteStore{db: &userDB{DB: d.db, userID: userID}, application: d}, nil
}

// EnsureSampleUser provisions the synthetic sample user. The sample is
// an explicit exception to verified-identity provisioning: it uses
// placeholder identity values so users FKs hold.
func (d *Database) EnsureSampleUser() (store.Store, error) {
	return d.ensureUser(SampleUserID, SampleUserID, SampleUserID)
}
