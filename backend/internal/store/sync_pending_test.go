package store

import (
	"reflect"
	"testing"

	"github.com/google/uuid"
)

func TestPendingUUIDsUseExactUpstreamKeysAndSurviveRefresh(t *testing.T) {
	database := openSQLiteStore(t)
	seedOwnerDocument(t, database)
	var incoming []SyncPosting
	for _, raw := range []string{"a/b", "a b", "a_b", "a.b", "a'b"} {
		item := syncPendingPosting(raw, "prime_card", "2026-08-02")
		// The provider's suggested local ID is never used.
		item.ID = ownerPostingID
		incoming = append(incoming, item)
	}
	other := syncPendingPosting("a/b", "other_card", "2026-08-02")
	incoming = append(incoming, other)
	cards := []string{"prime_card", "other_card"}
	first, err := database.ApplySyncPlan(nil, incoming, cards)
	if err != nil || first.PendingInserted != len(incoming) {
		t.Fatalf("first = %+v, err %v", first, err)
	}
	before, err := database.LoadDocument()
	if err != nil {
		t.Fatal(err)
	}
	ids := map[string]bool{}
	for _, posting := range before.Postings {
		if posting.Source != SourceSimpleFIN {
			continue
		}
		parsed, err := uuid.Parse(posting.ID)
		if err != nil || parsed.Version() != 7 || ids[posting.ID] || !posting.Pending || posting.Enabled {
			t.Fatal("sync posting has a non-unique UUID or incorrect lifecycle state")
		}
		ids[posting.ID] = true
	}
	if len(ids) != len(incoming) || countRows(t, database, "posting_sync_keys", "") != len(incoming) {
		t.Fatal("distinct raw provider keys collapsed into one identity")
	}
	again, err := database.ApplySyncPlan(nil, incoming, cards)
	if err != nil || again.PendingUpdated != len(incoming) || again.PendingInserted != 0 || again.PendingDeleted != 0 {
		t.Fatalf("repeat = %+v, err %v", again, err)
	}
	after, err := database.LoadDocument()
	if err != nil || !reflect.DeepEqual(before, after) {
		t.Fatal("repeated snapshot changed local IDs or financial content")
	}
	// A duplicate delivery of the same upstream identity remains one row.
	if _, err := database.ApplySyncPlan(nil, append(incoming, incoming[0]), cards); err != nil {
		t.Fatal(err)
	}
	if countRows(t, database, "posting_sync_keys", "") != len(incoming) {
		t.Fatal("duplicate upstream delivery created a second posting")
	}
	// Owner CSV replacement preserves both bank evidence and its private keys.
	tx, err := database.db.Begin()
	if err != nil {
		t.Fatal(err)
	}
	defer tx.Rollback()
	if err := replaceDocument(tx, ownerDocument()); err != nil {
		t.Fatal(err)
	}
	if err := tx.Commit(); err != nil {
		t.Fatal(err)
	}
	if countRows(t, database, "posting_sync_keys", "") != len(incoming) {
		t.Fatal("owner replacement lost private upstream identities")
	}
	final, err := database.ApplySyncPlan(nil, incoming, cards)
	if err != nil || final.PendingInserted != 0 || final.PendingDeleted != 0 {
		t.Fatalf("sync after owner replacement = %+v, err %v", final, err)
	}
}
