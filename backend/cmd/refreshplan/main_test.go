package main

import (
	"bytes"
	"fmt"
	"os"
	"path/filepath"
	"strings"
	"testing"

	"github.com/simhozebs/net-worth-estimator/backend/internal/store"
)

func TestFailedSampleCopyIsAtomic(t *testing.T) {
	for _, existing := range []bool{false, true} {
		t.Run(fmt.Sprintf("existing=%t", existing), func(t *testing.T) {
			dir := t.TempDir()
			source, target := filepath.Join(dir, "source.db"), filepath.Join(dir, "target.db")
			seed(t, source)
			seed(t, target)
			if existing {
				if err := refresh(target, source, "plans/owner", "", true); err != nil {
					t.Fatal(err)
				}
			}
			before := sampleRows(t, target)
			// A malformed snapshot passes shape checks but fails the destination's
			// deferred foreign-key constraint at commit, after every row copy.
			db, err := store.OpenDatabase(source)
			if err != nil {
				t.Fatal(err)
			}
			_, err = db.SQL().Exec(`PRAGMA foreign_keys=OFF;
				INSERT INTO checkpoints(plan_id, id, position, date, account_id, balance)
				VALUES ('plans/other', 1, 0, '2026-01-01', 'missing-account', 100)`)
			db.Close()
			if err != nil {
				t.Fatal(err)
			}
			sourceBefore, err := os.ReadFile(source)
			if err != nil {
				t.Fatal(err)
			}
			if err := refresh(target, source, "plans/other", "", true); err == nil || !strings.Contains(err.Error(), "FOREIGN KEY") {
				t.Fatalf("expected foreign-key copy failure, got %v", err)
			}
			sourceAfter, err := os.ReadFile(source)
			if err != nil {
				t.Fatal(err)
			}
			if !bytes.Equal(sourceBefore, sourceAfter) {
				t.Fatal("source snapshot changed")
			}
			db, err = store.OpenDatabase(target)
			if err != nil {
				t.Fatal(err)
			}
			hasSample, err := db.HasPlan("plans/sample")
			db.Close()
			if err != nil {
				t.Fatal(err)
			}
			if hasSample != existing {
				t.Fatalf("HasPlan(plans/sample)=%t, want %t", hasSample, existing)
			}
			if after := sampleRows(t, target); after != before {
				t.Fatal("failed copy changed sample financial rows")
			}
		})
	}
}

func sampleRows(t *testing.T, path string) string {
	t.Helper()
	db, err := store.OpenDatabase(path)
	if err != nil {
		t.Fatal(err)
	}
	defer db.Close()
	var result strings.Builder
	for _, table := range financialTables {
		rows, err := db.SQL().Query("SELECT * FROM " + quote(table) + " WHERE plan_id='plans/sample' ORDER BY rowid")
		if err != nil {
			t.Fatal(err)
		}
		columns, err := rows.Columns()
		if err != nil {
			rows.Close()
			t.Fatal(err)
		}
		for rows.Next() {
			values := make([]any, len(columns))
			pointers := make([]any, len(columns))
			for i := range values {
				pointers[i] = &values[i]
			}
			if err := rows.Scan(pointers...); err != nil {
				rows.Close()
				t.Fatal(err)
			}
			fmt.Fprintln(&result, table, values)
		}
		if err := rows.Err(); err != nil {
			rows.Close()
			t.Fatal(err)
		}
		rows.Close()
	}
	return result.String()
}

func seed(t *testing.T, path string) {
	t.Helper()
	db, err := store.SetupDatabase(path)
	if err != nil {
		t.Fatal(err)
	}
	defer db.Close()
	for _, id := range []string{"owner", "other"} {
		if _, err := db.EnsurePrivatePlan("plans/"+id, id, "https://issuer.invalid", id); err != nil {
			t.Fatal(err)
		}
		if _, err := db.SQL().Exec("INSERT INTO accounts(plan_id,id,position,name,kind,enabled) VALUES (?, 'checking', 0, ?, 'cash', 1)", "plans/"+id, id); err != nil {
			t.Fatal(err)
		}
		if _, err := db.SQL().Exec("UPDATE model_metadata SET document_present=1, source_path='private-source' WHERE plan_id=?", "plans/"+id); err != nil {
			t.Fatal(err)
		}
	}
	if _, err := db.SQL().Exec(`INSERT INTO sessions VALUES ('cookie', 'persistent-session', 999);
		INSERT INTO identity_grants VALUES ('grant', 'issuer', 'subject', 'sid', 999, 'sealed-credentials');
		INSERT INTO identity_logout_tokens VALUES ('issuer', 'replay-protection', 999);`); err != nil {
		t.Fatal(err)
	}
}

func query(t *testing.T, path, sql string, args ...any) string {
	t.Helper()
	db, err := store.OpenDatabase(path)
	if err != nil {
		t.Fatal(err)
	}
	defer db.Close()
	var value string
	if err := db.SQL().QueryRow(sql, args...).Scan(&value); err != nil {
		t.Fatal(err)
	}
	return value
}

func TestRefreshPreservesOtherPlansAndIdentity(t *testing.T) {
	dir := t.TempDir()
	source, target := filepath.Join(dir, "source.db"), filepath.Join(dir, "target.db")
	seed(t, source)
	seed(t, target)
	if err := refresh(target, source, "plans/other", "plans/owner", false); err != nil {
		t.Fatal(err)
	}
	if got := query(t, target, "SELECT name FROM accounts WHERE plan_id='plans/owner'"); got != "other" {
		t.Fatal(got)
	}
	if got := query(t, target, "SELECT name FROM accounts WHERE plan_id='plans/other'"); got != "other" {
		t.Fatal(got)
	}
	if got := query(t, source, "SELECT name FROM accounts WHERE plan_id='plans/owner'"); got != "owner" {
		t.Fatal("source changed", got)
	}
	if got := query(t, target, "SELECT owner_account_id FROM plans WHERE id='plans/owner'"); got != "owner" {
		t.Fatal("ownership changed", got)
	}
	for _, check := range []struct{ sql, want string }{
		{"SELECT data FROM sessions", "persistent-session"},
		{"SELECT data FROM identity_grants", "sealed-credentials"},
		{"SELECT jti FROM identity_logout_tokens", "replay-protection"},
	} {
		if got := query(t, target, check.sql); got != check.want {
			t.Fatal(got)
		}
	}
}

func TestSamplePublicationStripsPrivateHistory(t *testing.T) {
	dir := t.TempDir()
	source, target := filepath.Join(dir, "source.db"), filepath.Join(dir, "target.db")
	seed(t, source)
	seed(t, target)
	db, err := store.OpenDatabase(source)
	if err != nil {
		t.Fatal(err)
	}
	_, err = db.SQL().Exec(`INSERT INTO account_links(plan_id, bridge_account_id, model_account_id) VALUES ('plans/owner','secret-bridge-id','checking');
		INSERT INTO projection_artifacts(plan_id, identity, kind, payload) VALUES ('plans/owner','secret-artifact','deterministic','private');
		INSERT INTO posting_id_migrations(plan_id, old_id, new_id) VALUES ('plans/owner','legacy','uuid');
		UPDATE sync_state SET last_sync_at='2026-01-01' WHERE plan_id='plans/owner';`)
	db.Close()
	if err != nil {
		t.Fatal(err)
	}
	if err := refresh(target, source, "plans/owner", "", true); err != nil {
		t.Fatal(err)
	}
	if got := query(t, target, "SELECT name FROM accounts WHERE plan_id='plans/sample'"); got != "owner" {
		t.Fatal(got)
	}
	for _, table := range []string{"account_links", "projection_artifacts", "posting_sync_keys", "posting_id_migrations"} {
		if got := query(t, target, "SELECT COUNT(*) FROM "+table+" WHERE plan_id='plans/sample'"); got != "0" {
			t.Fatal(table, got)
		}
	}
	if got := query(t, target, "SELECT source_path FROM model_metadata WHERE plan_id='plans/sample'"); got != "sample" {
		t.Fatal(got)
	}
	if got := query(t, target, "SELECT last_sync_at FROM sync_state WHERE plan_id='plans/sample'"); got != "" {
		t.Fatal(got)
	}
	if got := query(t, target, "SELECT data FROM identity_grants"); got != "sealed-credentials" {
		t.Fatal(got)
	}
}

func TestRefreshFailsClosedAndRollsBack(t *testing.T) {
	dir := t.TempDir()
	source, target := filepath.Join(dir, "source.db"), filepath.Join(dir, "target.db")
	seed(t, source)
	seed(t, target)
	for _, args := range []struct {
		source, sourcePlan, plan string
		sample                   bool
	}{
		{target, "plans/owner", "plans/owner", false},
		{source, "plans/missing", "plans/owner", false},
		{source, "plans/owner", "plans/missing", false},
		{source, "plans/owner", "plans/sample", false},
		{source, "plans/owner", "plans/owner", true},
	} {
		if err := refresh(target, args.source, args.sourcePlan, args.plan, args.sample); err == nil {
			t.Fatal("unsafe operation accepted", args)
		}
	}
	db, err := store.OpenDatabase(target)
	if err != nil {
		t.Fatal(err)
	}
	// A late insert failure must roll back the earlier deletes.
	_, err = db.SQL().Exec(`CREATE TRIGGER reject_copy BEFORE INSERT ON accounts WHEN NEW.plan_id='plans/owner' BEGIN SELECT RAISE(ABORT,'copy blocked'); END`)
	db.Close()
	if err != nil {
		t.Fatal(err)
	}
	if err := refresh(target, source, "plans/other", "plans/owner", false); err == nil {
		t.Fatal("expected insert failure")
	}
	if got := query(t, target, "SELECT name FROM accounts WHERE plan_id='plans/owner'"); got != "owner" {
		t.Fatal("transaction did not roll back", got)
	}
	db, err = store.OpenDatabase(target)
	if err != nil {
		t.Fatal(err)
	}
	_, err = db.SQL().Exec(`CREATE TABLE future_financial_data(plan_id TEXT, value TEXT)`)
	db.Close()
	if err != nil {
		t.Fatal(err)
	}
	if err := refresh(target, source, "plans/other", "plans/owner", false); err == nil || !strings.Contains(err.Error(), "unknown plan-scoped table") {
		t.Fatal(err)
	}
}
