// This standalone, one-time operator script splits pre-split posting rows
// into core postings plus the posting_sim and posting_claims satellites.
// Neither setupdb nor the server calls it.
package main

import (
	"database/sql"
	"encoding/json"
	"flag"
	"fmt"
	"io"
	"net/url"
	"os"
	"path/filepath"
	"slices"
	"strings"

	_ "modernc.org/sqlite"
)

// Frozen target DDL for this upgrade, independent of the application's
// schema. Posting display order, enablement, and execution order move to
// posting_sim; the occurrence claim moves to posting_claims. The receipts
// table already links receipts to postings, so the postings receipt_ids
// back-reference is dropped after verification instead of being carried.
const postingSimSchema = `CREATE TABLE posting_sim (
	user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
	posting_id TEXT NOT NULL,
	position INTEGER NOT NULL,
	enabled INTEGER NOT NULL CHECK(enabled IN (0,1)),
	execution_order INTEGER NOT NULL DEFAULT 0 CHECK(execution_order >= 0),
	PRIMARY KEY(user_id, posting_id),
	FOREIGN KEY(user_id, posting_id) REFERENCES postings(user_id, id) ON DELETE CASCADE
)`

const postingClaimsSchema = `CREATE TABLE posting_claims (
	user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
	posting_id TEXT NOT NULL,
	fulfills_rule_id TEXT NOT NULL,
	fulfills_occurrence_date TEXT NOT NULL,
	PRIMARY KEY(user_id, posting_id),
	FOREIGN KEY(user_id, posting_id) REFERENCES postings(user_id, id) ON DELETE CASCADE,
	FOREIGN KEY(user_id, fulfills_rule_id) REFERENCES recurrence_rules(user_id, id) DEFERRABLE INITIALLY DEFERRED
)`

const analysisPostingLifecycleTrigger = `CREATE TRIGGER IF NOT EXISTS analysis_posting_lifecycle AFTER UPDATE OF pending, void ON postings
		WHEN (OLD.pending != NEW.pending OR OLD.void != NEW.void)
		AND EXISTS(SELECT 1 FROM transaction_source_facts WHERE user_id = NEW.user_id AND posting_id = NEW.id)
		BEGIN INSERT INTO analysis_inputs(user_id, revision) VALUES (NEW.user_id, 1)
		ON CONFLICT(user_id) DO UPDATE SET revision = revision + 1; END`

const analysisPostingSimLifecycleTrigger = `CREATE TRIGGER IF NOT EXISTS analysis_posting_sim_lifecycle AFTER UPDATE OF enabled ON posting_sim
		WHEN (OLD.enabled != NEW.enabled)
		AND EXISTS(SELECT 1 FROM transaction_source_facts WHERE user_id = NEW.user_id AND posting_id = NEW.posting_id)
		BEGIN INSERT INTO analysis_inputs(user_id, revision) VALUES (NEW.user_id, 1)
		ON CONFLICT(user_id) DO UPDATE SET revision = revision + 1; END`

// oldPostingColumns are the pre-split postings columns that leave the core
// table. Every one must be present for conversion; a subset is a partial or
// mixed shape and fails closed.
var oldPostingColumns = []string{
	"destinations", "position", "enabled", "execution_order",
	"fulfills_rule_id", "fulfills_occurrence_date", "receipt_ids",
}

func main() { os.Exit(run(os.Args[1:], os.Stdout, os.Stderr)) }

func run(args []string, stdout, stderr io.Writer) int {
	flags := flag.NewFlagSet("posting-sim-split", flag.ContinueOnError)
	flags.SetOutput(stderr)
	path := flags.String("db", "", "existing SQLite database to upgrade in place, with the app stopped")
	if err := flags.Parse(args); err != nil {
		return 2
	}
	if strings.TrimSpace(*path) == "" || flags.NArg() != 0 {
		fmt.Fprintln(stderr, "usage: go run ./scripts/one-time/posting-sim-split --db PATH")
		return 2
	}
	count, err := upgrade(*path)
	if err != nil {
		fmt.Fprintf(stderr, "posting sim split: %v\n", err)
		return 1
	}
	fmt.Fprintf(stdout, "posting sim split complete (%d rows converted)\n", count)
	return 0
}

func upgrade(path string) (int, error) {
	abs, err := filepath.Abs(path)
	if err != nil {
		return 0, err
	}
	info, err := os.Lstat(abs)
	if err != nil {
		return 0, err
	}
	resolved, err := filepath.EvalSymlinks(abs)
	if err != nil || resolved != abs || !info.Mode().IsRegular() {
		return 0, fmt.Errorf("database must be an existing regular file without symlinks")
	}
	for _, suffix := range []string{"-wal", "-shm"} {
		info, err := os.Lstat(abs + suffix)
		if os.IsNotExist(err) {
			continue
		}
		if err != nil {
			return 0, err
		}
		if !info.Mode().IsRegular() {
			return 0, fmt.Errorf("database sidecars must be regular files without symlinks")
		}
	}
	u := &url.URL{Scheme: "file", Path: abs}
	db, err := sql.Open("sqlite", u.String()+"?mode=rw&_pragma=busy_timeout(5000)&_pragma=foreign_keys(0)")
	if err != nil {
		return 0, err
	}
	defer db.Close()
	db.SetMaxOpenConns(1)
	tx, err := db.Begin()
	if err != nil {
		return 0, err
	}
	defer tx.Rollback()
	count, err := convert(tx)
	if err != nil {
		return 0, err
	}
	return count, tx.Commit()
}

func tableColumns(tx *sql.Tx, table string) (map[string]bool, error) {
	rows, err := tx.Query(`PRAGMA table_info(` + table + `)`)
	if err != nil {
		return nil, err
	}
	defer rows.Close()
	columns := map[string]bool{}
	for rows.Next() {
		var cid, notNull, pk int
		var name, kind string
		var defaultValue any
		if err := rows.Scan(&cid, &name, &kind, &notNull, &defaultValue, &pk); err != nil {
			return nil, err
		}
		columns[name] = true
	}
	return columns, rows.Err()
}

func tableExists(tx *sql.Tx, table string) (bool, error) {
	var count int
	if err := tx.QueryRow(`SELECT COUNT(*) FROM sqlite_master WHERE type = 'table' AND name = ?`, table).Scan(&count); err != nil {
		return false, err
	}
	return count == 1, nil
}

func convert(tx *sql.Tx) (int, error) {
	columns, err := tableColumns(tx, "postings")
	if err != nil {
		return 0, err
	}
	_, hasNew := columns["destination_account_ids"]
	var missingOld []string
	for _, column := range oldPostingColumns {
		if !columns[column] {
			missingOld = append(missingOld, column)
		}
	}
	simExists, err := tableExists(tx, "posting_sim")
	if err != nil {
		return 0, err
	}
	claimsExists, err := tableExists(tx, "posting_claims")
	if err != nil {
		return 0, err
	}
	if hasNew && len(missingOld) == len(oldPostingColumns) && simExists && claimsExists {
		// A repeated invocation verifies its frozen target without changing it.
		for _, query := range []string{
			`SELECT user_id, id, name, source_account_id, destination_account_ids, amount_resolution_json, posted_time, transaction_time, source, pending, void FROM postings LIMIT 0`,
			`SELECT user_id, posting_id, position, enabled, execution_order FROM posting_sim LIMIT 0`,
			`SELECT user_id, posting_id, fulfills_rule_id, fulfills_occurrence_date FROM posting_claims LIMIT 0`,
		} {
			if err := tx.QueryRow(query).Scan(); err != sql.ErrNoRows {
				return 0, fmt.Errorf("expected the completed split target schema")
			}
		}
		if err := ensureAnalysisTriggers(tx); err != nil {
			return 0, err
		}
		return 0, nil
	}
	if hasNew || len(missingOld) != 0 {
		return 0, fmt.Errorf("expected either the pre-split postings shape (%s) or the completed split target", strings.Join(oldPostingColumns, ", "))
	}
	if _, err := tx.Exec(postingSimSchema); err != nil {
		return 0, err
	}
	if _, err := tx.Exec(postingClaimsSchema); err != nil {
		return 0, err
	}
	for _, table := range []string{"posting_sim", "posting_claims"} {
		var count int
		if err := tx.QueryRow(`SELECT COUNT(*) FROM ` + table).Scan(&count); err != nil {
			return 0, err
		}
		if count != 0 {
			return 0, fmt.Errorf("table %s already holds rows; refusing a partial split", table)
		}
	}
	receiptsExists, err := tableExists(tx, "receipts")
	if err != nil {
		return 0, err
	}
	rows, err := tx.Query(`SELECT user_id, id, name, source_account_id, destinations, amount_resolution_json, posted_time, transaction_time, source, pending, void,
		position, enabled, execution_order, fulfills_rule_id, fulfills_occurrence_date, receipt_ids
		FROM postings ORDER BY user_id, position, id`)
	if err != nil {
		return 0, err
	}
	type split struct {
		user, id, name, destinations, amount string
		sourceAccount, rule, date            sql.NullString
		posted, transaction                  int64
		source                               string
		pending, void                        bool
		position, enabled, execution         int64
	}
	var splits []split
	for rows.Next() {
		var s split
		var receiptIDs string
		var pending, void, enabled int64
		if err := rows.Scan(&s.user, &s.id, &s.name, &s.sourceAccount, &s.destinations, &s.amount, &s.posted, &s.transaction,
			&s.source, &pending, &void, &s.position, &enabled, &s.execution, &s.rule, &s.date, &receiptIDs); err != nil {
			rows.Close()
			return 0, err
		}
		if s.destinations != "null" {
			var parsed []string
			if err := json.Unmarshal([]byte(s.destinations), &parsed); err != nil {
				rows.Close()
				return 0, fmt.Errorf("posting %s has invalid destinations data", s.id)
			}
		}
		if !json.Valid([]byte(s.amount)) {
			rows.Close()
			return 0, fmt.Errorf("posting %s has invalid amount data", s.id)
		}
		if enabled != 0 && enabled != 1 {
			rows.Close()
			return 0, fmt.Errorf("posting %s has invalid enabled state", s.id)
		}
		if s.rule.Valid != s.date.Valid {
			rows.Close()
			return 0, fmt.Errorf("posting %s has a partial occurrence claim", s.id)
		}
		if s.rule.Valid {
			var exists bool
			if err := tx.QueryRow(`SELECT EXISTS(SELECT 1 FROM recurrence_rules WHERE user_id = ? AND id = ?)`, s.user, s.rule.String).Scan(&exists); err != nil {
				rows.Close()
				return 0, err
			}
			if !exists {
				rows.Close()
				return 0, fmt.Errorf("posting %s claims a missing recurrence rule", s.id)
			}
		}
		s.enabled, s.pending, s.void = enabled, pending != 0, void != 0
		var field []string
		if err := json.Unmarshal([]byte(receiptIDs), &field); err != nil {
			rows.Close()
			return 0, fmt.Errorf("posting %s has invalid receipt data", s.id)
		}
		seen := make(map[string]bool, len(field))
		for _, id := range field {
			if seen[id] {
				// The writer deduplicated; a repeated ID is corruption,
				// not a set to preserve.
				rows.Close()
				return 0, fmt.Errorf("posting %s has duplicate receipt data", s.id)
			}
			seen[id] = true
		}
		var stored []string
		if receiptsExists {
			storedRows, err := tx.Query(`SELECT id FROM receipts WHERE user_id = ? AND posting_id = ? ORDER BY id`, s.user, s.id)
			if err != nil {
				rows.Close()
				return 0, err
			}
			for storedRows.Next() {
				var id string
				if err := storedRows.Scan(&id); err != nil {
					storedRows.Close()
					rows.Close()
					return 0, err
				}
				stored = append(stored, id)
			}
			if err := storedRows.Err(); err != nil {
				storedRows.Close()
				rows.Close()
				return 0, err
			}
			if err := storedRows.Close(); err != nil {
				rows.Close()
				return 0, err
			}
		}
		// The stored field keeps insertion order while the receipts table
		// has none, so the join check compares sets, not sequences.
		slices.Sort(field)
		slices.Sort(stored)
		if !slices.Equal(field, stored) {
			rows.Close()
			return 0, fmt.Errorf("posting %s receipt links do not match stored receipts", s.id)
		}
		splits = append(splits, s)
	}
	if err := rows.Err(); err != nil {
		rows.Close()
		return 0, err
	}
	if err := rows.Close(); err != nil {
		return 0, err
	}
	for _, s := range splits {
		if _, err := tx.Exec(`INSERT INTO posting_sim(user_id, posting_id, position, enabled, execution_order) VALUES (?, ?, ?, ?, ?)`,
			s.user, s.id, s.position, s.enabled, s.execution); err != nil {
			return 0, err
		}
		if s.rule.Valid {
			if _, err := tx.Exec(`INSERT INTO posting_claims(user_id, posting_id, fulfills_rule_id, fulfills_occurrence_date) VALUES (?, ?, ?, ?)`,
				s.user, s.id, s.rule.String, s.date.String); err != nil {
				return 0, err
			}
		}
	}
	// Rebuild postings into the post-split core shape. Dropping columns one
	// at a time fails on legacy schemas whose foreign keys reference a removed
	// column, so recreate the table explicitly.
	if _, err := tx.Exec(`CREATE TABLE postings_new (
		user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
		id TEXT NOT NULL,
		name TEXT NOT NULL,
		source_account_id TEXT,
		destination_account_ids TEXT,
		amount_resolution_json TEXT NOT NULL,
		posted_time INTEGER NOT NULL,
		transaction_time INTEGER NOT NULL,
		source TEXT NOT NULL DEFAULT 'user',
		pending INTEGER NOT NULL DEFAULT 0 CHECK (pending IN (0, 1)),
		void INTEGER NOT NULL DEFAULT 0 CHECK (void IN (0, 1)),
		PRIMARY KEY (user_id, id),
		FOREIGN KEY(user_id, source_account_id) REFERENCES accounts(user_id, id) DEFERRABLE INITIALLY DEFERRED
	)`); err != nil {
		return 0, err
	}
	if _, err := tx.Exec(`INSERT INTO postings_new(user_id, id, name, source_account_id, destination_account_ids, amount_resolution_json, posted_time, transaction_time, source, pending, void)
		SELECT user_id, id, name, source_account_id, destinations, amount_resolution_json, posted_time, transaction_time, source, pending, void
		FROM postings`); err != nil {
		return 0, err
	}
	if _, err := tx.Exec(`DROP TABLE postings`); err != nil {
		return 0, err
	}
	if _, err := tx.Exec(`ALTER TABLE postings_new RENAME TO postings`); err != nil {
		return 0, err
	}
	if err := ensureAnalysisTriggers(tx); err != nil {
		return 0, err
	}
	return len(splits), nil
}

func ensureAnalysisTriggers(tx *sql.Tx) error {
	var count int
	if err := tx.QueryRow(`SELECT COUNT(*) FROM sqlite_master WHERE type = 'table' AND name = 'transaction_source_facts'`).Scan(&count); err != nil {
		return err
	}
	if count == 0 {
		return nil
	}
	if _, err := tx.Exec(analysisPostingLifecycleTrigger); err != nil {
		return err
	}
	if _, err := tx.Exec(analysisPostingSimLifecycleTrigger); err != nil {
		return err
	}
	return nil
}
