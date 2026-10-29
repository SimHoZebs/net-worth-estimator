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

// legacySharedSchemaVersion marks plan-scoped databases. SetupDatabase migrates
// them to account scope instead of rejecting them; see migration_account_scope.go.
const legacySharedSchemaVersion = "shared-plans-v1"

// ErrLegacyDatabase identifies a pre-shared-schema database. No migration
// path exists: start from a current application database.
var ErrLegacyDatabase = errors.New("unsupported legacy database: start from a current application database")

// ErrSetupRequired identifies a missing or incomplete current database.
var ErrSetupRequired = errors.New("database setup required: run setupdb before starting the server")

// Database owns the shared SQLite connection. Financial operations use a Store
// returned for an explicit account scope.
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
// tests. Existing shared databases are supported: plan-scoped databases are
// migrated to account scope. Pre-shared-schema databases are rejected. Setup
// never provisions application accounts or financial scopes.
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
	if migrated, err := migratePlansToAccounts(tx); err != nil {
		return fmt.Errorf("migrate plan scope to account scope: %w", err)
	} else if migrated {
		for _, statement := range schemaStatements() {
			if _, err := tx.Exec(statement); err != nil {
				return fmt.Errorf("ensure shared schema: %w", err)
			}
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

// NormalizeAccountID maps a legacy plan resource ID to its account scope ID.
// Private plans used plans/<hash> where <hash> is the OIDC identity hash;
// the account scope for the same owner is user:<hash>. The guest sample and
// the isolated test fixture map to the reserved "sample" and "fixture"
// scopes. Only unambiguous production shapes rewrite: other plans/* values
// pass through unchanged so the bare-owner fallback in Has/Account remains
// the single resolution path for them. Current account IDs pass through
// unchanged.
func NormalizeAccountID(id string) string {
	if rest, ok := strings.CutPrefix(id, "plans/"); ok {
		switch rest {
		case "sample":
			return SampleAccountID
		case "fixture":
			return FixtureAccountID
		}
		if isIdentityHash(rest) {
			return "user:" + rest
		}
	}
	return id
}

// isIdentityHash reports whether s is a 64-hex OIDC identity hash.
func isIdentityHash(s string) bool {
	if len(s) != 64 {
		return false
	}
	for i := 0; i < len(s); i++ {
		c := s[i]
		if c >= '0' && c <= '9' || c >= 'a' && c <= 'f' || c >= 'A' && c <= 'F' {
			continue
		}
		return false
	}
	return true
}

// SampleAccountID is the reserved read-only guest scope. It has no
// app_accounts row; the API authorizes it separately from verified owners.
const SampleAccountID = "sample"

// FixtureAccountID is the reserved isolated-test scope created by Open.
const FixtureAccountID = "fixture"

func (d *Database) HasAccount(accountID string) (bool, error) {
	_, err := d.ResolveAccountID(accountID)
	if errors.Is(err, store.ErrNotFound) {
		return false, nil
	}
	return err == nil, err
}

// hasAccountExact checks one scope ID with no legacy fallback.
func (d *Database) hasAccountExact(accountID string) (bool, error) {
	if accountID == SampleAccountID || accountID == FixtureAccountID {
		var count int
		err := d.db.QueryRow(`SELECT COUNT(*) FROM model_metadata WHERE account_id = ? AND id = 1`, accountID).Scan(&count)
		return count == 1, err
	}
	var count int
	err := d.db.QueryRow(`SELECT COUNT(*) FROM app_accounts WHERE id = ?`, accountID).Scan(&count)
	return count == 1, err
}

// HasPlan is a compatibility wrapper over HasAccount. Legacy plan resource
// IDs (plans/<hash>, plans/sample, plans/fixture) normalize to account scope.
func (d *Database) HasPlan(planID string) (bool, error) {
	return d.HasAccount(planID)
}

func (d *Database) Account(accountID string) (store.Store, error) {
	resolved, err := d.ResolveAccountID(accountID)
	if err != nil {
		return nil, err
	}
	return &sqliteStore{db: &accountDB{DB: d.db, accountID: resolved}, application: d}, nil
}

// ResolveAccountID returns the scope ID a resource string binds to: the
// normalized form when that scope exists, else the bare-owner form for
// legacy plans/<name> IDs, else ErrNotFound. Operator tooling uses this so
// legacy plans/* inputs resolve to the same winning scope as Account.
func (d *Database) ResolveAccountID(accountID string) (string, error) {
	normalized := NormalizeAccountID(accountID)
	exists, err := d.hasAccountExact(normalized)
	if err != nil {
		return "", err
	}
	if exists {
		return normalized, nil
	}
	if rest, ok := strings.CutPrefix(accountID, "plans/"); ok && rest != normalized {
		if fallback, err := d.hasAccountExact(rest); err != nil {
			return "", err
		} else if fallback {
			return rest, nil
		}
	}
	return "", fmt.Errorf("account %q: %w", accountID, store.ErrNotFound)
}

// Plan is a compatibility wrapper over Account.
func (d *Database) Plan(planID string) (store.Store, error) {
	return d.Account(planID)
}

func (d *Database) EnsurePrivateAccount(accountID, issuer, subject string) (store.Store, error) {
	accountID = NormalizeAccountID(accountID)
	if accountID == "" || accountID == SampleAccountID || accountID == FixtureAccountID || issuer == "" || subject == "" {
		return nil, fmt.Errorf("private account requires an account, issuer, and subject")
	}
	return d.ensureAccount(accountID, issuer, subject)
}

// EnsurePrivatePlan is a compatibility wrapper over EnsurePrivateAccount.
// Matching pairs (plans/<hash> with owner user:<hash>, or a legacy plans/<name>
// with the same owner name) resolve to the owner scope. Any other mismatch is
// an ownership conflict, matching the retired plan-ownership rule.
func (d *Database) EnsurePrivatePlan(planID, accountID, issuer, subject string) (store.Store, error) {
	normalizedPlan, normalizedAccount := NormalizeAccountID(planID), NormalizeAccountID(accountID)
	if normalizedPlan != normalizedAccount {
		if !strings.HasPrefix(planID, "plans/") || strings.TrimPrefix(planID, "plans/") != accountID {
			return nil, fmt.Errorf("plan ownership conflict")
		}
	}
	return d.EnsurePrivateAccount(normalizedAccount, issuer, subject)
}

func (d *Database) EnsureSampleAccount() (store.Store, error) {
	return d.ensureAccount(SampleAccountID, "", "")
}

// EnsureSamplePlan is a compatibility wrapper over EnsureSampleAccount.
func (d *Database) EnsureSamplePlan() (store.Store, error) {
	return d.EnsureSampleAccount()
}

func (d *Database) ensureAccount(accountID, issuer, subject string) (store.Store, error) {
	tx, err := d.db.Begin()
	if err != nil {
		return nil, err
	}
	defer tx.Rollback()
	if accountID != SampleAccountID && accountID != FixtureAccountID {
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
	var created int
	if err := tx.QueryRow(`SELECT COUNT(*) FROM model_metadata WHERE account_id = ? AND id = 1`, accountID).Scan(&created); err != nil {
		return nil, err
	}
	if created == 0 {
		if err := seedAccount(&accountTx{Tx: tx, accountID: accountID}); err != nil {
			return nil, err
		}
	}
	if err := tx.Commit(); err != nil {
		return nil, err
	}
	return &sqliteStore{db: &accountDB{DB: d.db, accountID: accountID}, application: d}, nil
}
