package main

import (
	"database/sql"
	"path/filepath"
	"strings"
	"testing"

	"github.com/simhozebs/net-worth-estimator/backend/internal/store/adapters/sqlite"
	"github.com/simhozebs/net-worth-estimator/backend/internal/types"
)

// legacyShape turns a fresh current-schema database into a source from before
// this one-time upgrade: the retired household setting and per-card cycle start
// are back, and the account-level closing day is absent.
func legacyShape(t *testing.T, db *sqlite.Database) {
	t.Helper()
	sqlDB := db.SQL()
	statements := []string{
		`ALTER TABLE accounts DROP COLUMN statement_closing_day`,
		`ALTER TABLE payment_terms ADD COLUMN statement_day INTEGER`,
		`DELETE FROM schema_migrations WHERE name = 'statement-closing-day-v1'`,
	}
	for _, statement := range statements {
		if _, err := sqlDB.Exec(statement); err != nil {
			t.Fatalf("legacy shape %q: %v", statement, err)
		}
	}
}

func seedUser(t *testing.T, db *sqlite.Database, user string) {
	t.Helper()
	scoped, err := db.EnsureUser(user, "https://issuer.test", user)
	if err != nil {
		t.Fatal(err)
	}
	for _, id := range []string{"card-a", "card-b", "card-c", "card-no-terms"} {
		if _, err := scoped.CreateAccount(types.Account{ID: id, Name: id, Kind: types.AccountKindDebt, Enabled: true}); err != nil {
			t.Fatal(err)
		}
	}
}

func closingDays(t *testing.T, path string) map[string]int {
	t.Helper()
	verify, err := sqlite.OpenDatabase(path)
	if err != nil {
		t.Fatal(err)
	}
	defer verify.Close()
	rows, err := verify.SQL().Query(`SELECT id, statement_closing_day FROM accounts ORDER BY id`)
	if err != nil {
		t.Fatal(err)
	}
	defer rows.Close()
	got := map[string]int{}
	for rows.Next() {
		var id string
		var day int
		if err := rows.Scan(&id, &day); err != nil {
			t.Fatal(err)
		}
		got[id] = day
	}
	return got
}

func TestClosingDayPrecedesCycleStart(t *testing.T) {
	cases := map[int]int{1: 31, 2: 1, 15: 14, 20: 19, 28: 27}
	for start, want := range cases {
		if got := closingDay(start); got != want {
			t.Fatalf("closingDay(%d) = %d, want %d", start, got, want)
		}
	}
}

func TestUpgradePreservesAuthoredCardDayAndCoversEveryAccount(t *testing.T) {
	path := filepath.Join(t.TempDir(), "app.db")
	db, err := sqlite.SetupDatabase(path)
	if err != nil {
		t.Fatal(err)
	}
	seedUser(t, db, "alice")
	legacyShape(t, db)
	sqlDB := db.SQL()
	if _, err := sqlDB.Exec(`INSERT INTO safe_spending_settings (user_id, id, settings_json) VALUES ('alice', 1, '{"statementDay":22,"statementDaySet":true,"reserve":100}')`); err != nil {
		t.Fatal(err)
	}
	terms := []struct {
		id  string
		day interface{}
	}{{"card-a", nil}, {"card-b", 15}, {"card-c", 1}}
	for _, term := range terms {
		if _, err := sqlDB.Exec(`INSERT INTO payment_terms (user_id, model_account_id, position, minimum_fixed, due_day, statement_day) VALUES ('alice', ?, 0, 25, 10, ?)`, term.id, term.day); err != nil {
			t.Fatal(err)
		}
	}
	if err := db.Close(); err != nil {
		t.Fatal(err)
	}

	result, err := upgrade(path)
	if err != nil {
		t.Fatal(err)
	}
	if result.Rows != 4 || result.Updated != 1 {
		t.Fatalf("result = %+v, want 4 accounts and 1 settings rewrite", result)
	}
	got := closingDays(t, path)
	for id, want := range map[string]int{
		"card-a":        21, // no authored day: household start 22 -> prior day
		"card-b":        15, // authored statement day preserved unchanged
		"card-c":        1,  // authored statement day preserved unchanged
		"card-no-terms": 21, // selected card with no terms still covered
	} {
		if got[id] != want {
			t.Fatalf("account %s closing day = %d, want %d", id, got[id], want)
		}
	}
	verify, err := sqlite.OpenDatabase(path)
	if err != nil {
		t.Fatal(err)
	}
	defer verify.Close()
	var raw string
	if err := verify.SQL().QueryRow(`SELECT settings_json FROM safe_spending_settings WHERE user_id = 'alice' AND id = 1`).Scan(&raw); err != nil {
		t.Fatal(err)
	}
	if strings.Contains(raw, `"statementDay"`) || strings.Contains(raw, `"statementDaySet"`) || !strings.Contains(raw, `"reserve":100`) {
		t.Fatalf("settings_json = %s", raw)
	}
	if _, err := upgrade(path); err != nil {
		t.Fatalf("second upgrade must be a no-op: %v", err)
	}
}

func TestUpgradeWrapsHouseholdStartOneToMonthEnd(t *testing.T) {
	path := filepath.Join(t.TempDir(), "app.db")
	db, err := sqlite.SetupDatabase(path)
	if err != nil {
		t.Fatal(err)
	}
	seedUser(t, db, "alice")
	legacyShape(t, db)
	if _, err := db.SQL().Exec(`INSERT INTO safe_spending_settings (user_id, id, settings_json) VALUES ('alice', 1, '{"statementDay":1,"statementDaySet":true}')`); err != nil {
		t.Fatal(err)
	}
	if err := db.Close(); err != nil {
		t.Fatal(err)
	}
	if _, err := upgrade(path); err != nil {
		t.Fatal(err)
	}
	if got := closingDays(t, path)["card-a"]; got != 31 {
		t.Fatalf("household start 1 should close on month end 31, got %d", got)
	}
}

func TestUpgradeDefaultsToNineteenWithoutHouseholdSetting(t *testing.T) {
	path := filepath.Join(t.TempDir(), "app.db")
	db, err := sqlite.SetupDatabase(path)
	if err != nil {
		t.Fatal(err)
	}
	seedUser(t, db, "alice")
	legacyShape(t, db)
	if err := db.Close(); err != nil {
		t.Fatal(err)
	}
	if _, err := upgrade(path); err != nil {
		t.Fatal(err)
	}
	if got := closingDays(t, path)["card-no-terms"]; got != defaultClosing {
		t.Fatalf("closing day = %d, want %d", got, defaultClosing)
	}
}

func TestUpgradeRejectsInvalidCycleStart(t *testing.T) {
	for _, tc := range []struct {
		name     string
		settings string
		day      interface{}
	}{
		{"card start", `{}`, 99},
		{"household start", `{"statementDay":0,"statementDaySet":true}`, nil},
	} {
		t.Run(tc.name, func(t *testing.T) {
			path := filepath.Join(t.TempDir(), "app.db")
			db, err := sqlite.SetupDatabase(path)
			if err != nil {
				t.Fatal(err)
			}
			seedUser(t, db, "alice")
			legacyShape(t, db)
			if _, err := db.SQL().Exec(`INSERT INTO safe_spending_settings (user_id, id, settings_json) VALUES ('alice', 1, ?)`, tc.settings); err != nil {
				t.Fatal(err)
			}
			if _, err := db.SQL().Exec(`INSERT INTO payment_terms (user_id, model_account_id, position, minimum_fixed, due_day, statement_day) VALUES ('alice', 'card-a', 0, 25, 10, ?)`, tc.day); err != nil {
				t.Fatal(err)
			}
			if err := db.Close(); err != nil {
				t.Fatal(err)
			}
			if _, err := upgrade(path); err == nil {
				t.Fatal("expected invalid cycle start to fail closed")
			}
			verify, err := sql.Open("sqlite", path)
			if err != nil {
				t.Fatal(err)
			}
			defer verify.Close()
			if legacy, err := columnExists(verify, "payment_terms", "statement_day"); err != nil || !legacy {
				t.Fatalf("failed upgrade must leave the source untouched: legacy=%v err=%v", legacy, err)
			}
		})
	}
}
