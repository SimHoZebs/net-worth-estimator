package sqlite

import (
	"database/sql"
	"fmt"
	"strings"
)

// migratePlansToAccounts converts a plan-scoped database (shared-plans-v1) to
// account scope (shared-accounts-v1). It works against either layout: a
// database without a plans table is already account-scoped and returns
// migrated=false.
//
// Backfill keeps the identity hash: private plans/<hash> rows belonged to the
// app_accounts owner user:<hash> (see authorization.ActorKey), so the account
// scope reuses that owner ID. The guest sample becomes the reserved "sample"
// scope and the isolated test fixture becomes "fixture". Neither reserved
// scope has an app_accounts row; the API authorizes them separately.
//
// Per-account ID namespaces are preserved: every financial table keeps its
// (account_id, id) composite key, so identical entity IDs, preset names, and
// upstream sync keys remain isolated across accounts, exactly as the
// shared-database isolation gate requires.
func migratePlansToAccounts(tx *sql.Tx) (bool, error) {
	var plansTable int
	if err := tx.QueryRow(`SELECT COUNT(*) FROM sqlite_master WHERE type = 'table' AND name = 'plans'`).Scan(&plansTable); err != nil {
		return false, err
	}
	if plansTable == 0 {
		return false, nil
	}
	// Only a legacy-marked database still has a plans table. A current
	// database never recreates it, so its presence selects migration.
	var markersTable int
	if err := tx.QueryRow(`SELECT COUNT(*) FROM sqlite_master WHERE type = 'table' AND name = 'schema_migrations'`).Scan(&markersTable); err != nil {
		return false, err
	}
	if markersTable == 0 {
		return false, ErrLegacyDatabase
	}
	var current int
	if err := tx.QueryRow(`SELECT COUNT(*) FROM schema_migrations WHERE name = 'shared-accounts-v1'`).Scan(&current); err != nil || current != 0 {
		if err != nil {
			return false, err
		}
		return false, nil
	}
	type planRow struct {
		id, kind, owner string
	}
	rows, err := tx.Query(`SELECT id, kind, COALESCE(owner_account_id, '') FROM plans`)
	if err != nil {
		return false, err
	}
	var plans []planRow
	for rows.Next() {
		var row planRow
		if err := rows.Scan(&row.id, &row.kind, &row.owner); err != nil {
			rows.Close()
			return false, err
		}
		plans = append(plans, row)
	}
	if err := rows.Err(); err != nil {
		rows.Close()
		return false, err
	}
	rows.Close()
	mapping := make(map[string]string, len(plans))
	for _, row := range plans {
		switch row.kind {
		case "private":
			if row.owner == "" {
				return false, fmt.Errorf("private plan %q has no owner", row.id)
			}
			mapping[row.id] = row.owner
		case "sample":
			mapping[row.id] = SampleAccountID
		case "fixture":
			mapping[row.id] = FixtureAccountID
		default:
			return false, fmt.Errorf("unknown plan kind %q", row.kind)
		}
	}

	creates := createStatements()
	// Defer every foreign-key check to commit: the rekey changes composite
	// scope keys across parents and children, and only the final state is
	// consistent. Disable RENAME reference rewriting as well: renamed parents
	// must keep children pointed at the live table name, not at the backup
	// that phase 3 drops (dropping a referenced backup would cascade-delete
	// not-yet-rebuilt children).
	if _, err := tx.Exec(`PRAGMA defer_foreign_keys=ON`); err != nil {
		return false, err
	}
	if _, err := tx.Exec(`PRAGMA legacy_alter_table=ON`); err != nil {
		return false, err
	}
	defer func() {
		_, _ = tx.Exec(`PRAGMA legacy_alter_table=OFF`)
	}()
	rebuilt := map[string][]string{}
	for _, table := range scopedMigrationTables() {
		legacy, err := tableColumnsOf(tx, table)
		if err != nil {
			return false, err
		}
		if len(legacy) == 0 {
			continue
		}
		var hasLegacy bool
		for _, column := range legacy {
			if column == "plan_id" {
				hasLegacy = true
			}
		}
		if !hasLegacy {
			continue
		}
		create, ok := creates[table]
		if !ok {
			return false, fmt.Errorf("no account-scope definition for %s", table)
		}
		backup := table + "_legacy_migrate"
		if _, err := tx.Exec(`DROP TABLE IF EXISTS "` + backup + `"`); err != nil {
			return false, err
		}
		if _, err := tx.Exec(`ALTER TABLE "` + table + `" RENAME TO "` + backup + `"`); err != nil {
			return false, fmt.Errorf("stage %s: %w", table, err)
		}
		if _, err := tx.Exec(create); err != nil {
			return false, fmt.Errorf("rebuild %s: %w", table, err)
		}
		insert, err := migrationCopy(table, legacy)
		if err != nil {
			return false, err
		}
		if _, err := tx.Exec(insert); err != nil {
			return false, fmt.Errorf("backfill %s: %w", table, err)
		}
		rebuilt[table] = legacy
	}
	// Rekey every rebuilt scope after all copies: composite foreign keys
	// stay consistent and the deferred check validates the final state.
	for table := range rebuilt {
		for planID, accountID := range mapping {
			if planID == accountID {
				continue
			}
			if _, err := tx.Exec(`UPDATE "`+table+`" SET account_id = ? WHERE account_id = ?`, accountID, planID); err != nil {
				return false, fmt.Errorf("rekey %s: %w", table, err)
			}
		}
	}
	for table := range rebuilt {
		if _, err := tx.Exec(`DROP TABLE "` + table + `_legacy_migrate"`); err != nil {
			return false, err
		}
	}
	if _, err := tx.Exec(`DROP TABLE plans`); err != nil {
		return false, err
	}
	// The migration is one-way: the retired marker leaves with the plans
	// table so a migrated database claims exactly one schema version.
	if _, err := tx.Exec(`DELETE FROM schema_migrations WHERE name = 'shared-plans-v1'`); err != nil {
		return false, err
	}
	// Independent of pragma deferral semantics, fail closed on any residual
	// referential mismatch before setup records the new marker.
	var violations int
	if err := tx.QueryRow(`SELECT COUNT(*) FROM pragma_foreign_key_check`).Scan(&violations); err != nil {
		return false, err
	}
	if violations != 0 {
		return false, fmt.Errorf("account-scope migration left %d foreign-key violations", violations)
	}
	return true, nil
}

// scopedMigrationTables lists plan-scoped tables in parent-first rebuild
// order so recreated foreign keys resolve during the migration transaction.
func scopedMigrationTables() []string {
	return []string{
		"accounts",
		"checkpoints",
		"postings",
		"posting_sync_keys",
		"posting_id_migrations",
		"purchase_policies",
		"recurrence_rules",
		"evaluations",
		"projection_artifacts",
		"model_metadata",
		"payment_terms",
		"entity_ids",
		"account_links",
		"pinned_evaluations",
		"safe_spending_settings",
		"sync_state",
		"sync_credentials",
		"amount_presets",
		"receipts",
	}
}

// migrationModelColumn maps an account-scope column back to its legacy
// plan-scope name when the model itself used account_id for a financial
// account or provider account reference.
func migrationModelColumn(table, column string) string {
	if column == "account_id" {
		return "plan_id"
	}
	switch table {
	case "checkpoints", "payment_terms":
		if column == "model_account_id" {
			return "account_id"
		}
	case "posting_sync_keys":
		if column == "bridge_account_id" {
			return "account_id"
		}
	}
	return column
}

// migrationCopy builds INSERT INTO <new> (new columns) SELECT <legacy columns>
// FROM <legacy backup>. Scope values copy over verbatim first; the caller
// rekeys plan IDs to account IDs per the plans mapping afterwards.
func migrationCopy(table string, legacy []string) (string, error) {
	columns, ok := requiredSchemaColumns[table]
	if !ok {
		if table == "receipts" {
			columns = receiptColumns
		} else {
			return "", fmt.Errorf("no column list for %s", table)
		}
	}
	legacySet := map[string]bool{}
	for _, column := range legacy {
		legacySet[column] = true
	}
	var targets, sources []string
	for _, column := range strings.Split(columns, ",") {
		column = strings.TrimSpace(column)
		source := migrationModelColumn(table, column)
		if !legacySet[source] {
			return "", fmt.Errorf("table %s backup lacks column %s", table, source)
		}
		targets = append(targets, `"`+column+`"`)
		sources = append(sources, `"`+source+`"`)
	}
	return `INSERT INTO "` + table + `" (` + strings.Join(targets, ", ") + `) SELECT ` +
		strings.Join(sources, ", ") + ` FROM "` + table + `_legacy_migrate"`, nil
}

func createStatements() map[string]string {
	creates := map[string]string{}
	add := func(statement string) {
		const prefix = "CREATE TABLE IF NOT EXISTS "
		if !strings.HasPrefix(statement, prefix) {
			return
		}
		rest := strings.TrimPrefix(statement, prefix)
		name := rest
		if i := strings.IndexAny(rest, " ("); i >= 0 {
			name = rest[:i]
		}
		creates[strings.Trim(name, `"`)] = statement
	}
	for _, statement := range schemaStatements() {
		add(statement)
	}
	add(receiptSchema)
	return creates
}

func tableColumnsOf(tx *sql.Tx, table string) ([]string, error) {
	rows, err := tx.Query(`PRAGMA table_info("` + table + `")`)
	if err != nil {
		return nil, err
	}
	defer rows.Close()
	var columns []string
	for rows.Next() {
		var cid, notnull, primary int
		var name, kind string
		var def any
		if err := rows.Scan(&cid, &name, &kind, &notnull, &def, &primary); err != nil {
			return nil, err
		}
		columns = append(columns, name)
	}
	return columns, rows.Err()
}
