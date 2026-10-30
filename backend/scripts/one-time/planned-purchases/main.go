// This standalone, one-time operator script converts purchase policies to
// standalone purchase rows. Neither setupdb nor the server calls it.
package main

import (
	"database/sql"
	"encoding/json"
	"flag"
	"fmt"
	"io"
	"math"
	"net/url"
	"os"
	"path/filepath"
	"strconv"
	"strings"
	"time"

	_ "modernc.org/sqlite"
)

// Frozen target DDL for this upgrade, independent of the application's schema.
const purchaseSchema = `CREATE TABLE planned_purchases (
	user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
	id TEXT NOT NULL,
	position INTEGER NOT NULL,
	name TEXT NOT NULL,
	funding_account_id TEXT NOT NULL,
	cost REAL NOT NULL CHECK (cost > 0),
	earliest_date TEXT NOT NULL,
	priority INTEGER NOT NULL CHECK (priority >= 0),
	enabled INTEGER NOT NULL CHECK (enabled IN (0, 1)),
	PRIMARY KEY(user_id, id),
	FOREIGN KEY(user_id, funding_account_id) REFERENCES accounts(user_id, id) DEFERRABLE INITIALLY DEFERRED
)`

func main() { os.Exit(run(os.Args[1:], os.Stdout, os.Stderr)) }

func run(args []string, stdout, stderr io.Writer) int {
	flags := flag.NewFlagSet("planned-purchases", flag.ContinueOnError)
	flags.SetOutput(stderr)
	path := flags.String("db", "", "existing SQLite database to upgrade in place, with the app stopped")
	if err := flags.Parse(args); err != nil {
		return 2
	}
	if strings.TrimSpace(*path) == "" || flags.NArg() != 0 {
		fmt.Fprintln(stderr, "usage: go run ./scripts/one-time/planned-purchases --db PATH")
		return 2
	}
	count, err := upgrade(*path)
	if err != nil {
		fmt.Fprintf(stderr, "planned purchase upgrade: %v\n", err)
		return 1
	}
	fmt.Fprintf(stdout, "planned purchase upgrade complete (%d rows converted)\n", count)
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
	db, err := sql.Open("sqlite", u.String()+"?mode=rw&_pragma=busy_timeout(5000)&_pragma=foreign_keys(1)")
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

func convert(tx *sql.Tx) (int, error) {
	var count int
	if err := tx.QueryRow(`SELECT COUNT(*) FROM schema_migrations WHERE name = 'shared-accounts-v1'`).Scan(&count); err != nil || count != 1 {
		return 0, fmt.Errorf("expected the shared-accounts-v1 source schema")
	}
	if err := tx.QueryRow(`SELECT COUNT(*) FROM sqlite_master WHERE type = 'table' AND name = 'purchase_policies'`).Scan(&count); err != nil {
		return 0, err
	}
	if count == 0 {
		// A repeated invocation can verify its frozen target without changing it.
		err := tx.QueryRow(`SELECT user_id, id, position, name, funding_account_id, cost, earliest_date, priority, enabled FROM planned_purchases LIMIT 0`).Scan()
		if err != sql.ErrNoRows {
			return 0, fmt.Errorf("expected purchase policies or the completed target schema")
		}
		return 0, nil
	}
	// Analysis evidence belongs to established transactions, not optional
	// purchases. Reject it before a posting deletion can cascade into evidence.
	for _, table := range []string{"transaction_source_facts", "analysis_findings"} {
		if err := tx.QueryRow(`SELECT COUNT(*) FROM sqlite_master WHERE type='table' AND name=?`, table).Scan(&count); err != nil {
			return 0, err
		}
		if count == 0 {
			continue
		}
		if err := tx.QueryRow(`SELECT COUNT(*) FROM ` + table + ` f JOIN purchase_policies q ON f.user_id=q.user_id AND f.posting_id=q.posting_id`).Scan(&count); err != nil {
			return 0, err
		}
		if count != 0 {
			return 0, fmt.Errorf("purchase rows have Analysis evidence; resolve it before conversion")
		}
	}
	if _, err := tx.Exec(purchaseSchema); err != nil {
		return 0, err
	}
	rows, err := tx.Query(`SELECT p.user_id, p.id, p.position, p.name, p.source_account_id, p.destinations, p.amount_resolution_json, p.transaction_time, p.posted_time, q.priority, p.enabled,
		p.source, p.pending, p.void, p.fulfills_rule_id,
		EXISTS(SELECT 1 FROM receipts r WHERE r.user_id = p.user_id AND r.posting_id = p.id),
		EXISTS(SELECT 1 FROM posting_sync_keys k WHERE k.user_id = p.user_id AND k.posting_id = p.id)
		FROM postings p JOIN purchase_policies q ON p.user_id = q.user_id AND p.id = q.posting_id ORDER BY p.user_id, q.priority, p.position`)
	if err != nil {
		return 0, err
	}
	type purchase struct {
		user, id, name, account, date string
		position, priority            int
		cost                          float64
		enabled                       bool
	}
	var purchases []purchase
	for rows.Next() {
		var p purchase
		var account, claim sql.NullString
		var destinations, amountJSON, source string
		var transaction, posted int64
		var pending, voided, receipts, syncKeys bool
		if err := rows.Scan(&p.user, &p.id, &p.position, &p.name, &account, &destinations, &amountJSON, &transaction, &posted, &p.priority, &p.enabled, &source, &pending, &voided, &claim, &receipts, &syncKeys); err != nil {
			rows.Close()
			return 0, err
		}
		var amount struct {
			Resolver string         `json:"resolver"`
			Config   map[string]any `json:"config"`
			Inputs   map[string]any `json:"inputs"`
		}
		if err := json.Unmarshal([]byte(amountJSON), &amount); err != nil {
			rows.Close()
			return 0, fmt.Errorf("purchase %s has invalid amount data", p.id)
		}
		expression, _ := amount.Config["expression"].(string)
		cost, err := strconv.ParseFloat(strings.TrimSpace(expression), 64)
		if err != nil || amount.Resolver != "expression" || len(amount.Inputs) != 0 || cost <= 0 || math.IsNaN(cost) || math.IsInf(cost, 0) || strings.TrimSpace(p.name) == "" || !account.Valid || destinations != "null" || claim.Valid || source != "user" || pending || voided || receipts || syncKeys {
			rows.Close()
			return 0, fmt.Errorf("purchase %s cannot convert safely: expected an owner-authored fixed outflow without claims, receipts, or bank links", p.id)
		}
		if transaction <= 0 {
			transaction = posted
		}
		if transaction <= 0 {
			rows.Close()
			return 0, fmt.Errorf("purchase %s has no valid earliest date", p.id)
		}
		p.cost, p.account = cost, account.String
		p.date = time.Unix(transaction, 0).UTC().Format(time.DateOnly)
		if _, err := time.Parse(time.DateOnly, p.date); err != nil {
			rows.Close()
			return 0, fmt.Errorf("purchase %s has an invalid earliest date", p.id)
		}
		purchases = append(purchases, p)
	}
	if err := rows.Err(); err != nil {
		rows.Close()
		return 0, err
	}
	if err := rows.Close(); err != nil {
		return 0, err
	}
	if err := tx.QueryRow(`SELECT COUNT(*) FROM purchase_policies`).Scan(&count); err != nil {
		return 0, err
	}
	if count != len(purchases) {
		return 0, fmt.Errorf("purchase policies contain orphaned posting references")
	}
	for _, p := range purchases {
		var kind string
		err := tx.QueryRow(`SELECT kind FROM entity_ids WHERE id = ? AND user_id = ?`, p.id, p.user).Scan(&kind)
		if err != nil && err != sql.ErrNoRows {
			return 0, err
		}
		if err == nil && kind != "posting" {
			return 0, fmt.Errorf("purchase %s has a conflicting identity kind", p.id)
		}
		if _, err := tx.Exec(`INSERT INTO planned_purchases(user_id, id, position, name, funding_account_id, cost, earliest_date, priority, enabled) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`, p.user, p.id, p.position, p.name, p.account, p.cost, p.date, p.priority, p.enabled); err != nil {
			return 0, err
		}
		if _, err := tx.Exec(`UPDATE entity_ids SET kind = 'planned-purchase' WHERE id = ? AND user_id = ?`, p.id, p.user); err != nil {
			return 0, err
		}
		if _, err := tx.Exec(`INSERT OR IGNORE INTO entity_ids(id, kind, user_id) VALUES (?, 'planned-purchase', ?)`, p.id, p.user); err != nil {
			return 0, err
		}
		if _, err := tx.Exec(`DELETE FROM postings WHERE id = ? AND user_id = ?`, p.id, p.user); err != nil {
			return 0, err
		}
	}
	_, err = tx.Exec(`DROP TABLE purchase_policies`)
	return len(purchases), err
}
