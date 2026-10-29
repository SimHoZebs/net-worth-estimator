package sqlite

import (
	"database/sql"
	"path/filepath"
	"testing"
)

// legacyPlanSchema mirrors the retired plan-scoped DDL for the tables this
// test populates: scope column plan_id with a plans parent, model account
// references sharing the account_id name, and the shared-plans-v1 marker.
func writeLegacyPlanDatabase(t *testing.T, path string) {
	t.Helper()
	db, err := sql.Open("sqlite", path)
	if err != nil {
		t.Fatal(err)
	}
	defer db.Close()
	for _, statement := range []string{
		`CREATE TABLE app_accounts(id TEXT PRIMARY KEY, issuer TEXT NOT NULL, subject TEXT NOT NULL, UNIQUE(issuer, subject))`,
		`CREATE TABLE plans(id TEXT PRIMARY KEY, kind TEXT NOT NULL, owner_account_id TEXT UNIQUE REFERENCES app_accounts(id))`,
		`CREATE TABLE accounts(plan_id TEXT NOT NULL REFERENCES plans(id) ON DELETE CASCADE, id TEXT NOT NULL, position INTEGER NOT NULL, name TEXT NOT NULL, kind TEXT NOT NULL DEFAULT 'cash', min_balance REAL, max_balance REAL, color TEXT, enabled INTEGER NOT NULL, PRIMARY KEY (plan_id, id))`,
		`CREATE TABLE checkpoints(plan_id TEXT NOT NULL REFERENCES plans(id) ON DELETE CASCADE, id INTEGER NOT NULL, position INTEGER NOT NULL, date TEXT NOT NULL, account_id TEXT NOT NULL, balance REAL NOT NULL, source TEXT NOT NULL DEFAULT 'user', PRIMARY KEY(plan_id, id), UNIQUE(plan_id, account_id, date), FOREIGN KEY(plan_id, account_id) REFERENCES accounts(plan_id, id) DEFERRABLE INITIALLY DEFERRED)`,
		`CREATE TABLE postings(plan_id TEXT NOT NULL REFERENCES plans(id) ON DELETE CASCADE, id TEXT NOT NULL, position INTEGER NOT NULL, name TEXT NOT NULL, source_account_id TEXT, destinations TEXT, amount_resolution_json TEXT NOT NULL, posted_time INTEGER NOT NULL, transaction_time INTEGER NOT NULL, fulfills_rule_id TEXT, fulfills_occurrence_date TEXT, enabled INTEGER NOT NULL, source TEXT NOT NULL DEFAULT 'user', pending INTEGER NOT NULL DEFAULT 0, void INTEGER NOT NULL DEFAULT 0, execution_order INTEGER NOT NULL DEFAULT 0, receipt_ids TEXT NOT NULL DEFAULT '[]', PRIMARY KEY (plan_id, id), FOREIGN KEY(plan_id, source_account_id) REFERENCES accounts(plan_id, id) DEFERRABLE INITIALLY DEFERRED)`,
		`CREATE TABLE posting_sync_keys(plan_id TEXT NOT NULL REFERENCES plans(id) ON DELETE CASCADE, provider TEXT NOT NULL, account_id TEXT NOT NULL, transaction_id TEXT NOT NULL, posting_id TEXT NOT NULL, UNIQUE(plan_id, posting_id), FOREIGN KEY(plan_id, posting_id) REFERENCES postings(plan_id, id) ON DELETE CASCADE, PRIMARY KEY (plan_id, provider, account_id, transaction_id))`,
		`CREATE TABLE entity_ids(plan_id TEXT NOT NULL REFERENCES plans(id) ON DELETE CASCADE, id TEXT NOT NULL, kind TEXT NOT NULL, PRIMARY KEY(plan_id, id))`,
		`CREATE TABLE model_metadata(plan_id TEXT NOT NULL REFERENCES plans(id) ON DELETE CASCADE, id INTEGER NOT NULL CHECK (id = 1), source_path TEXT NOT NULL, document_present INTEGER NOT NULL, PRIMARY KEY(plan_id, id))`,
		`CREATE TABLE sync_state(plan_id TEXT NOT NULL REFERENCES plans(id) ON DELETE CASCADE, id INTEGER NOT NULL CHECK (id = 1), last_sync_at TEXT NOT NULL DEFAULT '', PRIMARY KEY(plan_id, id))`,
		`CREATE TABLE amount_presets(plan_id TEXT NOT NULL REFERENCES plans(id) ON DELETE CASCADE, id TEXT NOT NULL, position INTEGER NOT NULL, name TEXT NOT NULL, label TEXT NOT NULL, summary TEXT NOT NULL DEFAULT '', when_use TEXT NOT NULL DEFAULT '', amount_json TEXT NOT NULL, enabled INTEGER NOT NULL, PRIMARY KEY(plan_id, id), UNIQUE(plan_id, name))`,
		`CREATE TABLE schema_migrations(name TEXT PRIMARY KEY)`,
		`INSERT INTO schema_migrations(name) VALUES ('shared-plans-v1')`,
		`INSERT INTO app_accounts(id, issuer, subject) VALUES ('a', 'https://issuer.test', 'a'), ('other', 'https://issuer.test', 'other')`,
		`INSERT INTO plans(id, kind, owner_account_id) VALUES ('plans/a', 'private', 'a'), ('plans/other', 'private', 'other'), ('plans/sample', 'sample', NULL)`,
	} {
		if _, err := db.Exec(statement); err != nil {
			t.Fatalf("legacy ddl: %v", err)
		}
	}
	// Identical entity IDs, preset names, and sync keys in every scope: the
	// isolation gate requires same-file coexistence.
	for _, scope := range []string{"plans/a", "plans/other", "plans/sample"} {
		type seed struct {
			statement string
			args      []any
		}
		for _, item := range []seed{
			{`INSERT INTO accounts(plan_id, id, position, name, kind, enabled) VALUES (?, 'checking', 0, ?, 'cash', 1)`, []any{scope, scope}},
			{`INSERT INTO entity_ids(plan_id, id, kind) VALUES (?, 'checking', 'account')`, []any{scope}},
			{`INSERT INTO checkpoints(plan_id, id, position, date, account_id, balance, source) VALUES (?, 1, 0, '2026-01-01', 'checking', 10, 'user')`, []any{scope}},
			{`INSERT INTO postings(plan_id, id, position, name, destinations, amount_resolution_json, posted_time, transaction_time, enabled) VALUES (?, 'same-posting', 0, ?, 'null', '{}', 1782950400, 1782950400, 1)`, []any{scope, scope}},
			{`INSERT INTO entity_ids(plan_id, id, kind) VALUES (?, 'same-posting', 'posting')`, []any{scope}},
			{`INSERT INTO posting_sync_keys(plan_id, provider, account_id, transaction_id, posting_id) VALUES (?, 'simplefin', 'bridge-checking', 'tx-1', 'same-posting')`, []any{scope}},
			{`INSERT INTO model_metadata(plan_id, id, source_path, document_present) VALUES (?, 1, 'legacy', 1)`, []any{scope}},
			{`INSERT INTO sync_state(plan_id, id, last_sync_at) VALUES (?, 1, '')`, []any{scope}},
			{`INSERT INTO amount_presets(plan_id, id, position, name, label, amount_json, enabled) VALUES (?, 'preset-1', 0, 'same-recipe', 'Same recipe', '{}', 1)`, []any{scope}},
		} {
			if _, err := db.Exec(item.statement, item.args...); err != nil {
				t.Fatalf("legacy seed %s: %v", scope, err)
			}
		}
	}
}

func TestSetupMigratesPlanScopeToAccountScope(t *testing.T) {
	path := filepath.Join(t.TempDir(), "legacy.db")
	writeLegacyPlanDatabase(t, path)
	d, err := SetupDatabase(path)
	if err != nil {
		t.Fatal(err)
	}
	defer d.Close()
	var plansTable int
	if err := d.SQL().QueryRow(`SELECT COUNT(*) FROM sqlite_master WHERE type='table' AND name='plans'`).Scan(&plansTable); err != nil || plansTable != 0 {
		t.Fatalf("plans table = %d, %v", plansTable, err)
	}
	for _, marker := range []struct {
		name string
		want int
	}{{"shared-plans-v1", 0}, {"shared-accounts-v1", 1}} {
		var count int
		if err := d.SQL().QueryRow(`SELECT COUNT(*) FROM schema_migrations WHERE name=?`, marker.name).Scan(&count); err != nil || count != marker.want {
			t.Fatalf("marker %s = %d, %v, want %d", marker.name, count, err, marker.want)
		}
	}
	// Backfill keeps the owner: plans/a belonged to app account a.
	for _, scope := range []string{"a", "other", "sample"} {
		var accounts, checkpoints, postings, keys, presets int
		for _, check := range []struct {
			sql  string
			into *int
		}{
			{`SELECT COUNT(*) FROM accounts WHERE account_id=? AND id='checking'`, &accounts},
			{`SELECT COUNT(*) FROM checkpoints WHERE account_id=? AND model_account_id='checking'`, &checkpoints},
			{`SELECT COUNT(*) FROM postings WHERE account_id=? AND id='same-posting'`, &postings},
			{`SELECT COUNT(*) FROM posting_sync_keys WHERE account_id=? AND bridge_account_id='bridge-checking'`, &keys},
			{`SELECT COUNT(*) FROM amount_presets WHERE account_id=? AND name='same-recipe'`, &presets},
		} {
			if err := d.SQL().QueryRow(check.sql, scope).Scan(check.into); err != nil || *check.into != 1 {
				t.Fatalf("%s scope %s = %d, %v", check.sql, scope, *check.into, err)
			}
		}
		var document int
		if err := d.SQL().QueryRow(`SELECT document_present FROM model_metadata WHERE account_id=? AND id=1`, scope).Scan(&document); err != nil || document != 1 {
			t.Fatalf("document scope %s = %d, %v", scope, document, err)
		}
		store, err := d.Account(scope)
		if err != nil {
			t.Fatalf("open %s: %v", scope, err)
		}
		documentLoaded, err := store.LoadDocument()
		if err != nil || documentLoaded == nil || len(documentLoaded.Accounts) != 1 {
			t.Fatalf("load %s = %+v, %v", scope, documentLoaded, err)
		}
	}
	// Legacy plan IDs resolve to their owner's account scope.
	for plan, want := range map[string]string{"plans/a": "a", "plans/other": "other", "plans/sample": "sample"} {
		store, err := d.Plan(plan)
		if err != nil {
			t.Fatalf("legacy %s: %v", plan, err)
		}
		document, err := store.LoadDocument()
		if err != nil || document == nil || len(document.Accounts) != 1 {
			t.Fatalf("legacy load %s = %+v, %v", plan, document, err)
		}
		_ = want
	}
	if err := checkExistingSchema(d.SQL()); err != nil {
		t.Fatalf("migrated schema invalid: %v", err)
	}
	if reopened, err := OpenDatabase(path); err != nil {
		t.Fatalf("reopen migrated: %v", err)
	} else {
		reopened.Close()
	}
}
