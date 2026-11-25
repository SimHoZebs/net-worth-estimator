// This standalone one-time operator tool creates the provisional-posting
// satellite and backfills the legacy equality heuristic exactly once. Neither
// setupdb nor the server calls it. deploy/migrate.sh runs it on the verified
// candidate copy after the transaction satellite split.
package main

import (
	"database/sql"
	"flag"
	"fmt"
	"io"
	"net/url"
	"os"
	"path/filepath"
	"strings"

	_ "modernc.org/sqlite"
)

const provisionalPostingsSchema = `CREATE TABLE transaction_provisional_postings (
	user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
	transaction_id TEXT NOT NULL,
	PRIMARY KEY (user_id, transaction_id),
	FOREIGN KEY (user_id, transaction_id) REFERENCES transactions(user_id, id) ON DELETE CASCADE
)`

const legacyCandidates = `SELECT p.user_id, p.id
	FROM transactions p
	JOIN transaction_claims c ON c.user_id = p.user_id AND c.transaction_id = p.id
	WHERE p.source NOT IN ('user', 'model', '')
	  AND p.pending = 0
	  AND p.void = 0
	  AND p.posted_time > 0
	  AND p.posted_time = p.transaction_time`

const legacyBackfill = `INSERT INTO transaction_provisional_postings (user_id, transaction_id) ` + legacyCandidates

type counts struct {
	Created    bool
	Backfilled int
}

func main() { os.Exit(run(os.Args[1:], os.Stdout, os.Stderr)) }

func run(args []string, stdout, stderr io.Writer) int {
	flags := flag.NewFlagSet("provisional-postings", flag.ContinueOnError)
	flags.SetOutput(stderr)
	dbPath := flags.String("db", "", "existing SQLite database to upgrade in place, with the app stopped")
	if err := flags.Parse(args); err != nil {
		return 2
	}
	if strings.TrimSpace(*dbPath) == "" || flags.NArg() != 0 {
		fmt.Fprintln(stderr, "usage: go run ./scripts/one-time/provisional-postings --db PATH")
		return 2
	}
	result, err := upgrade(*dbPath)
	if err != nil {
		fmt.Fprintf(stderr, "provisional posting upgrade: %v\n", err)
		return 1
	}
	if result.Created {
		fmt.Fprintf(stdout, "provisional posting upgrade complete (satellite created, %d legacy markers backfilled)\n", result.Backfilled)
		return 0
	}
	fmt.Fprintln(stdout, "provisional posting upgrade complete (existing satellite verified, rows unchanged)")
	return 0
}

func upgrade(path string) (counts, error) {
	var result counts
	abs, err := filepath.Abs(path)
	if err != nil {
		return result, err
	}
	info, err := os.Lstat(abs)
	if err != nil {
		return result, err
	}
	if !info.Mode().IsRegular() {
		return result, fmt.Errorf("database must be an existing regular file")
	}
	if _, err := os.Lstat(abs + "-journal"); err == nil {
		return result, fmt.Errorf("database has a hot rollback journal; stop every writer and retry")
	} else if !os.IsNotExist(err) {
		return result, err
	}
	u := &url.URL{Scheme: "file", Path: abs}
	db, err := sql.Open("sqlite", u.String()+"?_pragma=busy_timeout(5000)&_pragma=foreign_keys(1)")
	if err != nil {
		return result, err
	}
	defer db.Close()
	db.SetMaxOpenConns(1)
	tx, err := db.Begin()
	if err != nil {
		return result, err
	}
	defer tx.Rollback()

	exists, err := tableExists(tx, "transactions")
	if err != nil {
		return result, err
	}
	if !exists {
		return result, fmt.Errorf("transactions table is missing")
	}
	exists, err = tableExists(tx, "transaction_claims")
	if err != nil {
		return result, err
	}
	if !exists {
		return result, fmt.Errorf("transaction_claims table is missing; run the transaction satellite split first")
	}

	exists, err = tableExists(tx, "transaction_provisional_postings")
	if err != nil {
		return result, err
	}
	if !exists {
		var legacy int
		if err := tx.QueryRow(`SELECT COUNT(*) FROM (` + legacyCandidates + `)`).Scan(&legacy); err != nil {
			return result, err
		}
		if _, err := tx.Exec(provisionalPostingsSchema); err != nil {
			return result, fmt.Errorf("create provisional posting satellite: %w", err)
		}
		inserted, err := tx.Exec(legacyBackfill)
		if err != nil {
			return result, fmt.Errorf("backfill provisional postings: %w", err)
		}
		backfilled, err := inserted.RowsAffected()
		if err != nil {
			return result, err
		}
		if backfilled != int64(legacy) {
			return result, fmt.Errorf("backfilled %d provisional postings, want %d", backfilled, legacy)
		}
		result.Created = true
		result.Backfilled = int(backfilled)
	}

	if err := verifyShape(tx); err != nil {
		return result, err
	}
	if err := verifyRows(tx); err != nil {
		return result, err
	}
	var integrity string
	if err := tx.QueryRow(`PRAGMA integrity_check`).Scan(&integrity); err != nil {
		return result, err
	}
	if integrity != "ok" {
		return result, fmt.Errorf("integrity check failed: %s", integrity)
	}
	var violations int
	if err := tx.QueryRow(`SELECT COUNT(*) FROM pragma_foreign_key_check`).Scan(&violations); err != nil {
		return result, err
	}
	if violations != 0 {
		return result, fmt.Errorf("foreign key violations: %d", violations)
	}
	return result, tx.Commit()
}

func tableExists(tx *sql.Tx, table string) (bool, error) {
	var count int
	err := tx.QueryRow(`SELECT COUNT(*) FROM sqlite_master WHERE type = 'table' AND name = ?`, table).Scan(&count)
	return count == 1, err
}

func verifyShape(tx *sql.Tx) error {
	rows, err := tx.Query(`PRAGMA table_info('transaction_provisional_postings')`)
	if err != nil {
		return err
	}
	type column struct {
		name, kind   string
		notNull, pk  int
		defaultValue any
	}
	var columns []column
	for rows.Next() {
		var cid int
		var c column
		if err := rows.Scan(&cid, &c.name, &c.kind, &c.notNull, &c.defaultValue, &c.pk); err != nil {
			rows.Close()
			return err
		}
		columns = append(columns, c)
	}
	if err := rows.Err(); err != nil {
		rows.Close()
		return err
	}
	rows.Close()
	if len(columns) != 2 || columns[0].name != "user_id" || columns[1].name != "transaction_id" ||
		columns[0].kind != "TEXT" || columns[1].kind != "TEXT" ||
		columns[0].notNull != 1 || columns[1].notNull != 1 ||
		columns[0].defaultValue != nil || columns[1].defaultValue != nil ||
		columns[0].pk != 1 || columns[1].pk != 2 {
		return fmt.Errorf("transaction_provisional_postings has an incomplete shape")
	}
	var foreignKeys int
	if err := tx.QueryRow(`SELECT COUNT(*) FROM pragma_foreign_key_list('transaction_provisional_postings')`).Scan(&foreignKeys); err != nil {
		return err
	}
	// SQLite reports the composite transaction key once per column, plus the
	// separate user key: three rows describe the two foreign keys.
	if foreignKeys != 3 {
		return fmt.Errorf("transaction_provisional_postings must carry user and transaction foreign keys")
	}
	var matched int
	if err := tx.QueryRow(`SELECT COUNT(*) FROM pragma_foreign_key_list('transaction_provisional_postings')
		WHERE on_delete = 'CASCADE' AND (("table" = 'users' AND "from" = 'user_id' AND "to" = 'id')
			OR ("table" = 'transactions' AND "from" = 'transaction_id' AND "to" = 'id')
			OR ("table" = 'transactions' AND "from" = 'user_id' AND "to" = 'user_id'))`).Scan(&matched); err != nil {
		return err
	}
	if matched != 3 {
		return fmt.Errorf("transaction_provisional_postings foreign keys do not match the scoped transaction and user keys")
	}
	var singleKey, compositeKey int
	if err := tx.QueryRow(`SELECT
		(SELECT COUNT(*) FROM (SELECT id FROM pragma_foreign_key_list('transaction_provisional_postings') GROUP BY id HAVING COUNT(*) = 1)),
		(SELECT COUNT(*) FROM (SELECT id FROM pragma_foreign_key_list('transaction_provisional_postings') GROUP BY id HAVING COUNT(*) = 2));`).Scan(&singleKey, &compositeKey); err != nil {
		return err
	}
	if singleKey != 1 || compositeKey != 1 {
		return fmt.Errorf("transaction_provisional_postings must use one user key and one scoped transaction key")
	}
	var scopedColumns int
	fkRows, err := tx.Query(`PRAGMA foreign_key_list('transaction_provisional_postings')`)
	if err != nil {
		return err
	}
	for fkRows.Next() {
		var id, seq int
		var table, from, to, onUpdate, onDelete, match string
		if err := fkRows.Scan(&id, &seq, &table, &from, &to, &onUpdate, &onDelete, &match); err != nil {
			fkRows.Close()
			return err
		}
		if table == "transactions" && ((seq == 0 && from == "user_id" && to == "user_id") || (seq == 1 && from == "transaction_id" && to == "id")) {
			scopedColumns++
		}
	}
	if err := fkRows.Err(); err != nil {
		fkRows.Close()
		return err
	}
	fkRows.Close()
	if scopedColumns != 2 {
		return fmt.Errorf("transaction_provisional_postings transaction key columns are out of scope order")
	}
	return nil
}

func verifyRows(tx *sql.Tx) error {
	var invalid int
	err := tx.QueryRow(`SELECT COUNT(*)
		FROM transaction_provisional_postings pp
		JOIN transactions p ON p.user_id = pp.user_id AND p.id = pp.transaction_id
		LEFT JOIN transaction_claims c ON c.user_id = p.user_id AND c.transaction_id = p.id
		WHERE p.source IN ('user', 'model', '')
		   OR c.transaction_id IS NULL
		   OR p.pending != 0
		   OR p.void != 0
		   OR p.posted_time <= 0
		   OR p.posted_time != p.transaction_time`).Scan(&invalid)
	if err != nil {
		return err
	}
	if invalid != 0 {
		return fmt.Errorf("%d provisional posting markers do not describe claimed bank occurrences", invalid)
	}
	return nil
}
