package sqlite

import (
	"path/filepath"
	"testing"
	"time"
)

// Token hashing and expiry are storage contracts: raw tokens must never
// persist, and expired sessions must not be found. Moved from identity
// service tests with the SQL implementation.
func TestIdentitySessionHashesAndExpires(t *testing.T) {
	path := filepath.Join(t.TempDir(), "sessions.db")
	d, err := SetupDatabase(path)
	if err != nil {
		t.Fatal(err)
	}
	defer d.Close()
	if err := d.Commit("secret-cookie", []byte("state"), time.Now().Add(time.Hour)); err != nil {
		t.Fatal(err)
	}
	var token string
	if err := d.db.QueryRow(`SELECT token FROM sessions`).Scan(&token); err != nil {
		t.Fatal(err)
	}
	if token == "secret-cookie" {
		t.Fatal("raw token stored")
	}
	b, found, err := d.Find("secret-cookie")
	if err != nil || !found || string(b) != "state" {
		t.Fatalf("restarted session=%q found=%v err=%v", b, found, err)
	}
	if err := d.Commit("expired", []byte("expired state"), time.Now().Add(-time.Second)); err != nil {
		t.Fatal(err)
	}
	_, found, err = d.Find("expired")
	if err != nil || found {
		t.Fatalf("expired=%v %v", found, err)
	}
}
