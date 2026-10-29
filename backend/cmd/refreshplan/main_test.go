package main

import (
	"bytes"
	"fmt"
	"os"
	"path/filepath"
	"strings"
	"testing"

	"github.com/simhozebs/net-worth-estimator/backend/internal/store/adapters/sqlite"
)

func TestFailedSampleCopyIsAtomic(t *testing.T) {
	for _, existing := range []bool{false, true} {
		t.Run(fmt.Sprintf("existing=%t", existing), func(t *testing.T) {
			dir := t.TempDir()
			source, target := filepath.Join(dir, "source.db"), filepath.Join(dir, "target.db")
			seed(t, source)
			seed(t, target)
			if existing {
				if err := refresh(target, source, "owner", "", true); err != nil {
					t.Fatal(err)
				}
			}
			before := sampleRows(t, target)
			// A malformed snapshot passes shape checks but fails the destination's
			// deferred foreign-key constraint at commit, after every row copy.
			db, err := sqlite.OpenDatabase(source)
			if err != nil {
				t.Fatal(err)
			}
			_, err = db.SQL().Exec(`PRAGMA foreign_keys=OFF;
				INSERT INTO checkpoints(user_id, id, position, date, model_account_id, balance)
				VALUES ('other', 1, 0, '2026-01-01', 'missing-account', 100)`)
			db.Close()
			if err != nil {
				t.Fatal(err)
			}
			sourceBefore, err := os.ReadFile(source)
			if err != nil {
				t.Fatal(err)
			}
			if err := refresh(target, source, "other", "", true); err == nil || !strings.Contains(err.Error(), "FOREIGN KEY") {
				t.Fatalf("expected foreign-key copy failure, got %v", err)
			}
			sourceAfter, err := os.ReadFile(source)
			if err != nil {
				t.Fatal(err)
			}
			if !bytes.Equal(sourceBefore, sourceAfter) {
				t.Fatal("source snapshot changed")
			}
			db, err = sqlite.OpenDatabase(target)
			if err != nil {
				t.Fatal(err)
			}
			hasSample, err := db.HasUser("sample")
			db.Close()
			if err != nil {
				t.Fatal(err)
			}
			if hasSample != existing {
				t.Fatalf("HasUser(sample)=%t, want %t", hasSample, existing)
			}
			if after := sampleRows(t, target); after != before {
				t.Fatal("failed copy changed sample financial rows")
			}
		})
	}
}

func sampleRows(t *testing.T, path string) string {
	t.Helper()
	db, err := sqlite.OpenDatabase(path)
	if err != nil {
		t.Fatal(err)
	}
	defer db.Close()
	var result strings.Builder
	for _, table := range financialTables {
		rows, err := db.SQL().Query("SELECT * FROM " + quote(table) + " WHERE user_id='sample' ORDER BY rowid")
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
	db, err := sqlite.SetupDatabase(path)
	if err != nil {
		t.Fatal(err)
	}
	defer db.Close()
	for _, id := range []string{"owner", "other"} {
		if _, err := db.EnsureUser(id, "https://issuer.invalid", id); err != nil {
			t.Fatal(err)
		}
		if _, err := db.SQL().Exec("INSERT INTO accounts(user_id,id,position,name,kind,enabled) VALUES (?, 'checking', 0, ?, 'cash', 1)", id, id); err != nil {
			t.Fatal(err)
		}
		if _, err := db.SQL().Exec("UPDATE model_metadata SET document_present=1, source_path='private-source' WHERE user_id=?", id); err != nil {
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
	db, err := sqlite.OpenDatabase(path)
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

func TestRefreshPreservesOtherUsersAndIdentity(t *testing.T) {
	dir := t.TempDir()
	source, target := filepath.Join(dir, "source.db"), filepath.Join(dir, "target.db")
	seed(t, source)
	seed(t, target)
	sourceDB, err := sqlite.OpenDatabase(source)
	if err != nil {
		t.Fatal(err)
	}
	if _, err := sourceDB.SQL().Exec(`UPDATE sync_credentials SET access_url='https://user:pass@bridge.example/simplefin', bridge_host='bridge.example', updated_at='2026-01-01T00:00:00Z', cards_json='["prime_card"]' WHERE user_id='other'`); err != nil {
		t.Fatal(err)
	}
	sourceDB.Close()
	if err := refresh(target, source, "other", "owner", false); err != nil {
		t.Fatal(err)
	}
	if got := query(t, target, "SELECT access_url FROM sync_credentials WHERE user_id='owner'"); got != "" {
		t.Fatalf("refresh copied the Bridge secret: %q", got)
	}
	if got := query(t, target, `SELECT cards_json FROM sync_credentials WHERE user_id='owner'`); got != `["prime_card"]` {
		t.Fatalf("refresh dropped card selection: %q", got)
	}
	if got := query(t, target, "SELECT name FROM accounts WHERE user_id='owner'"); got != "other" {
		t.Fatal(got)
	}
	if got := query(t, target, "SELECT name FROM accounts WHERE user_id='other'"); got != "other" {
		t.Fatal(got)
	}
	if got := query(t, source, "SELECT name FROM accounts WHERE user_id='owner'"); got != "owner" {
		t.Fatal("source changed", got)
	}
	if got := query(t, target, "SELECT subject FROM users WHERE id='owner'"); got != "owner" {
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
	db, err := sqlite.OpenDatabase(source)
	if err != nil {
		t.Fatal(err)
	}
	_, err = db.SQL().Exec(`INSERT INTO account_links(user_id, bridge_account_id, model_account_id) VALUES ('owner','secret-bridge-id','checking');
		INSERT INTO projection_artifacts(user_id, identity, kind, payload) VALUES ('owner','secret-artifact','deterministic','private');
		INSERT INTO posting_id_migrations(user_id, old_id, new_id) VALUES ('owner','legacy','uuid');
		UPDATE sync_state SET last_sync_at='2026-01-01' WHERE user_id='owner';
		UPDATE sync_credentials SET access_url='https://user:pass@bridge.example/simplefin', bridge_host='bridge.example', updated_at='2026-01-01T00:00:00Z', cards_json='["prime_card"]' WHERE user_id='owner';`)
	db.Close()
	if err != nil {
		t.Fatal(err)
	}
	if err := refresh(target, source, "owner", "", true); err != nil {
		t.Fatal(err)
	}
	if got := query(t, target, "SELECT name FROM accounts WHERE user_id='sample'"); got != "owner" {
		t.Fatal(got)
	}
	for _, table := range []string{"account_links", "projection_artifacts", "posting_sync_keys", "posting_id_migrations"} {
		if got := query(t, target, "SELECT COUNT(*) FROM "+table+" WHERE user_id='sample'"); got != "0" {
			t.Fatal(table, got)
		}
	}
	if got := query(t, target, "SELECT source_path FROM model_metadata WHERE user_id='sample'"); got != "sample" {
		t.Fatal(got)
	}
	if got := query(t, target, "SELECT last_sync_at FROM sync_state WHERE user_id='sample'"); got != "" {
		t.Fatal(got)
	}
	if got := query(t, target, "SELECT access_url FROM sync_credentials WHERE user_id='sample'"); got != "" {
		t.Fatalf("sample copied the Bridge secret: %q", got)
	}
	if got := query(t, target, "SELECT cards_json FROM sync_credentials WHERE user_id='sample'"); got != `["prime_card"]` {
		t.Fatalf("sample dropped card selection: %q", got)
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
		source, sourceUser, user string
		sample                   bool
	}{
		{target, "owner", "owner", false},
		{source, "missing", "owner", false},
		{source, "owner", "missing", false},
		{source, "owner", "sample", false},
		{source, "owner", "owner", true},
	} {
		if err := refresh(target, args.source, args.sourceUser, args.user, args.sample); err == nil {
			t.Fatal("unsafe operation accepted", args)
		}
	}
	db, err := sqlite.OpenDatabase(target)
	if err != nil {
		t.Fatal(err)
	}
	// A late insert failure must roll back the earlier deletes.
	_, err = db.SQL().Exec(`CREATE TRIGGER reject_copy BEFORE INSERT ON accounts WHEN NEW.user_id='owner' BEGIN SELECT RAISE(ABORT,'copy blocked'); END`)
	db.Close()
	if err != nil {
		t.Fatal(err)
	}
	if err := refresh(target, source, "other", "owner", false); err == nil {
		t.Fatal("expected insert failure")
	}
	if got := query(t, target, "SELECT name FROM accounts WHERE user_id='owner'"); got != "owner" {
		t.Fatal("transaction did not roll back", got)
	}
	db, err = sqlite.OpenDatabase(target)
	if err != nil {
		t.Fatal(err)
	}
	_, err = db.SQL().Exec(`CREATE TABLE future_financial_data(user_id TEXT, value TEXT)`)
	db.Close()
	if err != nil {
		t.Fatal(err)
	}
	if err := refresh(target, source, "other", "owner", false); err == nil || !strings.Contains(err.Error(), "unknown user-scoped table") {
		t.Fatal(err)
	}
}
