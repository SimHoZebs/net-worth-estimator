package main

import (
	"bytes"
	"database/sql"
	"os"
	"path/filepath"
	"strings"
	"testing"

	"github.com/simhozebs/net-worth-estimator/backend/internal/store/adapters/sqlite"
)

func TestSetupMigratesLegacyPlansDatabase(t *testing.T) {
	path := filepath.Join(t.TempDir(), "legacy.db")
	db, err := sql.Open("sqlite", path)
	if err != nil {
		t.Fatal(err)
	}
	for _, stmt := range []string{
		`CREATE TABLE schema_migrations(name TEXT PRIMARY KEY)`,
		`INSERT INTO schema_migrations(name) VALUES ('receipt-blobs-v1'), ('shared-plans-v1')`,
		`CREATE TABLE app_accounts(id TEXT PRIMARY KEY, issuer TEXT NOT NULL, subject TEXT NOT NULL, UNIQUE(issuer, subject))`,
		`CREATE TABLE plans(id TEXT PRIMARY KEY, kind TEXT NOT NULL, owner_account_id TEXT UNIQUE REFERENCES app_accounts(id))`,
		`CREATE TABLE user_groups(id TEXT PRIMARY KEY, name TEXT NOT NULL, created_by_account_id TEXT NOT NULL REFERENCES app_accounts(id), created_at INTEGER NOT NULL)`,
		`CREATE TABLE group_members(group_id TEXT NOT NULL REFERENCES user_groups(id) ON DELETE CASCADE, account_id TEXT NOT NULL REFERENCES app_accounts(id), role TEXT NOT NULL, joined_at INTEGER NOT NULL, display_name TEXT NOT NULL DEFAULT '', PRIMARY KEY(group_id, account_id))`,
		`CREATE TABLE group_invites(id TEXT PRIMARY KEY, group_id TEXT NOT NULL REFERENCES user_groups(id) ON DELETE CASCADE, code_hash TEXT NOT NULL UNIQUE, created_by_account_id TEXT NOT NULL REFERENCES app_accounts(id), expires_at INTEGER NOT NULL, max_uses INTEGER NOT NULL DEFAULT 1, used_count INTEGER NOT NULL DEFAULT 0, revoked_at INTEGER, created_at INTEGER NOT NULL)`,
		`CREATE TABLE accounts(plan_id TEXT NOT NULL REFERENCES plans(id) ON DELETE CASCADE, id TEXT NOT NULL, position INTEGER NOT NULL, name TEXT NOT NULL, kind TEXT NOT NULL DEFAULT 'cash', min_balance REAL, max_balance REAL, color TEXT, enabled INTEGER NOT NULL, PRIMARY KEY (plan_id, id))`,
		`CREATE TABLE model_metadata(plan_id TEXT NOT NULL REFERENCES plans(id) ON DELETE CASCADE, id INTEGER NOT NULL, source_path TEXT NOT NULL, document_present INTEGER NOT NULL, PRIMARY KEY(plan_id, id))`,
		`INSERT INTO app_accounts(id, issuer, subject) VALUES ('user:owner1', 'https://issuer.test', 'owner1')`,
		`INSERT INTO plans(id, kind, owner_account_id) VALUES ('plans/owner1', 'private', 'user:owner1')`,
		`INSERT INTO accounts(plan_id, id, position, name, kind, enabled) VALUES ('plans/owner1', 'checking', 0, 'Checking', 'cash', 1)`,
	} {
		if _, err := db.Exec(stmt); err != nil {
			t.Fatalf("legacy ddl: %v: %s", err, stmt)
		}
	}
	if err := db.Close(); err != nil {
		t.Fatal(err)
	}
	var out, errOut bytes.Buffer
	if code := run([]string{"--db", path}, &out, &errOut); code != 0 {
		t.Fatalf("code=%d stdout=%q stderr=%q", code, out.String(), errOut.String())
	}
	if !strings.Contains(out.String(), "migration complete") || !strings.Contains(out.String(), "setup complete") {
		t.Fatalf("unexpected output: %q", out.String())
	}
	// Repeat run is a no-op migration with successful setup.
	out.Reset()
	if code := run([]string{"--db", path}, &out, &errOut); code != 0 {
		t.Fatalf("repeat code=%d stderr=%q", code, errOut.String())
	}
	if strings.Contains(out.String(), "migration complete") {
		t.Fatalf("repeat migrated again: %q", out.String())
	}
	opened, err := sqlite.OpenDatabase(path)
	if err != nil {
		t.Fatalf("open after setup: %v", err)
	}
	var name string
	if err := opened.SQL().QueryRow(`SELECT name FROM accounts WHERE user_id='user:owner1'`).Scan(&name); err != nil || name != "Checking" {
		t.Fatalf("migrated rows: %v", err)
	}
	if err := opened.Close(); err != nil {
		t.Fatal(err)
	}
}

func TestRequiresExplicitDatabase(t *testing.T) {
	t.Setenv("NET_WORTH_ESTIMATOR_DB", filepath.Join(t.TempDir(), "implicit.db"))
	for _, args := range [][]string{nil, {"--db", ""}, {"--db", " "}, {"unexpected"}} {
		var out, errOut bytes.Buffer
		if code := run(args, &out, &errOut); code != 2 {
			t.Fatalf("code=%d stderr=%s", code, errOut.String())
		}
		if !strings.Contains(errOut.String(), "--db") || out.Len() != 0 {
			t.Fatalf("unexpected output: %q %q", out.String(), errOut.String())
		}
	}
	if _, err := os.Stat(os.Getenv("NET_WORTH_ESTIMATOR_DB")); !os.IsNotExist(err) {
		t.Fatalf("implicit database created: %v", err)
	}
}

func TestSetupCreatesParentAndSupportsRepeatProvisioning(t *testing.T) {
	path := filepath.Join(t.TempDir(), "private", "nested", "app.db")
	for attempt := 0; attempt < 2; attempt++ {
		var out, errOut bytes.Buffer
		if code := run([]string{"--db", path}, &out, &errOut); code != 0 {
			t.Fatalf("attempt=%d code=%d stderr=%s", attempt, code, errOut.String())
		}
		db, err := sqlite.OpenDatabase(path)
		if err != nil {
			t.Fatal(err)
		}
		if attempt == 0 {
			_, err = db.EnsureUser("owner", "https://issuer.invalid", "owner")
		} else {
			var present bool
			present, err = db.HasUser("owner")
			if err == nil && !present {
				t.Error("repeat setup lost existing user")
			}
		}
		if closeErr := db.Close(); closeErr != nil {
			t.Fatal(closeErr)
		}
		if err != nil {
			t.Fatal(err)
		}
	}
}

func TestSetupProvisionsOrdinaryUserWithDocument(t *testing.T) {
	path := filepath.Join(t.TempDir(), "app.db")
	var out, errOut bytes.Buffer
	if code := run([]string{"--db", path, "--issuer", "https://issuer.test", "--subject", "guest-user"}, &out, &errOut); code != 0 {
		t.Fatalf("code=%d stderr=%s", code, errOut.String())
	}
	db, err := sqlite.OpenDatabase(path)
	if err != nil {
		t.Fatal(err)
	}
	defer db.Close()
	// Resolve the ordinary provisioned user via issuer/subject.
	rows, err := db.SQL().Query(`SELECT id FROM users WHERE issuer='https://issuer.test' AND subject='guest-user'`)
	if err != nil {
		t.Fatal(err)
	}
	var ids []string
	for rows.Next() {
		var id string
		if err := rows.Scan(&id); err != nil {
			rows.Close()
			t.Fatal(err)
		}
		ids = append(ids, id)
	}
	rows.Close()
	if len(ids) != 1 {
		t.Fatalf("unexpected provisioned ids: %v", ids)
	}
	if got := ids[0]; len(got) != len("user:")+64 || got[:5] != "user:" {
		t.Fatalf("provisioned user must be ordinary users/<64hex> row: %q", got)
	}
	user, err := db.User(ids[0])
	if err != nil {
		t.Fatal(err)
	}
	exists, err := user.DocumentExists()
	if err != nil || !exists {
		t.Fatalf("provisioned document missing: %v %v", exists, err)
	}
	// Partial issuer/subject pair must fail.
	for _, args := range [][]string{
		{"--db", path, "--issuer", "https://issuer.test"},
		{"--db", path, "--subject", "guest-user"},
	} {
		var o, e bytes.Buffer
		if code := run(args, &o, &e); code != 2 {
			t.Fatalf("partial identity code=%d", code)
		}
	}
}
