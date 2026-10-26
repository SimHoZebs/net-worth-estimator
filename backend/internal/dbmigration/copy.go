package dbmigration

import (
	"crypto/sha256"
	"database/sql"
	"encoding/json"
	"fmt"
	"net/url"
	"path/filepath"
	"sort"
	"strings"
)

var financialTables = []string{
	"accounts", "checkpoints", "postings", "posting_sync_keys", "posting_id_migrations",
	"schema_migrations", "purchase_policies", "recurrence_rules", "evaluations",
	"projection_artifacts", "model_metadata", "payment_terms", "entity_ids", "account_links",
	"pinned_evaluations", "safe_spending_settings", "sync_state", "amount_presets",
}

var singletonTables = map[string]bool{"model_metadata": true, "sync_state": true, "safe_spending_settings": true}

type snapshot struct {
	db *sql.DB
	tx *sql.Tx
}

func openSnapshot(path string) (*snapshot, error) {
	absolute, err := filepath.Abs(path)
	if err != nil {
		return nil, err
	}
	u := url.URL{Scheme: "file", Path: absolute}
	db, err := sql.Open("sqlite", u.String()+"?mode=ro&_pragma=query_only(1)&_pragma=busy_timeout(5000)")
	if err != nil {
		return nil, fmt.Errorf("open read-only source")
	}
	db.SetMaxOpenConns(1)
	tx, err := db.Begin()
	if err != nil {
		db.Close()
		return nil, fmt.Errorf("begin source snapshot")
	}
	s := &snapshot{db, tx}
	var check string
	if err := tx.QueryRow("PRAGMA integrity_check").Scan(&check); err != nil || check != "ok" {
		s.close()
		return nil, fmt.Errorf("source integrity check failed")
	}
	rows, err := tx.Query("PRAGMA foreign_key_check")
	if err != nil {
		s.close()
		return nil, fmt.Errorf("source foreign-key check failed")
	}
	invalid := rows.Next()
	err = rows.Err()
	rows.Close()
	if invalid || err != nil {
		s.close()
		return nil, fmt.Errorf("source has invalid foreign keys")
	}
	return s, nil
}

func (s *snapshot) close() { s.tx.Rollback(); s.db.Close() }

func quote(s string) string { return `"` + strings.ReplaceAll(s, `"`, `""`) + `"` }

func columns(tx *sql.Tx, table string) ([]string, error) {
	rows, err := tx.Query("PRAGMA table_info(" + quote(table) + ")")
	if err != nil {
		return nil, err
	}
	defer rows.Close()
	var result []string
	for rows.Next() {
		var cid, required, pk int
		var name, kind string
		var def any
		if err := rows.Scan(&cid, &name, &kind, &required, &def, &pk); err != nil {
			return nil, err
		}
		result = append(result, name)
	}
	return result, rows.Err()
}

// copyTable compares all stored values, not only canonical model fields. This
// covers revisions, order, sync keys, preferences, artifacts and opaque tokens.
func copyTable(src, dst *sql.Tx, table, plan string) (int, error) {
	sourceColumns, err := columns(src, table)
	if err != nil {
		return 0, err
	}
	targetColumns, err := columns(dst, table)
	if err != nil {
		return 0, err
	}
	// Schema history belongs to the database rather than any financial plan.
	// Older plan files share this marker. Merge the known marker only.
	if table == "schema_migrations" && !hasColumn(targetColumns, "plan_id") {
		return copySchemaHistory(src, dst, sourceColumns, targetColumns)
	}
	var payload []string
	for _, col := range sourceColumns {
		if plan != "" && singletonTables[table] && col == "id" && !hasColumn(targetColumns, "id") {
			continue
		}
		payload = append(payload, col)
	}
	expected := append([]string(nil), payload...)
	if plan != "" {
		expected = append(expected, "plan_id")
	}
	sort.Strings(expected)
	actual := append([]string(nil), targetColumns...)
	sort.Strings(actual)
	if len(sourceColumns) == 0 || strings.Join(expected, "\x00") != strings.Join(actual, "\x00") {
		for _, col := range payload {
			if !hasColumn(targetColumns, col) {
				return 0, fmt.Errorf("unsupported schema for %s: shared destination drops legacy column %s; preserve that column in the shared schema before migration", table, col)
			}
		}
		return 0, fmt.Errorf("unsupported schema for %s: upgrade a disposable SQLite backup with the previous release first; sources were not changed", table)
	}
	if plan != "" {
		if _, err := dst.Exec("DELETE FROM "+quote(table)+" WHERE plan_id=?", plan); err != nil {
			return 0, fmt.Errorf("clear target table %s", table)
		}
	}
	quoted := make([]string, len(payload))
	for i, col := range payload {
		quoted[i] = quote(col)
	}
	selectSQL := "SELECT " + strings.Join(quoted, ",") + " FROM " + quote(table)
	rows, err := src.Query(selectSQL)
	if err != nil {
		return 0, fmt.Errorf("read table %s", table)
	}
	defer rows.Close()
	insertCols := append([]string(nil), quoted...)
	if plan != "" {
		insertCols = append(insertCols, "plan_id")
	}
	insert := "INSERT INTO " + quote(table) + " (" + strings.Join(insertCols, ",") + ") VALUES (" + strings.TrimSuffix(strings.Repeat("?,", len(insertCols)), ",") + ")"
	var hashes []string
	for rows.Next() {
		values := make([]any, len(payload))
		ptrs := make([]any, len(payload))
		for i := range values {
			ptrs[i] = &values[i]
		}
		if err := rows.Scan(ptrs...); err != nil {
			return 0, fmt.Errorf("scan table %s", table)
		}
		hashes = append(hashes, rowHash(values))
		args := append([]any(nil), values...)
		if plan != "" {
			args = append(args, plan)
		}
		if _, err := dst.Exec(insert, args...); err != nil {
			return 0, fmt.Errorf("copy table %s: constraint or data conflict", table)
		}
	}
	if err := rows.Err(); err != nil {
		return 0, fmt.Errorf("read table %s", table)
	}
	if plan != "" {
		selectSQL += " WHERE plan_id=?"
	}
	var args []any
	if plan != "" {
		args = append(args, plan)
	}
	check, err := dst.Query(selectSQL, args...)
	if err != nil {
		return 0, fmt.Errorf("verify table %s", table)
	}
	defer check.Close()
	var copied []string
	for check.Next() {
		values := make([]any, len(payload))
		ptrs := make([]any, len(payload))
		for i := range values {
			ptrs[i] = &values[i]
		}
		if err := check.Scan(ptrs...); err != nil {
			return 0, fmt.Errorf("verify table %s", table)
		}
		copied = append(copied, rowHash(values))
	}
	if err := check.Err(); err != nil {
		return 0, fmt.Errorf("verify table %s", table)
	}
	sort.Strings(hashes)
	sort.Strings(copied)
	if strings.Join(hashes, "") != strings.Join(copied, "") {
		return 0, fmt.Errorf("verification mismatch for table %s", table)
	}
	return len(hashes), nil
}

func hasColumn(columns []string, wanted string) bool {
	for _, col := range columns {
		if col == wanted {
			return true
		}
	}
	return false
}

func copySchemaHistory(src, dst *sql.Tx, sourceColumns, targetColumns []string) (int, error) {
	if len(sourceColumns) != 1 || sourceColumns[0] != "name" || len(targetColumns) != 1 || targetColumns[0] != "name" {
		return 0, fmt.Errorf("unsupported schema migration history")
	}
	rows, err := src.Query(`SELECT name FROM schema_migrations`)
	if err != nil {
		return 0, fmt.Errorf("read schema history")
	}
	defer rows.Close()
	count := 0
	for rows.Next() {
		var name string
		if err := rows.Scan(&name); err != nil {
			return 0, fmt.Errorf("read schema history")
		}
		if name != "posting-uuid-and-pending-v1" {
			return 0, fmt.Errorf("unsupported legacy schema migration marker; use a compatible previous release backup")
		}
		if _, err := dst.Exec(`INSERT OR IGNORE INTO schema_migrations(name) VALUES(?)`, name); err != nil {
			return 0, fmt.Errorf("copy schema history")
		}
		var present int
		if err := dst.QueryRow(`SELECT COUNT(*) FROM schema_migrations WHERE name=?`, name).Scan(&present); err != nil || present != 1 {
			return 0, fmt.Errorf("verify schema history")
		}
		count++
	}
	return count, rows.Err()
}

func rowHash(values []any) string {
	b, _ := json.Marshal(values)
	return fmt.Sprintf("%x", sha256.Sum256(b))
}
