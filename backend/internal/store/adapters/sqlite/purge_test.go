package sqlite

import (
	"database/sql"
	"os"
	"path/filepath"
	"strings"
	"testing"
)

// TestPurgeSyncScriptClearsSyncRows executes the versioned purge script
// and proves it removes all sync-owned rows while preserving owner rows.
// The script intentionally deletes by source, not by ID, so it clears all
// sync-owned rows and the next sync re-inserts fresh state.
func TestPurgeSyncScriptClearsSyncRows(t *testing.T) {
	store := openSQLiteStore(t)
	seedOwnerModel(t, store)
	seedSyncRows(t, store)
	other, err := store.owned.EnsureUser("other", "https://issuer.test", "other")
	if err != nil {
		t.Fatal(err)
	}
	seedOwnerModel(t, other)
	seedSyncRows(t, other.(*sqliteStore))
	if err := other.SetLastSyncTime("2026-10-18T14:30:00Z"); err != nil {
		t.Fatal(err)
	}
	if err := store.SetLastSyncTime("2026-10-18T14:30:00Z"); err != nil {
		t.Fatalf("record last sync: %v", err)
	}
	if got := countRows(t, store, "postings", "source = 'simplefin'"); got != 1 {
		t.Fatalf("sync postings before purge = %d, want 1", got)
	}

	raw, err := os.ReadFile(filepath.Join("..", "..", "..", "..", "scripts", "purge-simplefin-sync.sql"))
	if err != nil {
		t.Fatalf("read purge script: %v", err)
	}
	// Missing binding is a safe no-op. Exercise the raw connection because a
	// scoped store always supplies its own binding.
	if _, err := store.owned.SQL().Exec(string(raw)); err != nil {
		if !strings.Contains(err.Error(), `missing named argument "user_id"`) {
			t.Fatalf("unbound purge: %v", err)
		}
		// database/sql rejects the missing name after the script starts BEGIN.
		if _, err := store.owned.SQL().Exec(`ROLLBACK`); err != nil {
			t.Fatal(err)
		}
	}
	// SQLite CLI leaves an omitted parameter NULL. Prove that path also
	// matches no rows, independent of database/sql's fail-closed check.
	if _, err := store.owned.SQL().Exec(string(raw), sql.Named("user_id", nil)); err != nil {
		t.Fatal(err)
	}
	if got := countRows(t, store, "postings", "source = 'simplefin'"); got != 1 {
		t.Fatal("unbound purge deleted financial data")
	}
	if _, err := store.owned.SQL().Exec(string(raw), sql.Named("user_id", store.db.userID)); err != nil {
		t.Fatalf("purge transaction: %v", err)
	}

	if got := countRows(t, store, "postings", "source = 'simplefin'"); got != 0 {
		t.Fatalf("sync postings after purge = %d, want 0", got)
	}
	if got := countRows(t, store, "checkpoints", "source = 'simplefin'"); got != 0 {
		t.Fatalf("sync checkpoints after purge = %d, want 0", got)
	}
	if got := countRows(t, store, "entity_ids", "id = '"+rawSyncedPostingID+"'"); got != 0 {
		t.Fatalf("sync registry rows after purge = %d, want 0", got)
	}
	if got := countRows(t, store, "posting_sync_keys", ""); got != 0 {
		t.Fatal("sync keys survived the purge")
	}
	if got := countRows(t, store, "entity_ids", "id = '"+ownerPostingID+"'"); got != 1 {
		t.Fatal("owner registry row was purged")
	}
	if got := countRows(t, store, "postings", "id = '"+ownerPostingID+"'"); got != 1 {
		t.Fatal("owner posting was purged")
	}
	if got := countRows(t, store, "checkpoints", "source = 'user'"); got != 1 {
		t.Fatalf("owner checkpoints = %d, want 1", got)
	}
	if got, err := store.GetLastSyncTime(); err != nil || got != "" {
		t.Fatalf("last sync after purge = %q, err %v, want empty", got, err)
	}
	if got := countRows(t, other.(*sqliteStore), "postings", "source = 'simplefin'"); got != 1 {
		t.Fatal("purge crossed plan boundary")
	}
	if got, err := other.GetLastSyncTime(); err != nil || got != "2026-10-18T14:30:00Z" {
		t.Fatalf("other sync time = %q, %v", got, err)
	}
}
