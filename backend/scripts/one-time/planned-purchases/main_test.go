package main

import (
	"bytes"
	"context"
	"database/sql"
	"errors"
	"os"
	"path/filepath"
	"reflect"
	"strings"
	"testing"

	"github.com/simhozebs/net-worth-estimator/backend/internal/store/adapters/sqlite"
	"github.com/simhozebs/net-worth-estimator/backend/internal/types"
)

const policySchema = `CREATE TABLE purchase_policies (
	user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
	posting_id TEXT NOT NULL, priority INTEGER NOT NULL,
	PRIMARY KEY(user_id, posting_id),
	FOREIGN KEY(user_id, posting_id) REFERENCES postings(user_id, id) ON DELETE CASCADE
)`

func policyDatabase(t *testing.T, bad, evidence bool) string {
	t.Helper()
	path := filepath.Join(t.TempDir(), "app.db")
	db, err := sqlite.SetupDatabase(path)
	if err != nil {
		t.Fatal(err)
	}
	defer db.Close()
	if _, err := db.SQL().Exec(policySchema); err != nil {
		t.Fatal(err)
	}
	account := "checking"
	for _, user := range []string{"alice", "bob"} {
		s, err := db.EnsureUser(user, "https://issuer.test", user)
		if err != nil {
			t.Fatal(err)
		}
		if _, err := s.CreateAccount(types.Account{ID: account, Name: "Checking", Kind: "cash", Enabled: true}); err != nil {
			t.Fatal(err)
		}
		for i, name := range []string{user + " laptop", "Established payment", user + " monitor"} {
			id := []string{"01900000-0000-7000-8000-000000000001", "01900000-0000-7000-8000-000000000002", "01900000-0000-7000-8000-000000000003"}[i]
			p := types.Posting{ID: id, Name: name, SourceAccountID: &account, PostedTime: 1769904000, TransactionTime: 1769904000, Enabled: true,
				Amount: types.PostingAmountResolution{Resolver: "expression", Config: map[string]any{"expression": "500.25"}}}
			if i == 0 && bad && user == "bob" {
				p.Amount.Config["expression"] = "not a fixed cost"
			}
			if i == 2 {
				p.Amount.Config["expression"] = "50"
				p.Enabled, p.TransactionTime, p.PostedTime = false, 0, 1769990400
			}
			if _, err := s.CreatePosting(p); err != nil {
				t.Fatal(err)
			}
			if i == 0 && evidence && user == "bob" {
				if _, err := s.CreateReceipt(context.Background(), p.ID, "evidence.png", types.ReceiptImage{Bytes: []byte("image"), MediaType: "image/png"}); err != nil {
					t.Fatal(err)
				}
			}
			if i == 1 {
				continue
			}
			priority := 7
			if i == 2 {
				priority = 2
			}
			if _, err := db.SQL().Exec(`INSERT INTO purchase_policies(posting_id, priority, user_id) VALUES (?, ?, ?)`, p.ID, priority, user); err != nil {
				t.Fatal(err)
			}
		}
	}
	if _, err := db.SQL().Exec(`DROP TABLE planned_purchases`); err != nil {
		t.Fatal(err)
	}
	return path
}

func TestUpgradePreservesBothUsers(t *testing.T) {
	path := policyDatabase(t, false, false)
	count, err := upgrade(path)
	if err != nil || count != 4 {
		t.Fatalf("upgrade: %d %v", count, err)
	}
	db, err := sqlite.OpenDatabase(path)
	if err != nil {
		t.Fatal(err)
	}
	before := map[string][]types.PlannedPurchase{}
	for _, user := range []string{"alice", "bob"} {
		s, err := db.User(user)
		if err != nil {
			t.Fatal(err)
		}
		doc, err := s.LoadModel()
		if err != nil || len(doc.Postings) != 1 || len(doc.PlannedPurchases) != 2 {
			t.Fatalf("upgrade: %+v %v", doc, err)
		}
		p := doc.PlannedPurchases[1]
		if p.ID != "01900000-0000-7000-8000-000000000001" || p.Name != user+" laptop" || p.Cost != 500.25 || p.EarliestDate != "2026-02-01" || p.Priority != 7 || p.FundingAccountID == nil || *p.FundingAccountID != "checking" || !p.Enabled {
			t.Fatalf("values changed: %+v", p)
		}
		p = doc.PlannedPurchases[0]
		if p.ID != "01900000-0000-7000-8000-000000000003" || p.Name != user+" monitor" || p.Cost != 50 || p.EarliestDate != "2026-02-02" || p.Priority != 2 || p.FundingAccountID == nil || *p.FundingAccountID != "checking" || p.Enabled {
			t.Fatalf("disabled purchase or fallback date changed: %+v", p)
		}
		before[user] = doc.PlannedPurchases
	}
	if err := db.SQL().QueryRow(`SELECT COUNT(*) FROM sqlite_master WHERE name='purchase_policies'`).Scan(&count); err != nil || count != 0 {
		t.Fatal("retired table remains", err)
	}
	if err := db.SQL().QueryRow(`SELECT COUNT(*) FROM entity_ids WHERE kind='planned-purchase'`).Scan(&count); err != nil || count != 4 {
		t.Fatal("purchase identities lost", err)
	}
	db.Close()
	if count, err := upgrade(path); err != nil || count != 0 {
		t.Fatalf("repeat upgrade: %d %v", count, err)
	}
	db, err = sqlite.SetupDatabase(path)
	if err != nil {
		t.Fatal(err)
	}
	defer db.Close()
	for user, want := range before {
		s, _ := db.User(user)
		doc, err := s.LoadModel()
		if err != nil || !reflect.DeepEqual(doc.PlannedPurchases, want) {
			t.Fatal("repeated upgrade changed purchases", err)
		}
	}
}

func TestAppAndSetupRejectPolicySchemaWithoutChanges(t *testing.T) {
	path := policyDatabase(t, false, false)
	if err := os.Chmod(path, 0640); err != nil {
		t.Fatal(err)
	}
	before, err := os.ReadFile(path)
	if err != nil {
		t.Fatal(err)
	}
	for _, open := range []func(string, ...sqlite.DatabaseOption) (*sqlite.Database, error){sqlite.OpenDatabase, sqlite.SetupDatabase} {
		if db, err := open(path); !errors.Is(err, sqlite.ErrSetupRequired) {
			if db != nil {
				db.Close()
			}
			t.Fatalf("old purchase schema accepted: %v", err)
		}
		after, err := os.ReadFile(path)
		if err != nil || !bytes.Equal(before, after) {
			t.Fatal("rejected schema changed", err)
		}
		info, err := os.Stat(path)
		if err != nil || info.Mode().Perm() != 0640 {
			t.Fatal("rejected schema changed permissions", err)
		}
	}
}

func TestUpgradeFailureRollsBackAllUsers(t *testing.T) {
	for _, tc := range []struct {
		name          string
		bad, evidence bool
		mutation      string
	}{
		{name: "invalid-cost", bad: true},
		{name: "attached-evidence", evidence: true},
		{name: "identity-conflict", mutation: `UPDATE entity_ids SET kind = 'account' WHERE user_id = 'bob' AND id = '01900000-0000-7000-8000-000000000001'`},
		{name: "analysis-evidence", mutation: `INSERT INTO transaction_source_facts(user_id, posting_id, facts_json) VALUES ('bob', '01900000-0000-7000-8000-000000000001', '{}')`},
	} {
		t.Run(tc.name, func(t *testing.T) {
			path := policyDatabase(t, tc.bad, tc.evidence)
			if tc.mutation != "" {
				db, err := sql.Open("sqlite", path)
				if err != nil {
					t.Fatal(err)
				}
				_, err = db.Exec(tc.mutation)
				db.Close()
				if err != nil {
					t.Fatal(err)
				}
			}
			if _, err := upgrade(path); err == nil {
				t.Fatal("unsafe upgrade succeeded")
			}
			db, err := sql.Open("sqlite", "file:"+path+"?mode=ro")
			if err != nil {
				t.Fatal(err)
			}
			defer db.Close()
			var count int
			for query, want := range map[string]int{
				`SELECT COUNT(*) FROM purchase_policies`:                            4,
				`SELECT COUNT(*) FROM postings`:                                     6,
				`SELECT COUNT(*) FROM sqlite_master WHERE name='planned_purchases'`: 0,
			} {
				if err := db.QueryRow(query).Scan(&count); err != nil || count != want {
					t.Fatalf("failed upgrade changed data: %s = %d, %v", query, count, err)
				}
			}
		})
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
	actual := policyDatabase(t, false, false)
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
