// This standalone, one-time operator script repairs settled bank rows whose
// posted instant was cleared to zero by a pending bank refresh while the row
// was claimed as a recorded occurrence. Neither setupdb nor the server calls it.
package main

import (
	"database/sql"
	"flag"
	"fmt"
	"io"
	"os"
	"path/filepath"

	_ "modernc.org/sqlite"
)

func main() { os.Exit(run(os.Args[1:], os.Stdout, os.Stderr)) }

func run(args []string, stdout, stderr io.Writer) int {
	flags := flag.NewFlagSet("repair-claimed-posted-time", flag.ContinueOnError)
	flags.SetOutput(stderr)
	dbPath := flags.String("db", "", "existing SQLite database to repair in place, with the app stopped")
	dryRun := flags.Bool("dry-run", false, "report repairable rows without writing")
	if err := flags.Parse(args); err != nil {
		return 2
	}
	if *dbPath == "" || flags.NArg() != 0 {
		fmt.Fprintln(stderr, "usage: go run ./scripts/one-time/repair-claimed-posted-time --db PATH [--dry-run]")
		return 2
	}
	repaired, err := upgrade(*dbPath, *dryRun)
	if err != nil {
		fmt.Fprintf(stderr, "repair claimed posted time: %v\n", err)
		return 1
	}
	if *dryRun {
		fmt.Fprintf(stdout, "repair claimed posted time dry run (%d rows repairable)\n", repaired)
		return 0
	}
	fmt.Fprintf(stdout, "repair claimed posted time complete (%d rows repaired)\n", repaired)
	return 0
}

func upgrade(path string, dryRun bool) (int, error) {
	abs, err := filepath.Abs(path)
	if err != nil {
		return 0, err
	}
	info, err := os.Lstat(abs)
	if err != nil {
		return 0, err
	}
	if !info.Mode().IsRegular() {
		return 0, fmt.Errorf("database must be an existing regular file")
	}
	if _, err := os.Lstat(abs + "-journal"); err == nil {
		return 0, fmt.Errorf("database has a hot rollback journal; stop every writer and retry")
	}
	db, err := sql.Open("sqlite", abs)
	if err != nil {
		return 0, err
	}
	defer db.Close()
	rows, err := db.Query(`SELECT user_id, id, posted_time, transaction_time FROM transactions WHERE posted_time <= 0 AND pending = 0 AND void = 0`)
	if err != nil {
		return 0, err
	}
	type invalid struct {
		user, id string
		posted, transacted int64
	}
	var bad []invalid
	for rows.Next() {
		var row invalid
		if err := rows.Scan(&row.user, &row.id, &row.posted, &row.transacted); err != nil {
			rows.Close()
			return 0, err
		}
		if row.transacted <= 0 {
			rows.Close()
			return 0, fmt.Errorf("transaction %s has no valid transaction time; refusing to invent event times", row.id)
		}
		bad = append(bad, row)
	}
	if err := rows.Err(); err != nil {
		rows.Close()
		return 0, err
	}
	rows.Close()
	if dryRun {
		return len(bad), nil
	}
	if len(bad) == 0 {
		return 0, nil
	}
	tx, err := db.Begin()
	if err != nil {
		return 0, err
	}
	defer tx.Rollback()
	if _, err := tx.Exec(`PRAGMA foreign_keys=ON`); err != nil {
		return 0, err
	}
	if _, err := tx.Exec(`UPDATE transactions SET posted_time = transaction_time WHERE posted_time <= 0 AND pending = 0 AND void = 0 AND transaction_time > 0`); err != nil {
		return 0, err
	}
	var remaining int
	if err := tx.QueryRow(`SELECT COUNT(*) FROM transactions WHERE posted_time <= 0 AND pending = 0 AND void = 0`).Scan(&remaining); err != nil {
		return 0, err
	}
	if remaining != 0 {
		return 0, fmt.Errorf("%d settled rows still lack a posted instant; refusing to invent event times", remaining)
	}
	var integrity string
	if err := tx.QueryRow(`PRAGMA integrity_check`).Scan(&integrity); err != nil {
		return 0, err
	}
	if integrity != "ok" {
		return 0, fmt.Errorf("integrity check failed: %s", integrity)
	}
	var violations int
	if err := tx.QueryRow(`SELECT COUNT(*) FROM pragma_foreign_key_check`).Scan(&violations); err != nil {
		return 0, err
	}
	if violations != 0 {
		return 0, fmt.Errorf("foreign key violations: %d", violations)
	}
	if err := tx.Commit(); err != nil {
		return 0, err
	}
	return len(bad), nil
}
