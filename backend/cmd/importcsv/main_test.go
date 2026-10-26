package main

import (
	"bytes"
	"database/sql"
	"encoding/json"
	"os"
	"path/filepath"
	"reflect"
	"sort"
	"strings"
	"testing"

	"github.com/simhozebs/net-worth-estimator/backend/internal/authorization"
	"github.com/simhozebs/net-worth-estimator/backend/internal/store"
	"github.com/simhozebs/net-worth-estimator/backend/internal/types"
)

func TestRequiresExplicitDatabaseAndPlan(t *testing.T) {
	for _, args := range [][]string{nil, {"--db", filepath.Join(t.TempDir(), "absent.db")}, {"--plan", "plans/sample"}} {
		var out, errOut bytes.Buffer
		if code := run(args, &out, &errOut); code != 2 {
			t.Fatalf("code=%d stderr=%s", code, errOut.String())
		}
		if !strings.Contains(errOut.String(), "--plan") || out.Len() != 0 {
			t.Fatalf("unexpected output: %q %q", out.String(), errOut.String())
		}
	}
}

func TestScopedImportPreservesOtherPlanAndIdentity(t *testing.T) {
	path := filepath.Join(t.TempDir(), "shared.db")
	db, err := store.SetupDatabase(path)
	if err != nil {
		t.Fatal(err)
	}
	defer db.Close()
	var plans []string
	for _, subject := range []string{"alice", "bob"} {
		resource := authorization.ResourceFor("https://issuer.example", subject)
		plan, err := db.EnsurePrivatePlan(resource.ID, resource.Owner, "https://issuer.example", subject)
		if err != nil {
			t.Fatal(err)
		}
		if err := plan.InitializeDocument(); err != nil {
			t.Fatal(err)
		}
		if _, err := plan.CreateAccount(types.Account{ID: "same-id", Name: subject, Kind: types.AccountKind("cash"), Enabled: true}); err != nil {
			t.Fatal(err)
		}
		plans = append(plans, resource.ID)
	}
	_, err = db.SQL().Exec(`INSERT INTO sessions VALUES('opaque-token',X'00FF',999);
INSERT INTO identity_grants VALUES('grant-id','issuer','subject','sid',999,X'0100');
INSERT INTO identity_logout_marks VALUES('issuer','sid','sid',123,999);
INSERT INTO identity_logout_tokens VALUES('issuer','jti',999);`)
	if err != nil {
		t.Fatal(err)
	}
	before := protectedRows(t, db.SQL(), plans[1])
	model := t.TempDir()
	files := map[string]string{
		"accounts.csv":                        "id,name,kind,enabled\nsame-id,Imported account,cash,true\n",
		"checkpoints.csv":                     "Date,AccountId,Balance\n2026-01-01,same-id,456\n",
		"postings.csv":                        "id,name,postedTime,amount\n",
		"behavior/financial-independence.csv": "id\n",
		"behavior/net-worth-threshold.csv":    "id\n",
		"behavior/account-balance.csv":        "id\n",
		"behavior/posting-fulfillment.csv":    "id\n",
	}
	for name, contents := range files {
		p := filepath.Join(model, name)
		if err := os.MkdirAll(filepath.Dir(p), 0700); err != nil {
			t.Fatal(err)
		}
		if err := os.WriteFile(p, []byte(contents), 0600); err != nil {
			t.Fatal(err)
		}
	}
	var out, errOut bytes.Buffer
	if code := run([]string{"--db", path, "--plan", plans[0], "--model", model}, &out, &errOut); code != 0 {
		t.Fatalf("code=%d stderr=%s", code, errOut.String())
	}
	after := protectedRows(t, db.SQL(), plans[1])
	if !reflect.DeepEqual(before, after) {
		t.Fatalf("import changed protected rows\nbefore: %v\nafter: %v", before, after)
	}
	var name string
	if err := db.SQL().QueryRow(`SELECT name FROM accounts WHERE plan_id=? AND id='same-id'`, plans[0]).Scan(&name); err != nil || name != "Imported account" {
		t.Fatalf("selected plan was not imported: %q %v", name, err)
	}
}

// Snapshot every plan-scoped table plus ownership and identity tables. This
// also catches side effects outside the canonical model document.
func protectedRows(t *testing.T, db *sql.DB, plan string) map[string][]string {
	t.Helper()
	rows, err := db.Query(`SELECT name FROM sqlite_master WHERE type='table' AND name NOT LIKE 'sqlite_%'`)
	if err != nil {
		t.Fatal(err)
	}
	var tables []string
	for rows.Next() {
		var table string
		if err := rows.Scan(&table); err != nil {
			t.Fatal(err)
		}
		tables = append(tables, table)
	}
	if err := rows.Err(); err != nil {
		t.Fatal(err)
	}
	rows.Close()
	result := map[string][]string{}
	for _, table := range tables {
		var scoped int
		if err := db.QueryRow(`SELECT COUNT(*) FROM pragma_table_info(?) WHERE name='plan_id'`, table).Scan(&scoped); err != nil {
			t.Fatal(err)
		}
		if scoped == 0 && table != "sessions" && !strings.HasPrefix(table, "identity_") && table != "app_accounts" && table != "plans" {
			continue
		}
		query := `SELECT * FROM "` + strings.ReplaceAll(table, `"`, `""`) + `"`
		var args []any
		if scoped != 0 {
			query += " WHERE plan_id=?"
			args = append(args, plan)
		}
		r, err := db.Query(query, args...)
		if err != nil {
			t.Fatal(err)
		}
		cols, err := r.Columns()
		if err != nil {
			t.Fatal(err)
		}
		var payload []string
		for r.Next() {
			values := make([]any, len(cols))
			ptrs := make([]any, len(cols))
			for i := range values {
				ptrs[i] = &values[i]
			}
			if err := r.Scan(ptrs...); err != nil {
				t.Fatal(err)
			}
			b, err := json.Marshal(values)
			if err != nil {
				t.Fatal(err)
			}
			payload = append(payload, string(b))
		}
		if err := r.Err(); err != nil {
			t.Fatal(err)
		}
		r.Close()
		sort.Strings(payload)
		result[table] = payload
	}
	return result
}
