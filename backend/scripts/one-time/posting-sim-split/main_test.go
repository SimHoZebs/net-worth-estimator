package main

import (
	"bytes"
	"database/sql"
	"os"
	"path/filepath"
	"reflect"
	"strings"
	"testing"

	"github.com/simhozebs/net-worth-estimator/backend/internal/store/adapters/sqlite"
)

const oldPostingsAmount = `{"resolver":"expression","config":{"expression":"50"},"inputs":{}}`

// oldShapeDatabase builds a pre-split database with raw SQL only, so the
// fixture never depends on the runtime store. It starts from a fresh setup,
// downgrades postings to the old shape, and seeds two users.
func oldShapeDatabase(t *testing.T) string {
	t.Helper()
	path := filepath.Join(t.TempDir(), "app.db")
	db, err := sqlite.SetupDatabase(path)
	if err != nil {
		t.Fatal(err)
	}
	defer db.Close()
	for _, statement := range []string{
		`ALTER TABLE postings RENAME COLUMN destination_account_ids TO destinations`,
		`ALTER TABLE postings ADD COLUMN position INTEGER NOT NULL DEFAULT 0`,
		`ALTER TABLE postings ADD COLUMN enabled INTEGER NOT NULL DEFAULT 1`,
		`ALTER TABLE postings ADD COLUMN execution_order INTEGER NOT NULL DEFAULT 0`,
		`ALTER TABLE postings ADD COLUMN fulfills_rule_id TEXT`,
		`ALTER TABLE postings ADD COLUMN fulfills_occurrence_date TEXT`,
		`ALTER TABLE postings ADD COLUMN receipt_ids TEXT NOT NULL DEFAULT '[]'`,
		`DROP TABLE posting_sim`,
		`DROP TABLE posting_claims`,
		`INSERT INTO users(id, issuer, subject) VALUES ('alice', 'https://issuer.test', 'alice'), ('bob', 'https://issuer.test', 'bob')`,
		`INSERT INTO accounts(user_id, id, position, name, kind, enabled) VALUES
			('alice', 'checking', 0, 'Checking', 'cash', 1),
			('alice', 'savings', 1, 'Savings', 'cash', 1),
			('bob', 'checking', 0, 'Checking', 'cash', 1)`,
		`INSERT INTO recurrence_rules(user_id, id, position, name, source_account_id, destinations, amount_resolution_json, frequency, start_date, priority, enabled) VALUES
			('alice', 'rule-a', 0, ' Subscription', 'checking', 'null', '` + oldPostingsAmount + `', 'monthly', '2026-01-01', 0, 1),
			('bob', 'rule-b', 0, 'Subscription', 'checking', 'null', '` + oldPostingsAmount + `', 'monthly', '2026-01-01', 0, 1)`,
		`INSERT INTO postings(user_id, id, name, source_account_id, destinations, amount_resolution_json, posted_time, transaction_time, source, pending, void, position, enabled, execution_order, fulfills_rule_id, fulfills_occurrence_date, receipt_ids) VALUES
			('alice', '01900000-0000-7000-8000-000000000001', 'Groceries', 'checking', '["savings"]', '` + oldPostingsAmount + `', 1769904000, 1769904000, 'user', 0, 0, 2, 1, 3, 'rule-a', '2026-02-01', '["rcpt-b", "rcpt-a"]'),
			('alice', '01900000-0000-7000-8000-000000000002', 'Rent', 'checking', 'null', '` + oldPostingsAmount + `', 1769904000, 1769904000, 'user', 0, 0, 0, 0, 0, NULL, NULL, '[]'),
			('alice', '01900000-0000-7000-8000-000000000003', 'Pending bank', 'checking', 'null', '` + oldPostingsAmount + `', 1769904000, 1769904000, 'simplefin', 1, 0, 1, 0, 5, NULL, NULL, '[]'),
			('bob', '01900000-0000-7000-8000-000000000004', 'Monitor', 'checking', '["checking"]', '` + oldPostingsAmount + `', 1769904000, 1769904000, 'user', 0, 0, 1, 1, 2, NULL, NULL, '[]'),
			('bob', '01900000-0000-7000-8000-000000000005', 'Subscription bill', 'checking', 'null', '` + oldPostingsAmount + `', 1769904000, 1769904000, 'user', 0, 0, 0, 1, 1, 'rule-b', '2026-02-01', '[]')`,
		`INSERT INTO blob_objects(key, state, expires_at) VALUES ('bk-a', 'live', 9999999999), ('bk-b', 'live', 9999999999)`,
		`INSERT INTO receipts(user_id, id, posting_id, digest, size, blob_key, revision, payload) VALUES
			('alice', 'rcpt-a', '01900000-0000-7000-8000-000000000001', 'd1', 100, 'bk-a', 1, '{}'),
			('alice', 'rcpt-b', '01900000-0000-7000-8000-000000000001', 'd2', 100, 'bk-b', 1, '{}')`,
	} {
		if _, err := db.SQL().Exec(statement); err != nil {
			t.Fatalf("fixture %q: %v", statement, err)
		}
	}
	return path
}

func queryStrings(t *testing.T, path, query string, args ...any) []string {
	t.Helper()
	db, err := sql.Open("sqlite", "file:"+path+"?mode=ro")
	if err != nil {
		t.Fatal(err)
	}
	defer db.Close()
	rows, err := db.Query(query, args...)
	if err != nil {
		t.Fatal(err)
	}
	defer rows.Close()
	var out []string
	for rows.Next() {
		var value string
		if err := rows.Scan(&value); err != nil {
			t.Fatal(err)
		}
		out = append(out, value)
	}
	if err := rows.Err(); err != nil {
		t.Fatal(err)
	}
	return out
}

func postingsColumns(t *testing.T, path string) []string {
	t.Helper()
	return queryStrings(t, path, `SELECT name FROM PRAGMA_TABLE_INFO('postings') ORDER BY cid`)
}

func TestUpgradeSplitsAllUsers(t *testing.T) {
	path := oldShapeDatabase(t)
	count, err := upgrade(path)
	if err != nil || count != 5 {
		t.Fatalf("upgrade: %d %v", count, err)
	}
	for _, column := range oldPostingColumns {
		for _, got := range postingsColumns(t, path) {
			if got == column {
				t.Fatalf("old column %s remains", column)
			}
		}
	}
	found := false
	for _, got := range postingsColumns(t, path) {
		if got == "destination_account_ids" {
			found = true
		}
	}
	if !found {
		t.Fatal("core column destination_account_ids missing")
	}
	if got := queryStrings(t, path, `SELECT user_id || '|' || posting_id || '|' || position || '|' || enabled || '|' || execution_order FROM posting_sim ORDER BY user_id, position`); !reflect.DeepEqual(got, []string{
		"alice|01900000-0000-7000-8000-000000000002|0|0|0",
		"alice|01900000-0000-7000-8000-000000000003|1|0|5",
		"alice|01900000-0000-7000-8000-000000000001|2|1|3",
		"bob|01900000-0000-7000-8000-000000000005|0|1|1",
		"bob|01900000-0000-7000-8000-000000000004|1|1|2",
	}) {
		t.Fatalf("posting_sim = %v", got)
	}
	if got := queryStrings(t, path, `SELECT user_id || '|' || posting_id || '|' || fulfills_rule_id || '|' || fulfills_occurrence_date FROM posting_claims ORDER BY user_id, posting_id`); !reflect.DeepEqual(got, []string{
		"alice|01900000-0000-7000-8000-000000000001|rule-a|2026-02-01",
		"bob|01900000-0000-7000-8000-000000000005|rule-b|2026-02-01",
	}) {
		t.Fatalf("posting_claims = %v", got)
	}
	if got := queryStrings(t, path, `SELECT name || '|' || source_account_id || '|' || destination_account_ids || '|' || source || '|' || pending || '|' || void FROM postings WHERE user_id = 'alice' ORDER BY id`); !reflect.DeepEqual(got, []string{
		"Groceries|checking|[\"savings\"]|user|0|0",
		"Rent|checking|null|user|0|0",
		"Pending bank|checking|null|simplefin|1|0",
	}) {
		t.Fatalf("core postings changed: %v", got)
	}
	if got := queryStrings(t, path, `SELECT id FROM receipts WHERE user_id = 'alice' AND posting_id = '01900000-0000-7000-8000-000000000001' ORDER BY id`); !reflect.DeepEqual(got, []string{"rcpt-a", "rcpt-b"}) {
		t.Fatalf("receipts changed: %v", got)
	}
	schema := queryStrings(t, path, `SELECT COALESCE(sql, '') FROM sqlite_master ORDER BY type, name`)
	counts := queryStrings(t, path, `SELECT (SELECT COUNT(*) FROM postings) || '/' || (SELECT COUNT(*) FROM posting_sim) || '/' || (SELECT COUNT(*) FROM posting_claims) || '/' || (SELECT COUNT(*) FROM receipts)`)
	if count, err := upgrade(path); err != nil || count != 0 {
		t.Fatalf("repeat upgrade: %d %v", count, err)
	}
	if got := queryStrings(t, path, `SELECT COALESCE(sql, '') FROM sqlite_master ORDER BY type, name`); !reflect.DeepEqual(got, schema) {
		t.Fatal("repeat upgrade changed schema")
	}
	if got := queryStrings(t, path, `SELECT (SELECT COUNT(*) FROM postings) || '/' || (SELECT COUNT(*) FROM posting_sim) || '/' || (SELECT COUNT(*) FROM posting_claims) || '/' || (SELECT COUNT(*) FROM receipts)`); !reflect.DeepEqual(got, counts) {
		t.Fatal("repeat upgrade changed rows")
	}
}

func TestUpgradeFailureRollsBackAllUsers(t *testing.T) {
	for _, tc := range []struct {
		name     string
		mutation string
	}{
		{name: "receipt-extra", mutation: `UPDATE postings SET receipt_ids = '["rcpt-a", "rcpt-b", "rcpt-missing"]' WHERE user_id = 'alice' AND id = '01900000-0000-7000-8000-000000000001'`},
		{name: "receipt-missing", mutation: `UPDATE postings SET receipt_ids = '[]' WHERE user_id = 'alice' AND id = '01900000-0000-7000-8000-000000000001'`},
		{name: "receipt-duplicate", mutation: `UPDATE postings SET receipt_ids = '["rcpt-a", "rcpt-a"]' WHERE user_id = 'alice' AND id = '01900000-0000-7000-8000-000000000001'`},
		{name: "receipt-corrupt", mutation: `UPDATE postings SET receipt_ids = '[broken' WHERE user_id = 'alice' AND id = '01900000-0000-7000-8000-000000000001'`},
		{name: "partial-shape", mutation: `ALTER TABLE postings DROP COLUMN receipt_ids`},
		{name: "mixed-shape", mutation: `ALTER TABLE postings RENAME COLUMN destinations TO destination_account_ids`},
		{name: "half-claim", mutation: `UPDATE postings SET fulfills_rule_id = NULL WHERE user_id = 'alice' AND id = '01900000-0000-7000-8000-000000000001'`},
		{name: "orphan-claim", mutation: `UPDATE postings SET fulfills_rule_id = 'missing-rule' WHERE user_id = 'bob' AND id = '01900000-0000-7000-8000-000000000004'`},
		{name: "bad-destinations", mutation: `UPDATE postings SET destinations = '{"to": "savings"}' WHERE user_id = 'bob' AND id = '01900000-0000-7000-8000-000000000004'`},
		{name: "bad-enabled", mutation: `UPDATE postings SET enabled = 2 WHERE user_id = 'bob' AND id = '01900000-0000-7000-8000-000000000004'`},
	} {
		t.Run(tc.name, func(t *testing.T) {
			path := oldShapeDatabase(t)
			db, err := sql.Open("sqlite", "file:"+path+"?mode=rw")
			if err != nil {
				t.Fatal(err)
			}
			if _, err := db.Exec(tc.mutation); err != nil {
				db.Close()
				t.Fatal(err)
			}
			db.Close()
			before := append(postingsColumns(t, path), queryStrings(t, path, `SELECT COALESCE(sql, '') FROM sqlite_master ORDER BY type, name`)...)
			if _, err := upgrade(path); err == nil {
				t.Fatal("unsafe split succeeded")
			}
			after := append(postingsColumns(t, path), queryStrings(t, path, `SELECT COALESCE(sql, '') FROM sqlite_master ORDER BY type, name`)...)
			if !reflect.DeepEqual(before, after) {
				t.Fatal("failed split changed schema")
			}
			var count int
			ro, err := sql.Open("sqlite", "file:"+path+"?mode=ro")
			if err != nil {
				t.Fatal(err)
			}
			defer ro.Close()
			if err := ro.QueryRow(`SELECT COUNT(*) FROM postings`).Scan(&count); err != nil || count != 5 {
				t.Fatalf("failed split changed postings: %d, %v", count, err)
			}
		})
	}
}

func TestUpgradeRejectsPartialSatellites(t *testing.T) {
	path := oldShapeDatabase(t)
	db, err := sql.Open("sqlite", "file:"+path+"?mode=rw")
	if err != nil {
		t.Fatal(err)
	}
	if _, err := db.Exec(postingSimSchema); err != nil {
		db.Close()
		t.Fatal(err)
	}
	if _, err := db.Exec(`INSERT INTO posting_sim(user_id, posting_id, position, enabled, execution_order) VALUES ('alice', '01900000-0000-7000-8000-000000000002', 0, 0, 0)`); err != nil {
		db.Close()
		t.Fatal(err)
	}
	db.Close()
	if _, err := upgrade(path); err == nil {
		t.Fatal("partial split succeeded")
	}
}

func TestRequiresExplicitExistingDatabase(t *testing.T) {
	path := filepath.Join(t.TempDir(), "missing.db")
	t.Setenv("NET_WORTH_ESTIMATOR_DB", path)
	for _, args := range [][]string{nil, {"--db", ""}, {"--db", " "}, {"unexpected"}} {
		var out, errOut bytes.Buffer
		if code := run(args, &out, &errOut); code != 2 || out.Len() != 0 || !strings.Contains(errOut.String(), "--db") {
			t.Fatalf("code=%d out=%q err=%q", code, out.String(), errOut.String())
		}
	}
	var out, errOut bytes.Buffer
	if code := run([]string{"--db", path}, &out, &errOut); code != 1 || out.Len() != 0 {
		t.Fatalf("missing database: %d %q %q", code, out.String(), errOut.String())
	}
	if _, err := os.Stat(path); !os.IsNotExist(err) {
		t.Fatal("script created a missing database", err)
	}
	actual := oldShapeDatabase(t)
	link := filepath.Join(t.TempDir(), "link.db")
	if err := os.Symlink(actual, link); err != nil {
		t.Fatal(err)
	}
	if _, err := upgrade(link); err == nil {
		t.Fatal("script followed a symlink")
	}
	if err := os.Symlink(actual, actual+"-wal"); err != nil {
		t.Fatal(err)
	}
	if _, err := upgrade(actual); err == nil {
		t.Fatal("script followed a sidecar symlink")
	}
}
