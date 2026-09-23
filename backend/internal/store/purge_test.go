package store

import (
	"os"
	"path/filepath"
	"strings"
	"testing"
)

// TestPurgeSyncScriptClearsSyncRows executes the versioned cutover script
// and proves it removes all sync-owned rows while preserving owner rows.
// The script intentionally deletes by source, not by ID: mock and real rows
// are identical by design, so cutover purges both and the first real sync
// re-inserts fresh state.
func TestPurgeSyncScriptClearsSyncRows(t *testing.T) {
	store := openSQLiteStore(t)
	if err := store.SaveDocument(ownerDocument()); err != nil {
		t.Fatalf("save owner document: %v", err)
	}
	seedSyncRows(t, store)
	if got := countRows(t, store, "postings", "source = 'simplefin'"); got != 1 {
		t.Fatalf("sync postings before purge = %d, want 1", got)
	}

	raw, err := os.ReadFile(filepath.Join("..", "..", "scripts", "purge-simplefin-sync.sql"))
	if err != nil {
		t.Fatalf("read purge script: %v", err)
	}
	// The script is comment-heavy by design (procedure + preview queries),
	// so collect only the active DELETE statements instead of splitting on
	// semicolons, which also appear inside commented preview queries.
	var statements []string
	for _, line := range strings.Split(string(raw), "\n") {
		trimmed := strings.TrimSpace(line)
		if strings.HasPrefix(strings.ToUpper(trimmed), "DELETE") {
			statements = append(statements, strings.TrimSuffix(trimmed, ";"))
		}
	}
	if len(statements) != 2 {
		t.Fatalf("purge script DELETEs = %d, want 2 (postings + checkpoints)", len(statements))
	}
	for _, statement := range statements {
		if _, err := store.db.Exec(statement); err != nil {
			t.Fatalf("purge statement %q: %v", statement, err)
		}
	}

	if got := countRows(t, store, "postings", "source = 'simplefin'"); got != 0 {
		t.Fatalf("sync postings after purge = %d, want 0", got)
	}
	if got := countRows(t, store, "checkpoints", "source = 'simplefin'"); got != 0 {
		t.Fatalf("sync checkpoints after purge = %d, want 0", got)
	}
	if got := countRows(t, store, "postings", "id = 'owner-charge'"); got != 1 {
		t.Fatal("owner posting was purged")
	}
	if got := countRows(t, store, "checkpoints", "source = 'model'"); got != 1 {
		t.Fatalf("owner checkpoints = %d, want 1", got)
	}
}
