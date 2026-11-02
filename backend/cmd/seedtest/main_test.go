package main

import (
	"bytes"
	"path/filepath"
	"strings"
	"testing"

	"github.com/simhozebs/net-worth-estimator/backend/internal/authorization"
	"github.com/simhozebs/net-worth-estimator/backend/internal/store/adapters/sqlite"
)

func seedtestUser(t *testing.T, path, issuer, subject string) string {
	t.Helper()
	database, err := sqlite.SetupDatabase(path)
	if err != nil {
		t.Fatal(err)
	}
	t.Cleanup(func() { _ = database.Close() })
	userID := authorization.ActorKey(issuer, subject)
	if _, err := database.EnsureUser(userID, issuer, subject); err != nil {
		t.Fatal(err)
	}
	if closeErr := database.Close(); closeErr != nil {
		t.Fatal(closeErr)
	}
	return strings.Replace(userID, "user:", "users/", 1)
}

func TestSeedtestRequiresExplicitScope(t *testing.T) {
	for _, args := range [][]string{
		nil,
		{"--db", ""},
		{"--db", "x"},
		{"--db", "x", "--user", "users/abc"},
		{"--db", "x", "--user", "users/abc", "--bulk", "2x3", "--clear"},
		{"--db", "x", "--user", "users/abc", "--bulk", "nope"},
	} {
		var out, errOut bytes.Buffer
		if code := run(args, &out, &errOut); code != 2 {
			t.Fatalf("args=%v code=%d stderr=%s", args, code, errOut.String())
		}
	}
}

func TestSeedtestInjectClearRoundTrip(t *testing.T) {
	path := filepath.Join(t.TempDir(), "app.db")
	user := seedtestUser(t, path, "https://issuer.test", "seed-user")
	var out, errOut bytes.Buffer
	if code := run([]string{"--db", path, "--user", user, "--bulk", "2x3:7"}, &out, &errOut); code != 0 {
		t.Fatalf("inject code=%d stderr=%s", code, errOut.String())
	}
	if !strings.Contains(out.String(), "2 accounts, 6 postings") {
		t.Fatalf("inject output = %q", out.String())
	}
	out.Reset()
	if code := run([]string{"--db", path, "--user", user, "--clear"}, &out, &errOut); code != 0 {
		t.Fatalf("clear code=%d stderr=%s", code, errOut.String())
	}
	if !strings.Contains(out.String(), "2 accounts, 6 postings") {
		t.Fatalf("clear output = %q", out.String())
	}
}

func TestSeedtestRejectsMissingUser(t *testing.T) {
	path := filepath.Join(t.TempDir(), "app.db")
	database, err := sqlite.SetupDatabase(path)
	if err != nil {
		t.Fatal(err)
	}
	if closeErr := database.Close(); closeErr != nil {
		t.Fatal(closeErr)
	}
	var out, errOut bytes.Buffer
	missing := "users/" + strings.Repeat("0", 64)
	if code := run([]string{"--db", path, "--user", missing, "--bulk", "1x1"}, &out, &errOut); code != 1 {
		t.Fatalf("code=%d stderr=%s", code, errOut.String())
	}
}
