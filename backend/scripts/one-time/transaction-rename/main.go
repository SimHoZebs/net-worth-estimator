// This standalone, one-time operator script renames stored legacy
// vocabulary to transactions. Neither setupdb nor the server calls it.
package main

import (
	"database/sql"
	"flag"
	"fmt"
	"io"
	"os"

	_ "modernc.org/sqlite"
)

var tableRenames = [][2]string{
	{"postings", "transactions"},
	{"posting_sim", "transaction_sim"},
	{"posting_claims", "transaction_claims"},
	{"posting_sync_keys", "transaction_sync_keys"},
	{"posting_categories", "transaction_categories"},
	{"posting_fulfillment_outputs", "transaction_fulfillment_outputs"},
	{"posting_id_migrations", "transaction_id_migrations"},
}

// columnRenames maps new table name to old column and new column.
var columnRenames = map[string][][2]string{
	"transaction_sim":                 {{"posting_id", "transaction_id"}},
	"transaction_claims":              {{"posting_id", "transaction_id"}},
	"transaction_categories":          {{"posting_id", "transaction_id"}},
	"transaction_sync_keys":           {{"transaction_id", "bank_transaction_id"}, {"posting_id", "transaction_id"}},
	"transaction_fulfillment_outputs": {{"postings_json", "transactions_json"}},
	"transaction_source_facts":        {{"posting_id", "transaction_id"}},
	"analysis_findings":               {{"posting_id", "transaction_id"}},
	"sharing_grants":                  {{"posting_id", "transaction_id"}},
	"sharing_copies":                  {{"copy_posting_id", "copy_transaction_id"}, {"source_posting_id", "source_transaction_id"}},
	"inbox_share_state":               {{"posting_id", "transaction_id"}, {"copy_posting_id", "copy_transaction_id"}},
	"sharing_visibility":              {{"posting_id", "transaction_id"}},
	"sharing_audit":                   {{"posting_id", "transaction_id"}},
	"sharing_requests":                {{"posting_id", "transaction_id"}},
	"splits":                          {{"source_posting_id", "source_transaction_id"}},
	"split_settlements":               {{"linked_posting_id", "linked_transaction_id"}},
	"receipts":                        {{"posting_id", "transaction_id"}},
	"purchase_policies":               {{"posting_id", "transaction_id"}},
	"suppressed_sync_keys":            {{"transaction_id", "bank_transaction_id"}},
}

const analysisTransactionLifecycleTrigger = `CREATE TRIGGER IF NOT EXISTS analysis_transaction_lifecycle AFTER UPDATE OF pending, void ON transactions
		WHEN (OLD.pending != NEW.pending OR OLD.void != NEW.void)
		AND EXISTS(SELECT 1 FROM transaction_source_facts WHERE user_id = NEW.user_id AND transaction_id = NEW.id)
		BEGIN INSERT INTO analysis_inputs(user_id, revision) VALUES (NEW.user_id, 1)
		ON CONFLICT(user_id) DO UPDATE SET revision = revision + 1; END`

const analysisTransactionSimLifecycleTrigger = `CREATE TRIGGER IF NOT EXISTS analysis_transaction_sim_lifecycle AFTER UPDATE OF enabled ON transaction_sim
		WHEN (OLD.enabled != NEW.enabled)
		AND EXISTS(SELECT 1 FROM transaction_source_facts WHERE user_id = NEW.user_id AND transaction_id = NEW.transaction_id)
		BEGIN INSERT INTO analysis_inputs(user_id, revision) VALUES (NEW.user_id, 1)
		ON CONFLICT(user_id) DO UPDATE SET revision = revision + 1; END`

func main() { os.Exit(run(os.Args[1:], os.Stdout, os.Stderr)) }

func run(args []string, stdout, stderr io.Writer) int {
	flags := flag.NewFlagSet("transaction-rename", flagsContinueOnError())
	flags.SetOutput(stderr)
	path := flags.String("db", "", "SQLite database to upgrade in place, with the app stopped")
	if err := flags.Parse(args); err != nil {
		return 2
	}
	if *path == "" || flags.NArg() != 0 {
		fmt.Fprintln(stderr, "usage: go run ./scripts/one-time/transaction-rename --db PATH")
		return 2
	}
	migrated, err := upgrade(*path)
	if err != nil {
		fmt.Fprintln(stderr, err)
		return 1
	}
	if migrated {
		fmt.Fprintln(stdout, "renamed posting vocabulary to transactions")
	}
	return 0
}
func flagsContinueOnError() flag.ErrorHandling { return flag.ContinueOnError }

func tableExists(db *sql.DB, name string) (bool, error) {
	var count int
	err := db.QueryRow(`SELECT COUNT(*) FROM sqlite_master WHERE type='table' AND name=?`, name).Scan(&count)
	return count == 1, err
}

func columns(db *sql.DB, table string) (map[string]bool, error) {
	rows, err := db.Query(`SELECT name FROM pragma_table_info(?) ORDER BY cid`, table)
	if err != nil {
		return nil, err
	}
	defer rows.Close()
	out := map[string]bool{}
	for rows.Next() {
		var name string
		if err := rows.Scan(&name); err != nil {
			return nil, err
		}
		out[name] = true
	}
	return out, rows.Err()
}

func upgrade(path string) (bool, error) {
	db, err := sql.Open("sqlite", path)
	if err != nil {
		return false, err
	}
	defer db.Close()
	if err := db.Ping(); err != nil {
		return false, err
	}
	hasOld, err := tableExists(db, "postings")
	if err != nil {
		return false, err
	}
	hasNew, err := tableExists(db, "transactions")
	if err != nil {
		return false, err
	}
	if !hasOld && hasNew {
		return false, nil
	}
	if !hasOld {
		return false, fmt.Errorf("neither postings nor transactions table present")
	}
	tx, err := db.Begin()
	if err != nil {
		return false, err
	}
	defer tx.Rollback()
	if _, err := tx.Exec(`PRAGMA foreign_keys=OFF`); err != nil {
		return false, err
	}
	// Drop old triggers before renames so recreated triggers match new schema.
	for _, name := range []string{"analysis_posting_lifecycle", "analysis_posting_sim_lifecycle"} {
		if _, err := tx.Exec(`DROP TRIGGER IF EXISTS ` + name); err != nil {
			return false, err
		}
	}
	// Rename tables.
	for _, pair := range tableRenames {
		exists, err := tableExistsTx(tx, pair[0])
		if err != nil {
			return false, err
		}
		if !exists {
			continue
		}
		if _, err := tx.Exec(fmt.Sprintf(`ALTER TABLE %s RENAME TO %s`, pair[0], pair[1])); err != nil {
			return false, fmt.Errorf("rename %s: %w", pair[0], err)
		}
	}
	// Rename columns. For renamed tables the new name is already in place.
	for table, renames := range columnRenames {
		exists, err := tableExistsTx(tx, table)
		if err != nil {
			return false, err
		}
		if !exists {
			continue
		}
		for _, pair := range renames {
			cols, err := columnsTx(tx, table)
			if err != nil {
				return false, err
			}
			if !cols[pair[0]] {
				continue
			}
			if cols[pair[1]] {
				return false, fmt.Errorf("column %s.%s already exists", table, pair[1])
			}
			if _, err := tx.Exec(fmt.Sprintf(`ALTER TABLE %s RENAME COLUMN %s TO %s`, table, pair[0], pair[1])); err != nil {
				return false, err
			}
		}
	}
	// Indexes: replace old names with new vocabulary where the target exists.
	for _, stmt := range []string{
		`DROP INDEX IF EXISTS postings_projection_slice`,
		`CREATE INDEX IF NOT EXISTS transactions_projection_slice ON transactions(user_id, projection_slice_id)`,
		`DROP INDEX IF EXISTS analysis_findings_posting`,
		`CREATE INDEX IF NOT EXISTS analysis_findings_transaction ON analysis_findings(user_id, transaction_id, id)`,
	} {
		if _, err := tx.Exec(stmt); err != nil {
			// Missing table (for example analysis tables on older snapshots)
			// must not abort the rename; setupdb provisions them later.
			if isNoSuchTable(err) {
				continue
			}
			return false, err
		}
	}
	// Stored vocabulary: entity kind, evaluation type, and JSON payloads.
	for _, stmt := range []string{
		`UPDATE entity_ids SET kind='transaction' WHERE kind='posting'`,
		`UPDATE evaluations SET type='transactionFulfillment' WHERE type='postingFulfillment'`,
	} {
		if _, err := tx.Exec(stmt); err != nil && !isNoSuchTable(err) {
			return false, err
		}
	}
	for _, stmt := range jsonRenames() {
		if _, err := tx.Exec(stmt); err != nil && !isNoSuchTable(err) {
			return false, err
		}
	}
	if _, err := tx.Exec(analysisTransactionLifecycleTrigger); err != nil && !isNoSuchTable(err) {
		return false, err
	}
	if _, err := tx.Exec(analysisTransactionSimLifecycleTrigger); err != nil && !isNoSuchTable(err) {
		return false, err
	}
	if err := tx.Commit(); err != nil {
		return false, err
	}
	return true, nil
}

func tableExistsTx(tx *sql.Tx, name string) (bool, error) {
	var count int
	err := tx.QueryRow(`SELECT COUNT(*) FROM sqlite_master WHERE type='table' AND name=?`, name).Scan(&count)
	return count == 1, err
}

func columnsTx(tx *sql.Tx, table string) (map[string]bool, error) {
	rows, err := tx.Query(`SELECT name FROM pragma_table_info(?) ORDER BY cid`, table)
	if err != nil {
		return nil, err
	}
	defer rows.Close()
	out := map[string]bool{}
	for rows.Next() {
		var name string
		if err := rows.Scan(&name); err != nil {
			return nil, err
		}
		out[name] = true
	}
	return out, rows.Err()
}

func isNoSuchTable(err error) bool {
	return err != nil && (contains(err.Error(), "no such table") || contains(err.Error(), "no such column"))
}

func contains(s, substr string) bool {
	return len(s) >= len(substr) && (func() bool {
		for i := 0; i+len(substr) <= len(s); i++ {
			if s[i:i+len(substr)] == substr {
				return true
			}
		}
		return false
	})()
}

type jsonUpdate struct {
	table, column string
}

func jsonRenames() []string {
	// REPLACE runs the PascalCase pass first so Posting becomes Transaction,
	// then the lowercase pass. Stored user names that happen to contain the
	// substring move with the vocabulary; that is the requested rename.
	updates := []jsonUpdate{
		{"evaluations", "config_json"},
		{"projection_states", "det_evaluations_json"},
		{"projection_states", "stoch_evaluations_json"},
		{"transaction_fulfillment_outputs", "transactions_json"},
		{"transaction_fulfillment_outputs", "events_json"},
		{"transaction_fulfillment_outputs", "dates_json"},
		{"transaction_fulfillment_outputs", "diagnostics_json"},
	}
	out := make([]string, 0, len(updates)*2)
	for _, u := range updates {
		out = append(out, fmt.Sprintf(`UPDATE %s SET %s=REPLACE(%s,'Posting','Transaction') WHERE %s IS NOT NULL`, u.table, u.column, u.column, u.column))
		out = append(out, fmt.Sprintf(`UPDATE %s SET %s=REPLACE(%s,'posting','transaction') WHERE %s IS NOT NULL`, u.table, u.column, u.column, u.column))
	}
	return out
}
