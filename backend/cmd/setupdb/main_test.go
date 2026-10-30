package main

import (
	"bytes"
	"os"
	"path/filepath"
	"strings"
	"testing"

	"github.com/simhozebs/net-worth-estimator/backend/internal/store/adapters/sqlite"
)

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

func TestSetupProvisionsOrdinaryUserWithModel(t *testing.T) {
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
	exists, err := user.ModelExists()
	if err != nil || !exists {
		t.Fatalf("provisioned model missing: %v %v", exists, err)
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
