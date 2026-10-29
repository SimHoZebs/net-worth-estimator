package sqlite

import (
	"context"
	"database/sql"
	"errors"
	"fmt"
	"strings"

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
// placeholder issuer/subject identities so app_accounts FKs hold. Full guest
// removal belongs to the auth lane; these shims only keep the build green.
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
	// so concurrent ensures for one new ID seed exactly once. Seeding runs in
	// the same transaction, so a commit means both account and seed persist.
	created, err := result.RowsAffected()
	if err != nil {
		return nil, err
	}
	if created != 0 {
		if err := seedAccountTables(&accountTx{Tx: tx, accountID: accountID}); err != nil {
			return nil, err
		}
	}
	if err := tx.Commit(); err != nil {
		return nil, err
	}
	return &sqliteStore{db: &accountDB{DB: d.db, accountID: accountID}, application: d}, nil
}

// planToAccountID maps legacy plan IDs to account scope. Private plans
// plans/<hash> map to user:<hash> (same hash suffix as ActorKey); sample and
// fixture map to their synthetic accounts.
func planToAccountID(planID string) (string, error) {
	switch planID {
	case "plans/sample":
		return SampleAccountID, nil
	case "plans/fixture":
		return FixtureAccountID, nil
	}
	if strings.HasPrefix(planID, "plans/") && len(planID) > len("plans/") {
		return "user:" + strings.TrimPrefix(planID, "plans/"), nil
	}
	return "", fmt.Errorf("unknown plan %q", planID)
}

// HasPlan is a deprecated shim over HasAccount for auth/frontend callers.
func (d *Database) HasPlan(planID string) (bool, error) {
	accountID, err := planToAccountID(planID)
	if err != nil {
		return false, nil
	}
	return d.HasAccount(accountID)
}

// Plan is a deprecated shim over Account for auth/frontend callers.
func (d *Database) Plan(planID string) (store.Store, error) {
	accountID, err := planToAccountID(planID)
	if err != nil {
		return nil, fmt.Errorf("plan %q: %w", planID, store.ErrNotFound)
	}
	return d.Account(accountID)
}

// EnsurePrivatePlan is a deprecated shim over EnsureAccount. The accountID
// parameter selects the scope; planID is validated for shape only.
func (d *Database) EnsurePrivatePlan(planID, accountID, issuer, subject string) (store.Store, error) {
	if planID == "" || planID == "plans/sample" || planID == "plans/fixture" || accountID == "" || issuer == "" || subject == "" {
		return nil, fmt.Errorf("private plan requires a plan, account, issuer, and subject")
	}
	if _, err := planToAccountID(planID); err != nil {
		return nil, fmt.Errorf("private plan requires a plan, account, issuer, and subject")
	}
	return d.EnsureAccount(accountID, issuer, subject)
}

// EnsureSamplePlan is a deprecated shim that ensures the synthetic sample
// account. Full guest removal belongs to the auth lane.
func (d *Database) EnsureSamplePlan() (store.Store, error) {
	return d.ensureAccount(SampleAccountID, SampleAccountID, SampleAccountID)
}
