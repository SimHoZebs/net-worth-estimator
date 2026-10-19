package store

import (
	"path/filepath"
	"strings"
	"testing"

	"database/sql"
)

// TestOpenBridgesLegacyLedgerAndRenamesColumns builds a pre-change v12
// file (old ledger table, old column names, user_version 0) and proves Open
// adopts it via the bridge, drops the table, renames the columns, and
// preserves all rows.
func TestOpenBridgesLegacyLedgerAndRenamesColumns(t *testing.T) {
	path := filepath.Join(t.TempDir(), "legacy-v12.db")
	raw, err := sql.Open("sqlite", path)
	if err != nil {
		t.Fatalf("open raw: %v", err)
	}
	tx, err := raw.Begin()
	if err != nil {
		t.Fatalf("begin: %v", err)
	}
	for _, migrate := range []func(*sql.Tx) error{
		migrateV1, migrateV2, migrateV3, migrateV4, migrateV5,
		migrateV6, migrateV7, migrateV8, migrateV9, migrateV10,
		migrateV11, migrateV12,
	} {
		if err := migrate(tx); err != nil {
			t.Fatalf("migrate: %v", err)
		}
	}
	seed := []string{
		`CREATE TABLE schema_version (version INTEGER NOT NULL)`,
		`INSERT INTO schema_version (version) VALUES (1)`,
		`INSERT INTO schema_version (version) VALUES (2)`,
		`INSERT INTO schema_version (version) VALUES (3)`,
		`INSERT INTO schema_version (version) VALUES (4)`,
		`INSERT INTO schema_version (version) VALUES (5)`,
		`INSERT INTO schema_version (version) VALUES (6)`,
		`INSERT INTO schema_version (version) VALUES (7)`,
		`INSERT INTO schema_version (version) VALUES (8)`,
		`INSERT INTO schema_version (version) VALUES (9)`,
		`INSERT INTO schema_version (version) VALUES (10)`,
		`INSERT INTO schema_version (version) VALUES (11)`,
		`INSERT INTO schema_version (version) VALUES (12)`,
		`INSERT INTO accounts (id, position, name, kind, min_balance, max_balance, color, enabled) VALUES ('checking', 0, 'Checking', 'cash', -10000000000000, 10000000000000, NULL, 1)`,
		`INSERT INTO entity_ids (id, kind) VALUES ('checking', 'account')`,
		`INSERT INTO checkpoints (position, date, account_id, balance, source) VALUES (0, '2026-08-01', 'checking', 500, 'model')`,
		`INSERT INTO recurrence_rules (id, position, name, source_account_id, destinations, amount_json, frequency, start_date, end_date, annual_cap, priority, enabled)
		 VALUES ('rule-monthly', 0, 'Rule', NULL, '["checking"]', '{"resolver":"expression","config":{"expression":"100"},"inputs":{}}', 'monthly', '2026-01-01', NULL, NULL, 1, 1)`,
		`INSERT INTO entity_ids (id, kind) VALUES ('rule-monthly', 'rule')`,
		`INSERT INTO postings (id, position, name, source_account_id, destinations, amount_json, posted_time, transaction_time, claim_rule_id, claim_occurrence_date, enabled, source)
		 VALUES ('posting-actual', 0, 'Actual', NULL, '["checking"]', '{"resolver":"expression","config":{"expression":"50"},"inputs":{}}', 1785628800, 1785628800, 'rule-monthly', '2026-02-01', 1, 'model')`,
		`INSERT INTO entity_ids (id, kind) VALUES ('posting-actual', 'posting')`,
		`INSERT INTO evaluations (type, instance_id, position, name, enabled, config_json) VALUES ('netWorthThreshold', 'eval-1', 0, 'Target', 1, '{"target":100}')`,
		`INSERT INTO entity_ids (id, kind) VALUES ('eval-1', 'evaluation')`,
		`INSERT INTO income_sources (id, position, name, effective_from, effective_to, annual_gross_income) VALUES ('salary', 0, 'Salary', '2026-01-01', NULL, 100)`,
		`INSERT INTO tax_profiles (id, position, name, deduction, brackets_json, source_url) VALUES ('tax', 0, 'Tax', 0, '[]', NULL)`,
		`INSERT INTO account_links (bridge_account_id, model_account_id, bridge_name, currency, origin, last_seen_at) VALUES ('bridge-1', 'checking', 'College', 'USD', 'manual', '2026-08-01')`,
		`INSERT INTO pinned_evaluations (instance_id, position) VALUES ('eval-1', 0)`,
		`UPDATE sync_state SET last_sync_at = '2026-10-18T14:30:00Z' WHERE id = 1`,
		`INSERT INTO projection_artifacts (identity, kind, payload) VALUES ('id-1', 'deterministic', '{}')`,
		`UPDATE model_metadata SET source_path = 'configs', document_present = 1 WHERE id = 1`,
	}
	for _, statement := range seed {
		if _, err := tx.Exec(statement); err != nil {
			t.Fatalf("seed legacy %q: %v", statement, err)
		}
	}
	if err := tx.Commit(); err != nil {
		t.Fatalf("commit: %v", err)
	}
	var userVersion int
	if err := raw.QueryRow(`PRAGMA user_version`).Scan(&userVersion); err != nil || userVersion != 0 {
		t.Fatalf("legacy user_version = %d, err %v, want 0", userVersion, err)
	}
	if err := raw.Close(); err != nil {
		t.Fatalf("close raw: %v", err)
	}

	opened, err := Open(path)
	if err != nil {
		t.Fatalf("open bridges legacy file: %v", err)
	}
	t.Cleanup(func() { _ = opened.Close() })
	implementation, ok := opened.(*sqliteStore)
	if !ok {
		t.Fatalf("Open returned %T, want *sqliteStore", opened)
	}
	var version int
	if err := implementation.db.QueryRow(`PRAGMA user_version`).Scan(&version); err != nil || version != latestSchemaVersion {
		t.Fatalf("bridged schema version = %d, err %v, want %d", version, err, latestSchemaVersion)
	}
	var tableCount int
	if err := implementation.db.QueryRow(`SELECT COUNT(*) FROM sqlite_master WHERE type = 'table' AND name = 'schema_version'`).Scan(&tableCount); err != nil || tableCount != 0 {
		t.Fatalf("legacy schema_version table present = %d, err %v", tableCount, err)
	}
	postingColumns := map[string]bool{}
	rows, err := implementation.db.Query(`PRAGMA table_info(postings)`)
	if err != nil {
		t.Fatalf("posting columns: %v", err)
	}
	for rows.Next() {
		var cid int
		var name, columnType string
		var notNull, pk int
		var defaultValue sql.NullString
		if err := rows.Scan(&cid, &name, &columnType, &notNull, &defaultValue, &pk); err != nil {
			rows.Close()
			t.Fatalf("scan posting column: %v", err)
		}
		postingColumns[name] = true
	}
	rows.Close()
	for _, want := range []string{"amount_resolution_json", "fulfills_rule_id", "fulfills_occurrence_date"} {
		if !postingColumns[want] {
			t.Fatalf("postings missing renamed column %q: %v", want, postingColumns)
		}
	}
	for _, gone := range []string{"amount_json", "claim_rule_id", "claim_occurrence_date"} {
		if postingColumns[gone] {
			t.Fatalf("postings still has old column %q", gone)
		}
	}
	ruleColumns := map[string]bool{}
	ruleRows, err := implementation.db.Query(`PRAGMA table_info(recurrence_rules)`)
	if err != nil {
		t.Fatalf("rule columns: %v", err)
	}
	for ruleRows.Next() {
		var cid int
		var name, columnType string
		var notNull, pk int
		var defaultValue sql.NullString
		if err := ruleRows.Scan(&cid, &name, &columnType, &notNull, &defaultValue, &pk); err != nil {
			ruleRows.Close()
			t.Fatalf("scan rule column: %v", err)
		}
		ruleColumns[name] = true
	}
	ruleRows.Close()
	if !ruleColumns["amount_resolution_json"] || ruleColumns["amount_json"] {
		t.Fatalf("recurrence_rules columns = %v, want renamed amount column", ruleColumns)
	}

	document, err := opened.LoadDocument()
	if err != nil || document == nil {
		t.Fatalf("load bridged document = %+v, err %v", document, err)
	}
	if len(document.Postings) != 1 || len(document.RecurrenceRules) != 1 {
		t.Fatalf("bridged document = %+v, want 1 posting and 1 rule", document)
	}
	posting := document.Postings[0]
	if posting.Amount.Resolver != "expression" {
		t.Fatalf("bridged posting amount = %+v", posting.Amount)
	}
	if posting.Claim == nil || posting.Claim.RuleID != "rule-monthly" || string(posting.Claim.OccurrenceDate) != "2026-02-01" {
		t.Fatalf("bridged posting claim = %+v", posting.Claim)
	}
	if document.RecurrenceRules[0].Amount.Resolver != "expression" {
		t.Fatalf("bridged rule amount = %+v", document.RecurrenceRules[0].Amount)
	}
	if len(document.Checkpoints) != 1 || document.Checkpoints[0].Balance != 500 {
		t.Fatalf("bridged checkpoints = %+v", document.Checkpoints)
	}
	income, err := opened.LoadIncomeData()
	if err != nil || len(income.IncomeSources) != 1 || income.IncomeSources[0].AnnualGrossIncome != 100 {
		t.Fatalf("bridged income = %+v, err %v", income, err)
	}
	links, err := opened.ListAccountLinks()
	if err != nil || len(links) != 1 || links[0].BridgeAccountID != "bridge-1" {
		t.Fatalf("bridged links = %+v, err %v", links, err)
	}
	pins, err := opened.ListPinnedEvaluations()
	if err != nil || len(pins) != 1 || pins[0] != "eval-1" {
		t.Fatalf("bridged pins = %+v, err %v", pins, err)
	}
	lastSync, err := opened.GetLastSyncTime()
	if err != nil || lastSync != "2026-10-18T14:30:00Z" {
		t.Fatalf("bridged last sync = %q, err %v", lastSync, err)
	}
	if _, found, err := opened.GetArtifact("id-1"); err != nil || !found {
		t.Fatalf("bridged artifact found = %v, err %v", found, err)
	}
	if !strings.Contains(document.SourcePath, "configs") {
		t.Fatalf("bridged source path = %q", document.SourcePath)
	}
}
