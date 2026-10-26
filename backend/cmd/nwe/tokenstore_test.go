package main

import (
	"os"
	"path/filepath"
	"testing"
	"time"
)

func TestTokenStoreRoundTripKeepsOwnerOnlyPermissions(t *testing.T) {
	t.Setenv("XDG_CONFIG_HOME", t.TempDir())
	want := credentials{Subject: "editor", AccessToken: "a", RefreshToken: "r", Expiry: time.Now().Add(time.Hour).Round(0)}
	// A pre-existing world-readable cache must not stay that way.
	path, err := credentialsPath()
	if err != nil {
		t.Fatal(err)
	}
	if err := os.MkdirAll(filepath.Dir(path), 0o755); err != nil {
		t.Fatal(err)
	}
	if err := os.Chmod(filepath.Dir(path), 0o755); err != nil {
		t.Fatal(err)
	}
	if err := os.WriteFile(path, []byte("{}"), 0o644); err != nil {
		t.Fatal(err)
	}
	if err := saveCredentials(want); err != nil {
		t.Fatal(err)
	}
	info, err := os.Stat(path)
	if err != nil {
		t.Fatal(err)
	}
	if info.Mode().Perm() != 0o600 {
		t.Fatalf("cache permissions=%o want 600", info.Mode().Perm())
	}
	if dir, err := os.Stat(filepath.Dir(path)); err != nil {
		t.Fatal(err)
	} else if dir.Mode().Perm() != 0o700 {
		t.Fatalf("cache dir permissions=%o want 700", dir.Mode().Perm())
	}
	got, err := loadCredentials()
	if err != nil {
		t.Fatal(err)
	}
	if got != want {
		t.Fatalf("round trip=%+v want %+v", got, want)
	}
	if err := clearCredentials(); err != nil {
		t.Fatal(err)
	}
	empty, err := loadCredentials()
	if err != nil {
		t.Fatal(err)
	}
	if empty != (credentials{}) {
		t.Fatalf("after clear=%+v want empty", empty)
	}
}
