package main

import (
	"bytes"
	"os"
	"path/filepath"
	"strings"
	"testing"

	"github.com/simhozebs/net-worth-estimator/backend/internal/authorization"
	"github.com/simhozebs/net-worth-estimator/backend/internal/store/adapters/sqlite"
)

func TestInitializeSeedsOnlySelectedFinancialScopeForDevIdentity(t *testing.T) {
	dir := t.TempDir()
	source, target := filepath.Join(dir, "production.db"), filepath.Join(dir, "new", "nested", "dev.db")
	seed(t, source)
	before, err := os.ReadFile(source)
	if err != nil {
		t.Fatal(err)
	}
	issuer, subject := "http://dev-issuer.invalid", "fresh-dev-subject"
	if err := initialize(target, source, "other", issuer, subject); err != nil {
		t.Fatal(err)
	}
	userID := authorization.ActorKey(issuer, subject)
	for _, check := range []struct{ sql, want string }{
		{"SELECT COUNT(*) FROM users", "1"},
		{"SELECT issuer FROM users", issuer},
		{"SELECT subject FROM users", subject},
		{"SELECT id FROM users", userID},
		{"SELECT name FROM accounts", "other"},
		{"SELECT user_id FROM accounts", userID},
		{"SELECT document_present FROM model_metadata", "1"},
		{"SELECT COUNT(*) FROM sessions", "0"},
		{"SELECT COUNT(*) FROM identity_grants", "0"},
		{"SELECT COUNT(*) FROM identity_logout_marks", "0"},
		{"SELECT COUNT(*) FROM identity_logout_tokens", "0"},
	} {
		if got := query(t, target, check.sql); got != check.want {
			t.Fatalf("%s: got %q, want %q", check.sql, got, check.want)
		}
	}
	after, err := os.ReadFile(source)
	if err != nil {
		t.Fatal(err)
	}
	if !bytes.Equal(before, after) {
		t.Fatal("production snapshot changed")
	}
	if err := initialize(target, source, "owner", issuer, subject); err == nil {
		t.Fatal("existing dev database replaced")
	}
	if got := query(t, target, "SELECT name FROM accounts"); got != "other" {
		t.Fatal("existing data changed", got)
	}
}

func TestInitializeInfersOnlyUnambiguousPrivateSource(t *testing.T) {
	dir := t.TempDir()
	source, target := filepath.Join(dir, "source.db"), filepath.Join(dir, "dev.db")
	seed(t, source)
	if err := initialize(target, source, "", "http://dev.invalid", "dev-owner"); err == nil || !strings.Contains(err.Error(), "exactly one private user") {
		t.Fatal(err)
	}
	if _, err := os.Stat(target); !os.IsNotExist(err) {
		t.Fatalf("ambiguous source created destination: %v", err)
	}
	db, err := sqlite.OpenDatabase(source)
	if err != nil {
		t.Fatal(err)
	}
	_, err = db.SQL().Exec("DELETE FROM users WHERE id='other'")
	db.Close()
	if err != nil {
		t.Fatal(err)
	}
	if err := initialize(target, source, "", "http://dev.invalid", "dev-owner"); err != nil {
		t.Fatal(err)
	}
	if got := query(t, target, "SELECT name FROM accounts"); got != "owner" {
		t.Fatal(got)
	}
}

func TestInitializeFailedCopyPublishesNoDatabase(t *testing.T) {
	dir := t.TempDir()
	source, target := filepath.Join(dir, "source.db"), filepath.Join(dir, "dev.db")
	seed(t, source)
	db, err := sqlite.OpenDatabase(source)
	if err != nil {
		t.Fatal(err)
	}
	_, err = db.SQL().Exec(`PRAGMA foreign_keys=OFF;
		INSERT INTO checkpoints(user_id,id,position,date,model_account_id,balance)
		VALUES ('owner',1,0,'2026-01-01','missing',1)`)
	db.Close()
	if err != nil {
		t.Fatal(err)
	}
	if err := initialize(target, source, "owner", "http://dev.invalid", "dev-owner"); err == nil {
		t.Fatal("invalid financial copy succeeded")
	}
	if _, err := os.Stat(target); !os.IsNotExist(err) {
		t.Fatalf("failed copy published database: %v", err)
	}
	files, err := os.ReadDir(dir)
	if err != nil {
		t.Fatal(err)
	}
	for _, file := range files {
		if strings.HasPrefix(file.Name(), ".initapp-") {
			t.Fatal("temporary database retained", file.Name())
		}
	}
}

func TestInitializeRefusesExistingDestinationSidecars(t *testing.T) {
	for _, suffix := range []string{"-wal", "-shm", "-journal"} {
		t.Run(suffix, func(t *testing.T) {
			dir := t.TempDir()
			source, target := filepath.Join(dir, "source.db"), filepath.Join(dir, "dev.db")
			seed(t, source)
			const original = "existing SQLite state"
			if err := os.WriteFile(target+suffix, []byte(original), 0600); err != nil {
				t.Fatal(err)
			}
			if err := initialize(target, source, "owner", "http://dev.invalid", "dev-owner"); err == nil {
				t.Fatal("published a database next to an existing sidecar")
			}
			if _, err := os.Lstat(target); !os.IsNotExist(err) {
				t.Fatalf("created destination: %v", err)
			}
			if contents, err := os.ReadFile(target + suffix); err != nil || string(contents) != original {
				t.Fatalf("changed existing sidecar: %q, %v", contents, err)
			}
		})
	}
}
