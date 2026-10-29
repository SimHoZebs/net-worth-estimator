package sqlite

import (
	"database/sql"
	"path/filepath"
	"testing"
)

func createLegacyPlansDatabase(t *testing.T, path string) {
	t.Helper()
	db, err := sql.Open("sqlite", path)
	if err != nil {
		t.Fatal(err)
	}
	defer db.Close()
	statements := []string{
		`CREATE TABLE schema_migrations(name TEXT PRIMARY KEY)`,
		`INSERT INTO schema_migrations(name) VALUES ('receipt-blobs-v1'), ('shared-plans-v1')`,
		`CREATE TABLE app_accounts(id TEXT PRIMARY KEY, issuer TEXT NOT NULL, subject TEXT NOT NULL, UNIQUE(issuer, subject))`,
		`CREATE TABLE plans(id TEXT PRIMARY KEY, kind TEXT NOT NULL, owner_account_id TEXT UNIQUE REFERENCES app_accounts(id))`,
		`CREATE TABLE user_groups(id TEXT PRIMARY KEY, name TEXT NOT NULL, created_by_account_id TEXT NOT NULL REFERENCES app_accounts(id), created_at INTEGER NOT NULL)`,
		`CREATE TABLE group_members(group_id TEXT NOT NULL REFERENCES user_groups(id) ON DELETE CASCADE, account_id TEXT NOT NULL REFERENCES app_accounts(id), role TEXT NOT NULL, joined_at INTEGER NOT NULL, display_name TEXT NOT NULL DEFAULT '', PRIMARY KEY(group_id, account_id))`,
		`CREATE TABLE group_invites(id TEXT PRIMARY KEY, group_id TEXT NOT NULL REFERENCES user_groups(id) ON DELETE CASCADE, code_hash TEXT NOT NULL UNIQUE, created_by_account_id TEXT NOT NULL REFERENCES app_accounts(id), expires_at INTEGER NOT NULL, max_uses INTEGER NOT NULL DEFAULT 1, used_count INTEGER NOT NULL DEFAULT 0, revoked_at INTEGER, created_at INTEGER NOT NULL)`,
		`CREATE TABLE accounts(plan_id TEXT NOT NULL REFERENCES plans(id) ON DELETE CASCADE, id TEXT NOT NULL, position INTEGER NOT NULL, name TEXT NOT NULL, kind TEXT NOT NULL DEFAULT 'cash', min_balance REAL, max_balance REAL, color TEXT, enabled INTEGER NOT NULL, PRIMARY KEY (plan_id, id))`,
		`CREATE TABLE recurrence_rules(plan_id TEXT NOT NULL REFERENCES plans(id) ON DELETE CASCADE, id TEXT NOT NULL, position INTEGER NOT NULL, name TEXT NOT NULL, source_account_id TEXT, destinations TEXT, amount_resolution_json TEXT NOT NULL, frequency TEXT NOT NULL, start_date TEXT NOT NULL, end_date TEXT, annual_cap REAL, priority INTEGER NOT NULL, enabled INTEGER NOT NULL, PRIMARY KEY (plan_id, id))`,
		`CREATE TABLE postings(plan_id TEXT NOT NULL REFERENCES plans(id) ON DELETE CASCADE, id TEXT NOT NULL, position INTEGER NOT NULL, name TEXT NOT NULL, source_account_id TEXT, destinations TEXT, amount_resolution_json TEXT NOT NULL, posted_time INTEGER NOT NULL, transaction_time INTEGER NOT NULL, fulfills_rule_id TEXT, fulfills_occurrence_date TEXT, enabled INTEGER NOT NULL, source TEXT NOT NULL DEFAULT 'user', pending INTEGER NOT NULL DEFAULT 0, void INTEGER NOT NULL DEFAULT 0, execution_order INTEGER NOT NULL DEFAULT 0, receipt_ids TEXT NOT NULL DEFAULT '[]', PRIMARY KEY (plan_id, id))`,
		`CREATE TABLE checkpoints(plan_id TEXT NOT NULL REFERENCES plans(id) ON DELETE CASCADE, id INTEGER NOT NULL, position INTEGER NOT NULL, date TEXT NOT NULL, account_id TEXT NOT NULL, balance REAL NOT NULL, source TEXT NOT NULL DEFAULT 'user', PRIMARY KEY(plan_id, id))`,
		`CREATE TABLE model_metadata(plan_id TEXT NOT NULL REFERENCES plans(id) ON DELETE CASCADE, id INTEGER NOT NULL CHECK (id = 1), source_path TEXT NOT NULL, document_present INTEGER NOT NULL, PRIMARY KEY(plan_id, id))`,
		`CREATE TABLE sync_state(plan_id TEXT NOT NULL REFERENCES plans(id) ON DELETE CASCADE, id INTEGER NOT NULL CHECK (id = 1), last_sync_at TEXT NOT NULL DEFAULT '', PRIMARY KEY(plan_id, id))`,
		`CREATE TABLE sync_credentials(plan_id TEXT NOT NULL REFERENCES plans(id) ON DELETE CASCADE, id INTEGER NOT NULL CHECK (id = 1), access_url TEXT NOT NULL DEFAULT '', bridge_host TEXT NOT NULL DEFAULT '', updated_at TEXT NOT NULL DEFAULT '', cards_json TEXT NOT NULL DEFAULT '[]', PRIMARY KEY(plan_id, id))`,
		`CREATE TABLE amount_presets(plan_id TEXT NOT NULL REFERENCES plans(id) ON DELETE CASCADE, id TEXT NOT NULL, position INTEGER NOT NULL, name TEXT NOT NULL, label TEXT NOT NULL, summary TEXT NOT NULL DEFAULT '', when_use TEXT NOT NULL DEFAULT '', amount_json TEXT NOT NULL, enabled INTEGER NOT NULL, PRIMARY KEY(plan_id, id))`,
	}
	for _, stmt := range statements {
		if _, err := db.Exec(stmt); err != nil {
			t.Fatalf("legacy ddl: %v: %s", err, stmt)
		}
	}
	if _, err := db.Exec(`INSERT INTO app_accounts(id, issuer, subject) VALUES ('user:owner1', 'https://issuer.test', 'owner1')`); err != nil {
		t.Fatal(err)
	}
	if _, err := db.Exec(`INSERT INTO plans(id, kind, owner_account_id) VALUES ('plans/owner1', 'private', 'user:owner1'), ('plans/sample', 'sample', NULL)`); err != nil {
		t.Fatal(err)
	}
	if _, err := db.Exec(`INSERT INTO user_groups(id, name, created_by_account_id, created_at) VALUES ('g1', 'house', 'user:owner1', 1)`); err != nil {
		t.Fatal(err)
	}
	if _, err := db.Exec(`INSERT INTO group_members(group_id, account_id, role, joined_at, display_name) VALUES ('g1', 'user:owner1', 'owner', 1, 'Owner')`); err != nil {
		t.Fatal(err)
	}
	if _, err := db.Exec(`INSERT INTO group_invites(id, group_id, code_hash, created_by_account_id, expires_at, max_uses, used_count, created_at) VALUES ('i1', 'g1', 'hash', 'user:owner1', 2, 1, 0, 1)`); err != nil {
		t.Fatal(err)
	}
	if _, err := db.Exec(`INSERT INTO accounts(plan_id, id, position, name, kind, enabled) VALUES ('plans/owner1', 'checking', 0, 'Checking', 'cash', 1), ('plans/sample', 'checking', 0, 'Sample checking', 'cash', 1)`); err != nil {
		t.Fatal(err)
	}
	if _, err := db.Exec(`INSERT INTO checkpoints(plan_id, id, position, date, account_id, balance, source) VALUES ('plans/owner1', 1, 0, '2026-01-01', 'checking', 100, 'user')`); err != nil {
		t.Fatal(err)
	}
	if _, err := db.Exec(`INSERT INTO postings(plan_id, id, position, name, amount_resolution_json, posted_time, transaction_time, enabled, source) VALUES ('plans/owner1', 'p1', 0, 'Pay', '{}', 0, 0, 1, 'user')`); err != nil {
		t.Fatal(err)
	}
	if _, err := db.Exec(`INSERT INTO model_metadata(plan_id, id, source_path, document_present) VALUES ('plans/owner1', 1, '', 1), ('plans/sample', 1, '', 1)`); err != nil {
		t.Fatal(err)
	}
}

func TestMigratePlansToUsers(t *testing.T) {
	path := filepath.Join(t.TempDir(), "legacy.db")
	createLegacyPlansDatabase(t, path)
	migrated, err := MigratePlansToUsers(path)
	if err != nil {
		t.Fatalf("migrate: %v", err)
	}
	if !migrated {
		t.Fatal("expected migration to run")
	}
	// The deploy path (setupdb) provisions the migrated database.
	d, err := SetupDatabase(path)
	if err != nil {
		t.Fatalf("setup after migrate: %v", err)
	}
	if err := checkExistingSchema(d.SQL()); err != nil {
		t.Fatalf("migrated schema invalid: %v", err)
	}
	var name string
	if err := d.SQL().QueryRow(`SELECT name FROM accounts WHERE user_id='user:owner1'`).Scan(&name); err != nil || name != "Checking" {
		t.Fatalf("private rows: %v", err)
	}
	if err := d.SQL().QueryRow(`SELECT name FROM accounts WHERE user_id='sample'`).Scan(&name); err != nil || name != "Sample checking" {
		t.Fatalf("sample rows: %v", err)
	}
	var balance float64
	if err := d.SQL().QueryRow(`SELECT balance FROM checkpoints WHERE user_id='user:owner1'`).Scan(&balance); err != nil || balance != 100 {
		t.Fatalf("checkpoint: %v", err)
	}
	if err := d.Close(); err != nil {
		t.Fatal(err)
	}
	reopened, err := OpenDatabase(path)
	if err != nil {
		t.Fatalf("open after migrate: %v", err)
	}
	reopened.Close()
	migrated, err = MigratePlansToUsers(path)
	if err != nil || migrated {
		t.Fatalf("idempotent: %v %v", migrated, err)
	}
}

func TestMigratePlansToUsersRejectsUnknownPlanWithoutChanges(t *testing.T) {
	path := filepath.Join(t.TempDir(), "legacy.db")
	createLegacyPlansDatabase(t, path)
	db, err := sql.Open("sqlite", path)
	if err != nil {
		t.Fatal(err)
	}
	if _, err := db.Exec(`INSERT INTO accounts(plan_id, id, position, name, kind, enabled) VALUES ('plans/unknown', 'ghost', 0, 'Ghost', 'cash', 1)`); err != nil {
		t.Fatal(err)
	}
	if err := db.Close(); err != nil {
		t.Fatal(err)
	}
	if migrated, err := MigratePlansToUsers(path); err == nil || migrated {
		t.Fatalf("unknown plan accepted: migrated=%v err=%v", migrated, err)
	}
	check, err := sql.Open("sqlite", path)
	if err != nil {
		t.Fatal(err)
	}
	defer check.Close()
	var marker int
	if err := check.QueryRow(`SELECT COUNT(*) FROM schema_migrations WHERE name = 'shared-plans-v1'`).Scan(&marker); err != nil || marker != 1 {
		t.Fatalf("legacy marker lost: %d %v", marker, err)
	}
	for _, table := range []string{"plans", "app_accounts", "accounts", "user_groups"} {
		var count int
		if err := check.QueryRow(`SELECT COUNT(*) FROM sqlite_master WHERE type='table' AND name=?`, table).Scan(&count); err != nil || count != 1 {
			t.Fatalf("table %s lost: %v", table, err)
		}
	}
	var name string
	if err := check.QueryRow(`SELECT name FROM accounts WHERE plan_id='plans/owner1' AND id='checking'`).Scan(&name); err != nil || name != "Checking" {
		t.Fatalf("data changed: %v", err)
	}
}
