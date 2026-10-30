package sqlite

import (
	"database/sql"
	"fmt"
	"path/filepath"
	"strings"
)

// TEMPORARY (remove after production is migrated and verified):
// MigratePlansToUsers performs the one-time shared-plans-v1 (plan-scoped
// rows under plans/<hash>, plans/sample, plans/fixture with identities in
// app_accounts) to shared-accounts-v1 (user_id referencing users) migration
// in place. Called only by explicit deploy-time provisioning (setupdb and
// the migrate-plans-to-users command), never by the server runtime, which
// keeps rejecting legacy databases.
//
// Mapping:
//   - app_accounts rows copy verbatim to users (same id "user:<hash>").
//   - private plan "plans/<hash>" owned by "user:<hash>" becomes user_id
//     "user:<hash>" (owner_account_id).
//   - "plans/sample" becomes the legacy historical user row "sample";
//     "plans/fixture" becomes the legacy historical user row "fixture" when
//     present. These raw IDs stay recoverable offline and are never created
//     by current provisioning.
//   - group tables rename account columns to user columns (values already match).
//   - checkpoints.account_id -> model_account_id,
//     posting_sync_keys.account_id -> bridge_account_id,
//     payment_terms.account_id -> model_account_id.
//
// Idempotent: a database already carrying shared-accounts-v1 is a no-op
// returning migrated=false. Incomplete legacy databases fail without partial
// changes: every mutation runs in one transaction and verification
// (marker, legacy-table absence, foreign_key_check) runs before commit.
func MigratePlansToUsers(path string) (bool, error) {
	abs, err := filepath.Abs(path)
	if err != nil {
		return false, err
	}
	db, err := sql.Open("sqlite", "file:"+abs+"?mode=rw&_pragma=busy_timeout(5000)&_pragma=foreign_keys(0)")
	if err != nil {
		return false, err
	}
	defer db.Close()
	if err := db.Ping(); err != nil {
		return false, err
	}
	tx, err := db.Begin()
	if err != nil {
		return false, err
	}
	defer tx.Rollback()
	var newCount int
	if err := tx.QueryRow(`SELECT COUNT(*) FROM schema_migrations WHERE name = ?`, sharedSchemaVersion).Scan(&newCount); err == nil && newCount == 1 {
		if err := tx.Commit(); err != nil {
			return false, err
		}
		return false, nil
	}
	// No marker table or no legacy marker: nothing to migrate (fresh,
	// current, or foreign database). SetupDatabase validates afterwards.
	var markerTable int
	if err := tx.QueryRow(`SELECT COUNT(*) FROM sqlite_master WHERE type = 'table' AND name = 'schema_migrations'`).Scan(&markerTable); err != nil || markerTable != 1 {
		if err := tx.Commit(); err != nil {
			return false, err
		}
		return false, nil
	}
	var oldCount int
	if err := tx.QueryRow(`SELECT COUNT(*) FROM schema_migrations WHERE name = ?`, legacyPlansSchemaVersion).Scan(&oldCount); err != nil || oldCount != 1 {
		if err := tx.Commit(); err != nil {
			return false, err
		}
		return false, nil
	}
	migrated, err := migratePlansToUsersTx(tx)
	if err != nil {
		return false, err
	}
	if !migrated {
		if err := tx.Commit(); err != nil {
			return false, err
		}
		return false, nil
	}
	// Verify before commit so a mapping bug rolls back instead of
	// committing an unverifiable state.
	var check int
	if err := tx.QueryRow(`SELECT COUNT(*) FROM schema_migrations WHERE name = ?`, sharedSchemaVersion).Scan(&check); err != nil || check != 1 {
		return false, fmt.Errorf("migration verification failed: new marker missing")
	}
	if err := tx.QueryRow(`SELECT COUNT(*) FROM sqlite_master WHERE type='table' AND name IN ('plans','app_accounts')`).Scan(&check); err != nil || check != 0 {
		return false, fmt.Errorf("migration verification failed: legacy tables remain")
	}
	fkRows, err := tx.Query(`PRAGMA foreign_key_check`)
	if err != nil {
		return false, err
	}
	defer fkRows.Close()
	if fkRows.Next() {
		return false, fmt.Errorf("migration verification failed: foreign key violations remain")
	}
	if err := fkRows.Err(); err != nil {
		return false, err
	}
	if err := tx.Commit(); err != nil {
		return false, err
	}
	return true, nil
}

func migratePlansToUsersTx(tx *sql.Tx) (bool, error) {
	for _, table := range []string{"app_accounts", "plans"} {
		var count int
		if err := tx.QueryRow(`SELECT COUNT(*) FROM sqlite_master WHERE type = 'table' AND name = ?`, table).Scan(&count); err != nil || count != 1 {
			return false, fmt.Errorf("incomplete legacy database: missing %s: %w", table, ErrLegacyDatabase)
		}
	}

	type planRow struct {
		id    string
		kind  string
		owner sql.NullString
	}
	rows, err := tx.Query(`SELECT id, kind, owner_account_id FROM plans`)
	if err != nil {
		return false, err
	}
	planToUser := map[string]string{}
	for rows.Next() {
		var p planRow
		if err := rows.Scan(&p.id, &p.kind, &p.owner); err != nil {
			rows.Close()
			return false, err
		}
		switch p.kind {
		case "private":
			if !p.owner.Valid || p.owner.String == "" {
				rows.Close()
				return false, fmt.Errorf("private plan %s without owner: %w", p.id, ErrLegacyDatabase)
			}
			planToUser[p.id] = p.owner.String
		case "sample":
			planToUser["plans/sample"] = legacySampleUserID
		case "fixture":
			planToUser["plans/fixture"] = legacyFixtureUserID
		default:
			rows.Close()
			return false, fmt.Errorf("unknown plan kind %s: %w", p.kind, ErrLegacyDatabase)
		}
	}
	if err := rows.Err(); err != nil {
		rows.Close()
		return false, err
	}
	rows.Close()

	for _, table := range []string{"accounts", "checkpoints", "postings", "posting_sync_keys", "posting_id_migrations", "purchase_policies", "recurrence_rules", "evaluations", "projection_artifacts", "model_metadata", "payment_terms", "entity_ids", "account_links", "pinned_evaluations", "safe_spending_settings", "sync_state", "sync_credentials", "amount_presets", "receipts"} {
		if !migrationTableExists(tx, table) {
			continue
		}
		scopeRows, err := tx.Query(fmt.Sprintf(`SELECT DISTINCT plan_id FROM %s`, table))
		if err != nil {
			return false, fmt.Errorf("read %s scopes: %w", table, err)
		}
		var bad string
		for scopeRows.Next() {
			var scope string
			if err := scopeRows.Scan(&scope); err != nil {
				scopeRows.Close()
				return false, err
			}
			if _, ok := planToUser[scope]; !ok {
				bad = scope
			}
		}
		if err := scopeRows.Err(); err != nil {
			scopeRows.Close()
			return false, err
		}
		scopeRows.Close()
		if bad != "" {
			return false, fmt.Errorf("table %s references unknown plan %s: %w", table, bad, ErrLegacyDatabase)
		}
	}

	if _, err := tx.Exec(`CREATE TABLE IF NOT EXISTS users (id TEXT PRIMARY KEY, issuer TEXT NOT NULL, subject TEXT NOT NULL, UNIQUE(issuer, subject))`); err != nil {
		return false, err
	}
	if _, err := tx.Exec(`INSERT OR IGNORE INTO users(id, issuer, subject) SELECT id, issuer, subject FROM app_accounts`); err != nil {
		return false, err
	}
	if _, ok := planToUser["plans/sample"]; ok {
		if _, err := tx.Exec(`INSERT OR IGNORE INTO users(id, issuer, subject) VALUES (?, ?, ?)`, legacySampleUserID, legacySampleUserID, legacySampleUserID); err != nil {
			return false, err
		}
	}
	if _, ok := planToUser["plans/fixture"]; ok {
		if _, err := tx.Exec(`INSERT OR IGNORE INTO users(id, issuer, subject) VALUES (?, ?, ?)`, legacyFixtureUserID, legacyFixtureUserID, legacyFixtureUserID); err != nil {
			return false, err
		}
	}

	if err := rebuildGroupsForUsers(tx); err != nil {
		return false, err
	}
	caseExpr := userIDCaseExpression(planToUser)
	if migrationHasColumn(tx, "receipts", "image") {
		if err := migrateInlinePlansReceipts(tx); err != nil {
			return false, err
		}
	}
	if err := rebuildFinancialForUsers(tx, caseExpr); err != nil {
		return false, err
	}
	if migrationTableExists(tx, "receipts") && !migrationHasColumn(tx, "receipts", "image") {
		if err := rebuildPlansReceipts(tx, caseExpr); err != nil {
			return false, err
		}
	}
	if _, err := tx.Exec(`DROP TABLE IF EXISTS plans`); err != nil {
		return false, err
	}
	if _, err := tx.Exec(`DROP TABLE IF EXISTS app_accounts`); err != nil {
		return false, err
	}
	if _, err := tx.Exec(`DELETE FROM schema_migrations WHERE name = ?`, legacyPlansSchemaVersion); err != nil {
		return false, err
	}
	if _, err := tx.Exec(`INSERT OR IGNORE INTO schema_migrations(name) VALUES (?)`, sharedSchemaVersion); err != nil {
		return false, err
	}
	return true, nil
}

const legacyPlansSchemaVersion = "shared-plans-v1"

// legacySampleUserID and legacyFixtureUserID are private historical row IDs
// retained only for the one-time plans-to-users migration. Current code must
// not provision or reference them through an exported API.
const (
	legacySampleUserID  = "sample"
	legacyFixtureUserID = "fixture"
)

func migrationTableExists(tx *sql.Tx, name string) bool {
	var count int
	if err := tx.QueryRow(`SELECT COUNT(*) FROM sqlite_master WHERE type = 'table' AND name = ?`, name).Scan(&count); err != nil {
		return false
	}
	return count == 1
}

func migrationHasColumn(tx *sql.Tx, table, column string) bool {
	rows, err := tx.Query(fmt.Sprintf(`PRAGMA table_info(%s)`, table))
	if err != nil {
		return false
	}
	defer rows.Close()
	for rows.Next() {
		var cid, notnull, pk int
		var name, kind string
		var def any
		if err := rows.Scan(&cid, &name, &kind, &notnull, &def, &pk); err != nil {
			return false
		}
		if name == column {
			return true
		}
	}
	return false
}

// userIDCaseExpression maps legacy plan_id values to user IDs. Every scope
// is validated against the plans table before copying, so the ELSE branch
// only serves private plans already present in the map.
func userIDCaseExpression(planToUser map[string]string) string {
	var b strings.Builder
	b.WriteString("CASE plan_id ")
	for plan, user := range planToUser {
		fmt.Fprintf(&b, "WHEN '%s' THEN '%s' ", strings.ReplaceAll(plan, "'", "''"), strings.ReplaceAll(user, "'", "''"))
	}
	b.WriteString("ELSE (SELECT owner_account_id FROM plans WHERE plans.id = plan_id) END")
	return b.String()
}

func migrateInlinePlansReceipts(tx *sql.Tx) error {
	if _, err := tx.Exec(`ALTER TABLE receipts RENAME TO receipts_inline`); err != nil {
		return err
	}
	if _, err := tx.Exec(receiptSchema); err != nil {
		return err
	}
	rows, err := tx.Query(`SELECT plan_id, id FROM receipts_inline`)
	if err != nil {
		return err
	}
	type identity struct{ plan, id string }
	var identities []identity
	for rows.Next() {
		var id identity
		if err := rows.Scan(&id.plan, &id.id); err != nil {
			rows.Close()
			return err
		}
		identities = append(identities, id)
	}
	if err := rows.Err(); err != nil {
		rows.Close()
		return err
	}
	rows.Close()
	for _, id := range identities {
		var userID string
		switch id.plan {
		case "plans/sample":
			userID = legacySampleUserID
		case "plans/fixture":
			userID = legacyFixtureUserID
		default:
			var owner sql.NullString
			if err := tx.QueryRow(`SELECT owner_account_id FROM plans WHERE id = ?`, id.plan).Scan(&owner); err != nil || !owner.Valid {
				return fmt.Errorf("inline receipt references unknown plan %s: %w", id.plan, ErrLegacyDatabase)
			}
			userID = owner.String
		}
		key, err := newRowID()
		if err != nil {
			return err
		}
		if _, err := tx.Exec(`INSERT INTO blob_objects(key,state,expires_at) VALUES (?,'live',0)`, key); err != nil {
			return err
		}
		if _, err := tx.Exec(`INSERT INTO blob_data(key,data) SELECT ?,image FROM receipts_inline WHERE plan_id=? AND id=?`, key, id.plan, id.id); err != nil {
			return err
		}
		if _, err := tx.Exec(`INSERT INTO receipts(user_id,id,posting_id,digest,size,blob_key,revision,payload) SELECT ?,id,posting_id,digest,size,?,revision,payload FROM receipts_inline WHERE plan_id=? AND id=?`, userID, key, id.plan, id.id); err != nil {
			return err
		}
	}
	_, err = tx.Exec(`DROP TABLE receipts_inline`)
	return err
}

func rebuildGroupsForUsers(tx *sql.Tx) error {
	for _, table := range []string{"user_groups", "group_members", "group_invites"} {
		if !migrationTableExists(tx, table) {
			return fmt.Errorf("incomplete legacy database: missing %s: %w", table, ErrLegacyDatabase)
		}
	}
	if _, err := tx.Exec(`CREATE TABLE IF NOT EXISTS user_groups_new (id TEXT PRIMARY KEY, name TEXT NOT NULL, created_by_user_id TEXT NOT NULL REFERENCES users(id), created_at INTEGER NOT NULL)`); err != nil {
		return err
	}
	if _, err := tx.Exec(`INSERT OR IGNORE INTO user_groups_new(id, name, created_by_user_id, created_at) SELECT id, name, created_by_account_id, created_at FROM user_groups`); err != nil {
		return fmt.Errorf("migrate user_groups: %w", err)
	}
	if _, err := tx.Exec(`DROP TABLE user_groups`); err != nil {
		return err
	}
	if _, err := tx.Exec(`ALTER TABLE user_groups_new RENAME TO user_groups`); err != nil {
		return err
	}
	if _, err := tx.Exec(`CREATE TABLE IF NOT EXISTS group_members_new (group_id TEXT NOT NULL REFERENCES user_groups(id) ON DELETE CASCADE, user_id TEXT NOT NULL REFERENCES users(id), role TEXT NOT NULL CHECK (role IN ('owner', 'admin', 'member')), joined_at INTEGER NOT NULL, display_name TEXT NOT NULL DEFAULT '', PRIMARY KEY(group_id, user_id))`); err != nil {
		return err
	}
	if _, err := tx.Exec(`INSERT OR IGNORE INTO group_members_new(group_id, user_id, role, joined_at, display_name) SELECT group_id, account_id, role, joined_at, display_name FROM group_members`); err != nil {
		return fmt.Errorf("migrate group_members: %w", err)
	}
	if _, err := tx.Exec(`DROP TABLE group_members`); err != nil {
		return err
	}
	if _, err := tx.Exec(`ALTER TABLE group_members_new RENAME TO group_members`); err != nil {
		return err
	}
	if _, err := tx.Exec(`CREATE INDEX IF NOT EXISTS group_members_account ON group_members(user_id, group_id)`); err != nil {
		return err
	}
	if _, err := tx.Exec(`CREATE TABLE IF NOT EXISTS group_invites_new (id TEXT PRIMARY KEY, group_id TEXT NOT NULL REFERENCES user_groups(id) ON DELETE CASCADE, code_hash TEXT NOT NULL UNIQUE, created_by_user_id TEXT NOT NULL REFERENCES users(id), expires_at INTEGER NOT NULL, max_uses INTEGER NOT NULL DEFAULT 1 CHECK (max_uses >= 1), used_count INTEGER NOT NULL DEFAULT 0 CHECK (used_count >= 0), revoked_at INTEGER, created_at INTEGER NOT NULL)`); err != nil {
		return err
	}
	if _, err := tx.Exec(`INSERT OR IGNORE INTO group_invites_new(id, group_id, code_hash, created_by_user_id, expires_at, max_uses, used_count, revoked_at, created_at) SELECT id, group_id, code_hash, created_by_account_id, expires_at, max_uses, used_count, revoked_at, created_at FROM group_invites`); err != nil {
		return fmt.Errorf("migrate group_invites: %w", err)
	}
	if _, err := tx.Exec(`DROP TABLE group_invites`); err != nil {
		return err
	}
	if _, err := tx.Exec(`ALTER TABLE group_invites_new RENAME TO group_invites`); err != nil {
		return err
	}
	return nil
}

// plansFinancialSteps mirrors schema.go. Keep every CREATE identical to the
// current schema (only the table name gains a _new suffix) so migrated
// databases never diverge from fresh ones; SetupDatabase uses CREATE TABLE
// IF NOT EXISTS and column-only validation and would never repair drift.
func plansFinancialSteps(caseExpr string) []struct {
	create, insert, drop, rename, old string
} {
	return []struct{ create, insert, drop, rename, old string }{
		{`CREATE TABLE IF NOT EXISTS accounts_new (user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE, id TEXT NOT NULL, position INTEGER NOT NULL, name TEXT NOT NULL, kind TEXT NOT NULL DEFAULT 'cash', min_balance REAL, max_balance REAL, color TEXT, enabled INTEGER NOT NULL, PRIMARY KEY (user_id, id))`, `INSERT INTO accounts_new(user_id, id, position, name, kind, min_balance, max_balance, color, enabled) SELECT ` + caseExpr + `, id, position, name, kind, min_balance, max_balance, color, enabled FROM accounts`, `DROP TABLE accounts`, `ALTER TABLE accounts_new RENAME TO accounts`, "accounts"},
		{`CREATE TABLE IF NOT EXISTS recurrence_rules_new (user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE, id TEXT NOT NULL, position INTEGER NOT NULL, name TEXT NOT NULL, source_account_id TEXT, destinations TEXT, amount_resolution_json TEXT NOT NULL, frequency TEXT NOT NULL, start_date TEXT NOT NULL, end_date TEXT, annual_cap REAL, priority INTEGER NOT NULL, enabled INTEGER NOT NULL, PRIMARY KEY (user_id, id), FOREIGN KEY(user_id, source_account_id) REFERENCES accounts(user_id, id) DEFERRABLE INITIALLY DEFERRED)`, `INSERT INTO recurrence_rules_new(user_id, id, position, name, source_account_id, destinations, amount_resolution_json, frequency, start_date, end_date, annual_cap, priority, enabled) SELECT ` + caseExpr + `, id, position, name, source_account_id, destinations, amount_resolution_json, frequency, start_date, end_date, annual_cap, priority, enabled FROM recurrence_rules`, `DROP TABLE recurrence_rules`, `ALTER TABLE recurrence_rules_new RENAME TO recurrence_rules`, "recurrence_rules"},
		{`CREATE TABLE IF NOT EXISTS postings_new (user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE, id TEXT NOT NULL, position INTEGER NOT NULL, name TEXT NOT NULL, source_account_id TEXT, destinations TEXT, amount_resolution_json TEXT NOT NULL, posted_time INTEGER NOT NULL, transaction_time INTEGER NOT NULL, fulfills_rule_id TEXT, fulfills_occurrence_date TEXT, enabled INTEGER NOT NULL, source TEXT NOT NULL DEFAULT 'user', pending INTEGER NOT NULL DEFAULT 0 CHECK (pending IN (0, 1)), void INTEGER NOT NULL DEFAULT 0 CHECK (void IN (0, 1)), execution_order INTEGER NOT NULL DEFAULT 0 CHECK (execution_order >= 0), receipt_ids TEXT NOT NULL DEFAULT '[]', PRIMARY KEY (user_id, id), FOREIGN KEY(user_id, source_account_id) REFERENCES accounts(user_id, id) DEFERRABLE INITIALLY DEFERRED, FOREIGN KEY(user_id, fulfills_rule_id) REFERENCES recurrence_rules(user_id, id) DEFERRABLE INITIALLY DEFERRED)`, `INSERT INTO postings_new(user_id, id, position, name, source_account_id, destinations, amount_resolution_json, posted_time, transaction_time, fulfills_rule_id, fulfills_occurrence_date, enabled, source, pending, void, execution_order, receipt_ids) SELECT ` + caseExpr + `, id, position, name, source_account_id, destinations, amount_resolution_json, posted_time, transaction_time, fulfills_rule_id, fulfills_occurrence_date, enabled, source, pending, void, execution_order, receipt_ids FROM postings`, `DROP TABLE postings`, `ALTER TABLE postings_new RENAME TO postings`, "postings"},
		{`CREATE TABLE IF NOT EXISTS checkpoints_new (user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE, id INTEGER NOT NULL, position INTEGER NOT NULL, date TEXT NOT NULL, model_account_id TEXT NOT NULL, balance REAL NOT NULL, source TEXT NOT NULL DEFAULT 'user', PRIMARY KEY(user_id, id), UNIQUE(user_id, model_account_id, date), FOREIGN KEY(user_id, model_account_id) REFERENCES accounts(user_id, id) DEFERRABLE INITIALLY DEFERRED)`, `INSERT INTO checkpoints_new(user_id, id, position, date, model_account_id, balance, source) SELECT ` + caseExpr + `, id, position, date, account_id, balance, source FROM checkpoints`, `DROP TABLE checkpoints`, `ALTER TABLE checkpoints_new RENAME TO checkpoints`, "checkpoints"},
		{`CREATE TABLE IF NOT EXISTS posting_sync_keys_new (user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE, provider TEXT NOT NULL, bridge_account_id TEXT NOT NULL, transaction_id TEXT NOT NULL, posting_id TEXT NOT NULL, UNIQUE(user_id, posting_id), FOREIGN KEY(user_id, posting_id) REFERENCES postings(user_id, id) ON DELETE CASCADE, PRIMARY KEY (user_id, provider, bridge_account_id, transaction_id))`, `INSERT INTO posting_sync_keys_new(user_id, provider, bridge_account_id, transaction_id, posting_id) SELECT ` + caseExpr + `, provider, account_id, transaction_id, posting_id FROM posting_sync_keys`, `DROP TABLE posting_sync_keys`, `ALTER TABLE posting_sync_keys_new RENAME TO posting_sync_keys`, "posting_sync_keys"},
		{`CREATE TABLE IF NOT EXISTS posting_id_migrations_new (user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE, old_id TEXT NOT NULL, new_id TEXT NOT NULL, PRIMARY KEY(user_id, old_id), UNIQUE(user_id, new_id))`, `INSERT INTO posting_id_migrations_new(user_id, old_id, new_id) SELECT ` + caseExpr + `, old_id, new_id FROM posting_id_migrations`, `DROP TABLE posting_id_migrations`, `ALTER TABLE posting_id_migrations_new RENAME TO posting_id_migrations`, "posting_id_migrations"},
		{`CREATE TABLE IF NOT EXISTS purchase_policies_new (user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE, posting_id TEXT NOT NULL, priority INTEGER NOT NULL CHECK (priority >= 0), PRIMARY KEY(user_id, posting_id), FOREIGN KEY(user_id, posting_id) REFERENCES postings(user_id, id) ON DELETE CASCADE)`, `INSERT INTO purchase_policies_new(user_id, posting_id, priority) SELECT ` + caseExpr + `, posting_id, priority FROM purchase_policies`, `DROP TABLE purchase_policies`, `ALTER TABLE purchase_policies_new RENAME TO purchase_policies`, "purchase_policies"},
		{`CREATE TABLE IF NOT EXISTS evaluations_new (user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE, type TEXT NOT NULL, instance_id TEXT NOT NULL, position INTEGER NOT NULL, name TEXT NOT NULL, enabled INTEGER NOT NULL, config_json TEXT NOT NULL, PRIMARY KEY (user_id, type, instance_id), UNIQUE(user_id, instance_id))`, `INSERT INTO evaluations_new(user_id, type, instance_id, position, name, enabled, config_json) SELECT ` + caseExpr + `, type, instance_id, position, name, enabled, config_json FROM evaluations`, `DROP TABLE evaluations`, `ALTER TABLE evaluations_new RENAME TO evaluations`, "evaluations"},
		{`CREATE TABLE IF NOT EXISTS projection_artifacts_new (user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE, identity TEXT NOT NULL, kind TEXT NOT NULL, created_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now')), payload TEXT NOT NULL, PRIMARY KEY(user_id, identity))`, `INSERT INTO projection_artifacts_new(user_id, identity, kind, created_at, payload) SELECT ` + caseExpr + `, identity, kind, created_at, payload FROM projection_artifacts`, `DROP TABLE projection_artifacts`, `ALTER TABLE projection_artifacts_new RENAME TO projection_artifacts`, "projection_artifacts"},
		{`CREATE TABLE IF NOT EXISTS model_metadata_new (user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE, id INTEGER NOT NULL CHECK (id = 1), source_path TEXT NOT NULL, document_present INTEGER NOT NULL CHECK (document_present IN (0, 1)), PRIMARY KEY(user_id, id))`, `INSERT INTO model_metadata_new(user_id, id, source_path, document_present) SELECT ` + caseExpr + `, id, source_path, document_present FROM model_metadata`, `DROP TABLE model_metadata`, `ALTER TABLE model_metadata_new RENAME TO model_metadata`, "model_metadata"},
		{`CREATE TABLE IF NOT EXISTS payment_terms_new (user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE, model_account_id TEXT NOT NULL, position INTEGER NOT NULL, minimum_fixed REAL NOT NULL, minimum_percent REAL, due_day INTEGER NOT NULL, statement_day INTEGER, PRIMARY KEY(user_id, model_account_id), FOREIGN KEY(user_id, model_account_id) REFERENCES accounts(user_id, id) DEFERRABLE INITIALLY DEFERRED)`, `INSERT INTO payment_terms_new(user_id, model_account_id, position, minimum_fixed, minimum_percent, due_day, statement_day) SELECT ` + caseExpr + `, account_id, position, minimum_fixed, minimum_percent, due_day, statement_day FROM payment_terms`, `DROP TABLE payment_terms`, `ALTER TABLE payment_terms_new RENAME TO payment_terms`, "payment_terms"},
		{`CREATE TABLE IF NOT EXISTS entity_ids_new (user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE, id TEXT NOT NULL, kind TEXT NOT NULL, PRIMARY KEY(user_id, id))`, `INSERT INTO entity_ids_new(user_id, id, kind) SELECT ` + caseExpr + `, id, kind FROM entity_ids`, `DROP TABLE entity_ids`, `ALTER TABLE entity_ids_new RENAME TO entity_ids`, "entity_ids"},
		{`CREATE TABLE IF NOT EXISTS account_links_new (user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE, bridge_account_id TEXT NOT NULL, model_account_id TEXT NOT NULL, bridge_name TEXT NOT NULL DEFAULT '', currency TEXT NOT NULL DEFAULT '', origin TEXT NOT NULL DEFAULT 'manual', last_seen_at TEXT NOT NULL DEFAULT '', PRIMARY KEY(user_id, bridge_account_id), UNIQUE(user_id, model_account_id))`, `INSERT INTO account_links_new(user_id, bridge_account_id, model_account_id, bridge_name, currency, origin, last_seen_at) SELECT ` + caseExpr + `, bridge_account_id, model_account_id, bridge_name, currency, origin, last_seen_at FROM account_links`, `DROP TABLE account_links`, `ALTER TABLE account_links_new RENAME TO account_links`, "account_links"},
		{`CREATE TABLE IF NOT EXISTS pinned_evaluations_new (user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE, instance_id TEXT NOT NULL, position INTEGER NOT NULL, PRIMARY KEY(user_id, instance_id), FOREIGN KEY(user_id, instance_id) REFERENCES evaluations(user_id, instance_id) ON DELETE CASCADE)`, `INSERT INTO pinned_evaluations_new(user_id, instance_id, position) SELECT ` + caseExpr + `, instance_id, position FROM pinned_evaluations`, `DROP TABLE pinned_evaluations`, `ALTER TABLE pinned_evaluations_new RENAME TO pinned_evaluations`, "pinned_evaluations"},
		{`CREATE TABLE IF NOT EXISTS safe_spending_settings_new (user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE, id INTEGER NOT NULL CHECK (id = 1), settings_json TEXT NOT NULL, PRIMARY KEY (user_id, id))`, `INSERT INTO safe_spending_settings_new(user_id, id, settings_json) SELECT ` + caseExpr + `, id, settings_json FROM safe_spending_settings`, `DROP TABLE safe_spending_settings`, `ALTER TABLE safe_spending_settings_new RENAME TO safe_spending_settings`, "safe_spending_settings"},
		{`CREATE TABLE IF NOT EXISTS sync_state_new (user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE, id INTEGER NOT NULL CHECK (id = 1), last_sync_at TEXT NOT NULL DEFAULT '', PRIMARY KEY(user_id, id))`, `INSERT INTO sync_state_new(user_id, id, last_sync_at) SELECT ` + caseExpr + `, id, last_sync_at FROM sync_state`, `DROP TABLE sync_state`, `ALTER TABLE sync_state_new RENAME TO sync_state`, "sync_state"},
		{`CREATE TABLE IF NOT EXISTS sync_credentials_new (user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE, id INTEGER NOT NULL CHECK (id = 1), access_url TEXT NOT NULL DEFAULT '', bridge_host TEXT NOT NULL DEFAULT '', updated_at TEXT NOT NULL DEFAULT '', cards_json TEXT NOT NULL DEFAULT '[]', PRIMARY KEY(user_id, id))`, `INSERT INTO sync_credentials_new(user_id, id, access_url, bridge_host, updated_at, cards_json) SELECT ` + caseExpr + `, id, access_url, bridge_host, updated_at, cards_json FROM sync_credentials`, `DROP TABLE sync_credentials`, `ALTER TABLE sync_credentials_new RENAME TO sync_credentials`, "sync_credentials"},
		{`CREATE TABLE IF NOT EXISTS amount_presets_new (user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE, id TEXT NOT NULL, position INTEGER NOT NULL, name TEXT NOT NULL, label TEXT NOT NULL, summary TEXT NOT NULL DEFAULT '', when_use TEXT NOT NULL DEFAULT '', amount_json TEXT NOT NULL, enabled INTEGER NOT NULL, PRIMARY KEY(user_id, id), UNIQUE(user_id, name))`, `INSERT INTO amount_presets_new(user_id, id, position, name, label, summary, when_use, amount_json, enabled) SELECT ` + caseExpr + `, id, position, name, label, summary, when_use, amount_json, enabled FROM amount_presets`, `DROP TABLE amount_presets`, `ALTER TABLE amount_presets_new RENAME TO amount_presets`, "amount_presets"},
	}
}

func rebuildFinancialForUsers(tx *sql.Tx, caseExpr string) error {
	for _, s := range plansFinancialSteps(caseExpr) {
		if !migrationTableExists(tx, s.old) {
			empty := strings.Replace(s.create, s.old+"_new", s.old, 1)
			if _, err := tx.Exec(empty); err != nil {
				return fmt.Errorf("migrate create empty %s: %w", s.old, err)
			}
			continue
		}
		if _, err := tx.Exec(s.create); err != nil {
			return fmt.Errorf("migrate create %s: %w", s.old, err)
		}
		if _, err := tx.Exec(s.insert); err != nil {
			return fmt.Errorf("migrate copy %s: %w", s.old, err)
		}
		if _, err := tx.Exec(s.drop); err != nil {
			return fmt.Errorf("migrate drop %s: %w", s.old, err)
		}
		if _, err := tx.Exec(s.rename); err != nil {
			return fmt.Errorf("migrate rename %s: %w", s.old, err)
		}
	}
	return nil
}

func rebuildPlansReceipts(tx *sql.Tx, caseExpr string) error {
	if _, err := tx.Exec(`CREATE TABLE IF NOT EXISTS receipts_new (user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE, id TEXT NOT NULL, posting_id TEXT NOT NULL, digest TEXT NOT NULL, size INTEGER NOT NULL CHECK(size > 0), blob_key TEXT NOT NULL REFERENCES blob_objects(key), revision INTEGER NOT NULL, payload TEXT NOT NULL, PRIMARY KEY(user_id, id), UNIQUE(user_id, posting_id, digest), FOREIGN KEY(user_id, posting_id) REFERENCES postings(user_id, id) ON DELETE CASCADE)`); err != nil {
		return err
	}
	if _, err := tx.Exec(`INSERT INTO receipts_new(user_id, id, posting_id, digest, size, blob_key, revision, payload) SELECT ` + caseExpr + `, id, posting_id, digest, size, blob_key, revision, payload FROM receipts`); err != nil {
		return fmt.Errorf("migrate receipts: %w", err)
	}
	if _, err := tx.Exec(`DROP TABLE receipts`); err != nil {
		return err
	}
	if _, err := tx.Exec(`ALTER TABLE receipts_new RENAME TO receipts`); err != nil {
		return err
	}
	return nil
}
