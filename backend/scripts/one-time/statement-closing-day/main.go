// This standalone, one-time operator script reconciles the retired
// household-wide safe-spending cycle start and the optional per-card statement
// day into one authoritative account-level statement closing day. Neither the
// server nor setupdb calls it. The deployment migration body runs it inside
// its verified candidate copy.
//
// The retired household setting lived in safe_spending_settings.settings_json
// as "statementDay" (a cycle START day, 1..28) plus "statementDaySet". A
// statement closes on the day before its cycle starts, so that value moves
// back by one day (day 1 wraps to 31, the month end), with a cycle start of 20
// giving the default closing day 19.
//
// The optional payment_terms.statement_day was labelled only "Statement day"
// in the old card editor and was never consumed as a cycle anchor anywhere in
// the model or calculations. An explicitly authored number is therefore an
// actual statement day and is preserved unchanged. Every account, including a
// selected card with no payment terms at all, receives a closing day: authored
// card value first, then the household-derived day, then 19. The tool removes
// the retired keys from the settings blob and drops the retired terms column
// so one account property remains.
//
// The tool is idempotent: a schema_migrations marker distinguishes a converted
// source from an unconverted one, and a converted source is only verified.
package main

import (
	"database/sql"
	"encoding/json"
	"flag"
	"fmt"
	"io"
	"os"
	"path/filepath"
	"strings"

	_ "modernc.org/sqlite"
)

const (
	marker         = "statement-closing-day-v1"
	defaultStart   = 20 // retired DEFAULT_CYCLE_STATEMENT_DAY
	defaultClosing = 19 // defaultStart - 1
)

type counts struct {
	Users   int
	Rows    int
	Updated int
}

func main() { os.Exit(run(os.Args[1:], os.Stdout, os.Stderr)) }

func run(args []string, stdout, stderr io.Writer) int {
	flags := flag.NewFlagSet("statement-closing-day", flag.ContinueOnError)
	flags.SetOutput(stderr)
	dbPath := flags.String("db", "", "existing SQLite database to upgrade in place, with the app stopped")
	if err := flags.Parse(args); err != nil {
		return 2
	}
	if strings.TrimSpace(*dbPath) == "" || flags.NArg() != 0 {
		fmt.Fprintln(stderr, "usage: go run ./scripts/one-time/statement-closing-day --db PATH")
		return 2
	}
	result, err := upgrade(*dbPath)
	if err != nil {
		fmt.Fprintf(stderr, "statement closing day upgrade: %v\n", err)
		return 1
	}
	fmt.Fprintf(stdout, "statement closing day upgrade complete (%d users, %d accounts, %d rewritten settings)\n",
		result.Users, result.Rows, result.Updated)
	return 0
}

// closingDay maps a retired household cycle start day to the day the statement
// closes. Day 1 has no prior day in the month, so it wraps to 31 (month end).
func closingDay(start int) int {
	if start == 1 {
		return 31
	}
	return start - 1
}

type household struct {
	start int
	set   bool
}

// parseHousehold extracts the retired keys from one settings blob. Unknown
// keys survive; the retired keys are removed from the returned document.
func parseHousehold(raw string) (household, string, error) {
	result := household{start: defaultStart}
	var doc map[string]json.RawMessage
	if err := json.Unmarshal([]byte(raw), &doc); err != nil {
		return result, "", fmt.Errorf("invalid settings JSON: %w", err)
	}
	if doc == nil {
		doc = map[string]json.RawMessage{}
	}
	for key, value := range doc {
		switch key {
		case "statementDaySet":
			var set bool
			if err := json.Unmarshal(value, &set); err != nil || string(value) == "null" {
				return result, "", fmt.Errorf("statementDaySet must be a boolean")
			}
			result.set = set
		case "statementDay":
			var day int
			if err := json.Unmarshal(value, &day); err != nil || string(value) == "null" {
				return result, "", fmt.Errorf("statementDay must be an integer")
			}
			if day < 1 || day > 28 {
				return result, "", fmt.Errorf("statementDay %d outside 1..28", day)
			}
			result.start = day
		}
	}
	delete(doc, "statementDay")
	delete(doc, "statementDaySet")
	clean, err := json.Marshal(doc)
	if err != nil {
		return result, "", err
	}
	return result, string(clean), nil
}

func columnExists(db *sql.DB, table, column string) (bool, error) {
	var count int
	err := db.QueryRow(`SELECT COUNT(*) FROM pragma_table_info(?) WHERE name = ?`, table, column).Scan(&count)
	return count > 0, err
}

func markerExists(db *sql.DB) (bool, error) {
	var count int
	err := db.QueryRow(`SELECT COUNT(*) FROM schema_migrations WHERE name = ?`, marker).Scan(&count)
	return count > 0, err
}

// upgrade converts legacy sources and verifies already-converted ones. Every
// mutation runs in one transaction on the supplied candidate; a failed
// postcondition rolls the candidate back without touching the backup.
func upgrade(path string) (counts, error) {
	var result counts
	abs, err := filepath.Abs(path)
	if err != nil {
		return result, err
	}
	if info, err := os.Lstat(abs); err != nil {
		return result, err
	} else if !info.Mode().IsRegular() {
		return result, fmt.Errorf("database must be an existing regular file")
	}
	if _, err := os.Lstat(abs + "-journal"); err == nil {
		return result, fmt.Errorf("database has a hot rollback journal; stop every writer and retry")
	} else if !os.IsNotExist(err) {
		return result, err
	}
	db, err := sql.Open("sqlite", abs)
	if err != nil {
		return result, err
	}
	defer db.Close()
	if err := db.Ping(); err != nil {
		return result, err
	}

	hasAccountColumn, err := columnExists(db, "accounts", "statement_closing_day")
	if err != nil {
		return result, err
	}
	hasLegacyColumn, err := columnExists(db, "payment_terms", "statement_day")
	if err != nil {
		return result, err
	}
	if hasAccountColumn == hasLegacyColumn {
		return result, fmt.Errorf("exactly one source must be present (accounts=%v terms=%v)", hasAccountColumn, hasLegacyColumn)
	}
	marked, err := markerExists(db)
	if err != nil {
		return result, err
	}
	if hasAccountColumn && !marked {
		return result, fmt.Errorf("accounts carry statement_closing_day without the %s marker", marker)
	}
	if hasLegacyColumn && marked {
		return result, fmt.Errorf("legacy statement_day column survives on a marked database")
	}
	legacy := hasLegacyColumn

	// Phase one is read-only: parse and validate every user before any write.
	type userPlan struct {
		id      string
		clean   string
		start   int
		updates map[string]int // account id -> closing day
	}
	users, err := listUsers(db)
	if err != nil {
		return result, err
	}
	result.Users = len(users)
	plans := make([]userPlan, 0, len(users))
	for _, id := range users {
		plan := userPlan{id: id, start: defaultStart, updates: map[string]int{}}
		if legacy {
			raw, _, err := readSettings(db, id)
			if err != nil {
				return result, err
			}
			house, clean, err := parseHousehold(raw)
			if err != nil {
				return result, fmt.Errorf("user %s: %w", id, err)
			}
			plan.clean, plan.start = clean, house.start
			if !house.set {
				plan.start = defaultStart
			}
			authored, err := authoredDays(db, id)
			if err != nil {
				return result, err
			}
			accounts, err := listAccounts(db, id)
			if err != nil {
				return result, err
			}
			for _, accountID := range accounts {
				if day, ok := authored[accountID]; ok {
					plan.updates[accountID] = day
				} else {
					plan.updates[accountID] = closingDay(plan.start)
				}
			}
		}
		result.Rows += len(plan.updates)
		plans = append(plans, plan)
	}
	if !legacy {
		if err := verifyConverted(db); err != nil {
			return result, err
		}
		return result, nil
	}

	tx, err := db.Begin()
	if err != nil {
		return result, err
	}
	defer tx.Rollback()
	if _, err := tx.Exec(`ALTER TABLE accounts ADD COLUMN statement_closing_day INTEGER`); err != nil {
		return result, err
	}
	for _, plan := range plans {
		for accountID, day := range plan.updates {
			res, err := tx.Exec(`UPDATE accounts SET statement_closing_day = ? WHERE user_id = ? AND id = ?`, day, plan.id, accountID)
			if err != nil {
				return result, err
			}
			affected, err := res.RowsAffected()
			if err != nil || affected != 1 {
				return result, fmt.Errorf("user %s account %s: updated %d rows", plan.id, accountID, affected)
			}
		}
		res, err := tx.Exec(`UPDATE safe_spending_settings SET settings_json = ? WHERE user_id = ? AND id = 1`, plan.clean, plan.id)
		if err != nil {
			return result, err
		}
		if affected, err := res.RowsAffected(); err != nil {
			return result, err
		} else if affected > 0 {
			result.Updated++
		}
	}
	if _, err := tx.Exec(`ALTER TABLE payment_terms DROP COLUMN statement_day`); err != nil {
		return result, err
	}
	if err := verifyCandidate(tx); err != nil {
		return result, err
	}
	if _, err := tx.Exec(`INSERT OR IGNORE INTO schema_migrations(name) VALUES (?)`, marker); err != nil {
		return result, err
	}
	if err := tx.Commit(); err != nil {
		return result, err
	}
	return result, nil
}

func listUsers(db *sql.DB) ([]string, error) {
	rows, err := db.Query(`SELECT id FROM users ORDER BY id`)
	if err != nil {
		return nil, err
	}
	defer rows.Close()
	var ids []string
	for rows.Next() {
		var id string
		if err := rows.Scan(&id); err != nil {
			return nil, err
		}
		ids = append(ids, id)
	}
	return ids, rows.Err()
}

func listAccounts(db *sql.DB, userID string) ([]string, error) {
	rows, err := db.Query(`SELECT id FROM accounts WHERE user_id = ? ORDER BY id`, userID)
	if err != nil {
		return nil, err
	}
	defer rows.Close()
	var ids []string
	for rows.Next() {
		var id string
		if err := rows.Scan(&id); err != nil {
			return nil, err
		}
		ids = append(ids, id)
	}
	return ids, rows.Err()
}

// authoredDays reads explicit per-card statement days. The value is an actual
// statement day, so it carries over unchanged.
func authoredDays(db *sql.DB, userID string) (map[string]int, error) {
	rows, err := db.Query(`SELECT model_account_id, statement_day FROM payment_terms WHERE user_id = ? ORDER BY model_account_id`, userID)
	if err != nil {
		return nil, err
	}
	defer rows.Close()
	out := map[string]int{}
	for rows.Next() {
		var accountID string
		var day sql.NullInt64
		if err := rows.Scan(&accountID, &day); err != nil {
			return nil, err
		}
		if !day.Valid {
			continue
		}
		if day.Int64 < 1 || day.Int64 > 28 {
			return nil, fmt.Errorf("user %s card %s: statement_day %d outside 1..28", userID, accountID, day.Int64)
		}
		out[accountID] = int(day.Int64)
	}
	return out, rows.Err()
}

func readSettings(db *sql.DB, userID string) (string, bool, error) {
	var raw string
	err := db.QueryRow(`SELECT settings_json FROM safe_spending_settings WHERE user_id = ? AND id = 1`, userID).Scan(&raw)
	if err == sql.ErrNoRows {
		return "{}", false, nil
	}
	return raw, err == nil, err
}

func verifyConverted(db *sql.DB) error {
	var bad int
	if err := db.QueryRow(`SELECT COUNT(*) FROM accounts WHERE statement_closing_day IS NULL OR statement_closing_day < 1 OR statement_closing_day > 31`).Scan(&bad); err != nil {
		return err
	}
	if bad != 0 {
		return fmt.Errorf("%d accounts carry an invalid closing day", bad)
	}
	users, err := listUsers(db)
	if err != nil {
		return err
	}
	for _, id := range users {
		raw, found, err := readSettings(db, id)
		if err != nil {
			return err
		}
		if found && (strings.Contains(raw, `"statementDay"`) || strings.Contains(raw, `"statementDaySet"`)) {
			return fmt.Errorf("user %s: retired household cycle start survived in settings", id)
		}
	}
	return nil
}

func verifyCandidate(tx *sql.Tx) error {
	var bad int
	if err := tx.QueryRow(`SELECT COUNT(*) FROM accounts WHERE statement_closing_day IS NULL OR statement_closing_day < 1 OR statement_closing_day > 31`).Scan(&bad); err != nil {
		return err
	}
	if bad != 0 {
		return fmt.Errorf("%d accounts carry an invalid closing day", bad)
	}
	if legacy, err := columnExistsTx(tx, "payment_terms", "statement_day"); err != nil {
		return err
	} else if legacy {
		return fmt.Errorf("retired statement_day column survived the conversion")
	}
	return nil
}

func columnExistsTx(tx *sql.Tx, table, column string) (bool, error) {
	var count int
	err := tx.QueryRow(`SELECT COUNT(*) FROM pragma_table_info(?) WHERE name = ?`, table, column).Scan(&count)
	return count > 0, err
}
