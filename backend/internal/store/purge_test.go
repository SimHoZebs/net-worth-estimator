package store

import (
	"os"
	"path/filepath"
	"testing"
)

// TestPurgeSyncScriptClearsSyncRows executes the versioned purge script
// and proves it removes all sync-owned rows while preserving owner rows.
// The script intentionally deletes by source, not by ID, so it clears all
// sync-owned rows and the next sync re-inserts fresh state.
func TestPurgeSyncScriptClearsSyncRows(t *testing.T) {
	store := openSQLiteStore(t)
	seedOwnerDocument(t, store)
	seedSyncRows(t, store)
	if err := store.SetLastSyncTime("2026-10-18T14:30:00Z"); err != nil {
		t.Fatalf("record last sync: %v", err)
	}
	if got := countRows(t, store, "postings", "source = 'simplefin'"); got != 1 {
		t.Fatalf("sync postings before purge = %d, want 1", got)
	}

	raw, err := os.ReadFile(filepath.Join("..", "..", "scripts", "purge-simplefin-sync.sql"))
	if err != nil {
		t.Fatalf("read purge script: %v", err)
	}
	if _, err := store.db.Exec(string(raw)); err != nil {
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
	if got := countRows(t, store, "checkpoints", "source = 'model'"); got != 1 {
		t.Fatalf("owner checkpoints = %d, want 1", got)
	}
	if got, err := store.GetLastSyncTime(); err != nil || got != "" {
		t.Fatalf("last sync after purge = %q, err %v, want empty", got, err)
	}
}
