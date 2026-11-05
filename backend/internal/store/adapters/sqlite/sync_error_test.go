package sqlite

import (
	"testing"

	"github.com/simhozebs/net-worth-estimator/backend/internal/store"
)

func TestSyncErrorRoundTripAndClear(t *testing.T) {
	database := openTestStore(t)
	item := store.SyncError{
		Code:         "con.auth",
		Message:      "Reauthenticate My Bank",
		Scope:        "connection",
		ConnectionID: "CON-1",
		ObservedAt:   "2026-11-05T00:00:00Z",
	}
	if err := database.SetSyncError(item); err != nil {
		t.Fatal(err)
	}
	loaded, err := database.GetSyncError()
	if err != nil || loaded == nil {
		t.Fatalf("loaded = %+v, err %v", loaded, err)
	}
	if *loaded != item {
		t.Fatalf("loaded = %+v, want %+v", *loaded, item)
	}
	if err := database.ClearSyncError(); err != nil {
		t.Fatal(err)
	}
	if loaded, err := database.GetSyncError(); err != nil || loaded != nil {
		t.Fatalf("after clear = %+v, err %v", loaded, err)
	}
}

func TestSyncErrorIsUserScoped(t *testing.T) {
	directory := t.TempDir()
	path := directory + "/sync-errors.db"
	database, err := SetupDatabase(path)
	if err != nil {
		t.Fatal(err)
	}
	t.Cleanup(func() { _ = database.Close() })
	alice, err := database.EnsureUser("alice", "https://issuer.test", "alice")
	if err != nil {
		t.Fatal(err)
	}
	bob, err := database.EnsureUser("bob", "https://issuer.test", "bob")
	if err != nil {
		t.Fatal(err)
	}
	if err := alice.SetSyncError(store.SyncError{Code: "con.auth", Message: "alice"}); err != nil {
		t.Fatal(err)
	}
	if loaded, err := bob.GetSyncError(); err != nil || loaded != nil {
		t.Fatalf("bob = %+v, err %v", loaded, err)
	}
	if loaded, err := alice.GetSyncError(); err != nil || loaded == nil || loaded.Message != "alice" {
		t.Fatalf("alice = %+v, err %v", loaded, err)
	}
}
