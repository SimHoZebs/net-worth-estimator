// Social-operation audit and idempotency contracts (FND-05): request-ID
// replay, key-reuse conflicts, share/revoke ordering, concurrent-revision
// conflicts, double-accept healing, and identity-only audit payloads.

package sqlite

import (
	"encoding/json"
	"errors"
	"strings"
	"sync"
	"testing"

	"github.com/simhozebs/net-worth-estimator/backend/internal/store"
)

func countSharingCopies(t *testing.T, d *Database) int {
	t.Helper()
	var n int
	if err := d.db.QueryRow(`SELECT COUNT(*) FROM sharing_copies`).Scan(&n); err != nil {
		t.Fatal(err)
	}
	return n
}

func auditActions(events []store.SharingAuditEvent) []string {
	actions := make([]string, 0, len(events))
	for _, event := range events {
		actions = append(actions, event.Action)
	}
	return actions
}

// A retry with the same key replays the recorded grant byte-for-byte and
// appends no second audit row: the mutation happened once.
func TestSharingGrantRetryReplaysIdenticalGrant(t *testing.T) {
	d := openSharingTestDB(t)
	alice, storeA := sharingUser(t, d, "alice")
	bob, _ := sharingUser(t, d, "bob")
	sharingPosting(t, storeA, sharingPostingA)

	key := sharingKey(t)
	first, err := d.GrantSharedPosting(alice, sharingPostingA, store.SharingAudienceUser, bob, key)
	if err != nil {
		t.Fatal(err)
	}
	second, err := d.GrantSharedPosting(alice, sharingPostingA, store.SharingAudienceUser, bob, key)
	if err != nil {
		t.Fatal(err)
	}
	if second != first {
		t.Fatalf("replayed grant = %+v, want %+v", second, first)
	}
	events, err := d.ListSharingAudit(alice, sharingPostingA)
	if err != nil {
		t.Fatal(err)
	}
	if len(events) != 1 {
		t.Fatalf("audit events = %v, want one grant", auditActions(events))
	}
	event := events[0]
	if event.ActorUserID != alice || event.Action != store.SharingAuditGrantShared ||
		event.OwnerUserID != alice || event.PostingID != sharingPostingA ||
		event.Audience != store.SharingAudienceUser || event.AudienceID != bob ||
		event.RequestID != key || event.CreatedAt == 0 || event.Seq == 0 {
		t.Fatalf("audit event = %+v, want actor/action/target/time", event)
	}
	if event.LinkID != "" || event.Status != "" {
		t.Fatalf("grant audit carries unexpected fields: %+v", event)
	}
}

// A key that completed one action never aliases another: reuse across
// actions or targets fails explicitly.
func TestSharingConsentKeyReuseConflicts(t *testing.T) {
	d := openSharingTestDB(t)
	alice, storeA := sharingUser(t, d, "alice")
	bob, _ := sharingUser(t, d, "bob")
	sharingPosting(t, storeA, sharingPostingA)
	sharingPosting(t, storeA, sharingPostingB)

	key := sharingKey(t)
	if _, err := d.GrantSharedPosting(alice, sharingPostingA, store.SharingAudienceUser, bob, key); err != nil {
		t.Fatal(err)
	}
	// Same key, different action or target: every one fails as conflict.
	if _, err := d.ExcludeSharedPosting(alice, sharingPostingA, store.SharingAudienceUser, bob, key); !errors.Is(err, store.ErrSharingConflict) {
		t.Fatalf("exclude with grant key = %v, want conflict", err)
	}
	if err := d.RevokeSharedPosting(alice, sharingPostingA, store.SharingAudienceUser, bob, key); !errors.Is(err, store.ErrSharingConflict) {
		t.Fatalf("revoke with grant key = %v, want conflict", err)
	}
	if _, err := d.GrantSharedPosting(alice, sharingPostingB, store.SharingAudienceUser, bob, key); !errors.Is(err, store.ErrSharingConflict) {
		t.Fatalf("grant of another posting with same key = %v, want conflict", err)
	}
	// Keys namespace per actor: the recipient's accept key lives in their
	// own keyspace, so accepting with a fresh key works while reusing that
	// accept key for another posting conflicts.
	acceptKey := sharingKey(t)
	if _, err := d.CopySharedPosting(alice, sharingPostingA, bob, acceptKey); err != nil {
		t.Fatal(err)
	}
	if _, err := d.CopySharedPosting(alice, sharingPostingB, bob, acceptKey); !errors.Is(err, store.ErrSharingConflict) {
		t.Fatalf("accept of another posting with same key = %v, want conflict", err)
	}
	// The failed reuses changed nothing: the original grant still stands
	// and the audit holds only the two completed operations in order.
	if access := checkAccess(t, d, alice, sharingPostingA, bob); !access.Allowed {
		t.Fatal("original grant lost after conflicted reuses")
	}
	events, err := d.ListSharingAudit(alice, sharingPostingA)
	if err != nil {
		t.Fatal(err)
	}
	if got := auditActions(events); len(got) != 2 || got[0] != store.SharingAuditGrantShared || got[1] != store.SharingAuditCopyAccepted {
		t.Fatalf("audit events = %v, want grant plus accept", got)
	}
}

// Request IDs are required UUIDs on every mutating social operation.
// Rejected keys change nothing and consume nothing.
func TestSharingRequestIDValidation(t *testing.T) {
	d := openSharingTestDB(t)
	alice, storeA := sharingUser(t, d, "alice")
	bob, _ := sharingUser(t, d, "bob")
	sharingPosting(t, storeA, sharingPostingA)
	if _, err := d.GrantSharedPosting(alice, sharingPostingA, store.SharingAudienceUser, bob, sharingKey(t)); err != nil {
		t.Fatal(err)
	}
	copied, err := d.CopySharedPosting(alice, sharingPostingA, bob, sharingKey(t))
	if err != nil {
		t.Fatal(err)
	}
	badKeys := []string{"", "not-a-uuid", "01900000-0000-7000-8000-0000000000A1"}
	for _, key := range badKeys {
		if _, err := d.GrantSharedPosting(alice, sharingPostingA, store.SharingAudienceUser, bob, key); !errors.Is(err, store.ErrGroupInvalid) {
			t.Fatalf("grant key %q = %v, want invalid", key, err)
		}
		if err := d.RevokeSharedPosting(alice, sharingPostingA, store.SharingAudienceUser, bob, key); !errors.Is(err, store.ErrGroupInvalid) {
			t.Fatalf("revoke key %q = %v, want invalid", key, err)
		}
		if _, err := d.ExcludeSharedPosting(alice, sharingPostingA, store.SharingAudienceUser, bob, key); !errors.Is(err, store.ErrGroupInvalid) {
			t.Fatalf("exclude key %q = %v, want invalid", key, err)
		}
		if err := d.RemoveSharedExclusion(alice, sharingPostingA, store.SharingAudienceUser, bob, key); !errors.Is(err, store.ErrGroupInvalid) {
			t.Fatalf("remove-exclusion key %q = %v, want invalid", key, err)
		}
		if _, err := d.CopySharedPosting(alice, sharingPostingA, bob, key); !errors.Is(err, store.ErrGroupInvalid) {
			t.Fatalf("accept key %q = %v, want invalid", key, err)
		}
		if _, err := d.RefreshSharingLink(bob, copied.ID, key); !errors.Is(err, store.ErrGroupInvalid) {
			t.Fatalf("refresh key %q = %v, want invalid", key, err)
		}
	}
	// Only the setup operations recorded anything.
	events, err := d.ListSharingAudit(alice, sharingPostingA)
	if err != nil {
		t.Fatal(err)
	}
	if got := auditActions(events); len(got) != 2 || got[0] != store.SharingAuditGrantShared || got[1] != store.SharingAuditCopyAccepted {
		t.Fatalf("audit events = %v, want the setup grant plus accept", got)
	}
}

// Share/revoke ordering: revocation denies unless another grant survives,
// re-grant restores, and a revoke retry replays instead of failing.
func TestSharingShareRevokeOrdering(t *testing.T) {
	d := openSharingTestDB(t)
	alice, storeA := sharingUser(t, d, "alice")
	bob, _ := sharingUser(t, d, "bob")
	sharingPosting(t, storeA, sharingPostingA)

	if _, err := d.GrantSharedPosting(alice, sharingPostingA, store.SharingAudienceUser, bob, sharingKey(t)); err != nil {
		t.Fatal(err)
	}
	if access := checkAccess(t, d, alice, sharingPostingA, bob); !access.Allowed {
		t.Fatal("granted read denied")
	}
	revokeKey := sharingKey(t)
	if err := d.RevokeSharedPosting(alice, sharingPostingA, store.SharingAudienceUser, bob, revokeKey); err != nil {
		t.Fatal(err)
	}
	if access := checkAccess(t, d, alice, sharingPostingA, bob); access.Allowed {
		t.Fatal("revoked read allowed")
	}
	if _, err := d.ReadSharedPosting(alice, sharingPostingA, bob); !errors.Is(err, store.ErrNotFound) {
		t.Fatalf("revoked read = %v, want not-found", err)
	}
	// A revoke retry replays success instead of reporting a missing grant.
	if err := d.RevokeSharedPosting(alice, sharingPostingA, store.SharingAudienceUser, bob, revokeKey); err != nil {
		t.Fatalf("revoke retry = %v, want replayed success", err)
	}
	if _, err := d.GrantSharedPosting(alice, sharingPostingA, store.SharingAudienceUser, bob, sharingKey(t)); err != nil {
		t.Fatal(err)
	}
	if access := checkAccess(t, d, alice, sharingPostingA, bob); !access.Allowed {
		t.Fatal("re-granted read denied")
	}
	if err := d.RevokeSharedPosting(alice, sharingPostingA, store.SharingAudienceUser, bob, sharingKey(t)); err != nil {
		t.Fatal(err)
	}
	if _, err := d.CopySharedPosting(alice, sharingPostingA, bob, sharingKey(t)); !errors.Is(err, store.ErrNotFound) {
		t.Fatalf("accept after revoke = %v, want not-found", err)
	}
	events, err := d.ListSharingAudit(alice, sharingPostingA)
	if err != nil {
		t.Fatal(err)
	}
	want := []string{store.SharingAuditGrantShared, store.SharingAuditRevokeShared, store.SharingAuditGrantShared, store.SharingAuditRevokeShared}
	if got := auditActions(events); len(got) != len(want) {
		t.Fatalf("audit events = %v, want %v", got, want)
	} else {
		for i := range want {
			if got[i] != want[i] {
				t.Fatalf("audit events = %v, want %v", got, want)
			}
			if i > 0 && events[i].Seq <= events[i-1].Seq {
				t.Fatalf("audit sequence out of order: %+v", events)
			}
		}
	}
}

// An accept retry replays the recorded copy: one provenance row, one audit
// event, identical content.
func TestSharingCopyRetryReplays(t *testing.T) {
	d := openSharingTestDB(t)
	alice, storeA := sharingUser(t, d, "alice")
	bob, _ := sharingUser(t, d, "bob")
	sharingPosting(t, storeA, sharingPostingA)
	if _, err := d.GrantSharedPosting(alice, sharingPostingA, store.SharingAudienceUser, bob, sharingKey(t)); err != nil {
		t.Fatal(err)
	}

	key := sharingKey(t)
	first, err := d.CopySharedPosting(alice, sharingPostingA, bob, key)
	if err != nil {
		t.Fatal(err)
	}
	second, err := d.CopySharedPosting(alice, sharingPostingA, bob, key)
	if err != nil {
		t.Fatal(err)
	}
	if second.ID != first.ID || second.Name != first.Name {
		t.Fatalf("replayed copy = %+v, want %+v", second, first)
	}
	if n := countSharingCopies(t, d); n != 1 {
		t.Fatalf("provenance rows = %d, want 1", n)
	}
	events, err := d.ListSharingAudit(alice, sharingPostingA)
	if err != nil {
		t.Fatal(err)
	}
	var accepts int
	for _, event := range events {
		if event.Action == store.SharingAuditCopyAccepted {
			accepts++
			if event.ActorUserID != bob || event.RequestID != key || event.LinkID == "" {
				t.Fatalf("accept audit = %+v, want recipient actor with link", event)
			}
		}
	}
	if accepts != 1 {
		t.Fatalf("accept audit rows = %d, want 1 (%v)", accepts, auditActions(events))
	}
}

// Distinct keys for one triple still mint one copy with one audit row:
// the triple, not the key, owns the copy. Both keys replay it afterwards.
func TestSharingCopyDistinctKeysShareOneCopy(t *testing.T) {
	d := openSharingTestDB(t)
	alice, storeA := sharingUser(t, d, "alice")
	bob, _ := sharingUser(t, d, "bob")
	sharingPosting(t, storeA, sharingPostingA)
	if _, err := d.GrantSharedPosting(alice, sharingPostingA, store.SharingAudienceUser, bob, sharingKey(t)); err != nil {
		t.Fatal(err)
	}

	first, err := d.CopySharedPosting(alice, sharingPostingA, bob, sharingKey(t))
	if err != nil {
		t.Fatal(err)
	}
	second, err := d.CopySharedPosting(alice, sharingPostingA, bob, sharingKey(t))
	if err != nil {
		t.Fatal(err)
	}
	if second.ID != first.ID {
		t.Fatalf("second accept minted %q alongside %q", second.ID, first.ID)
	}
	if n := countSharingCopies(t, d); n != 1 {
		t.Fatalf("provenance rows = %d, want 1", n)
	}
	events, err := d.ListSharingAudit(alice, sharingPostingA)
	if err != nil {
		t.Fatal(err)
	}
	var accepts int
	for _, event := range events {
		if event.Action == store.SharingAuditCopyAccepted {
			accepts++
		}
	}
	if accepts != 1 {
		t.Fatalf("accept audit rows = %d, want 1 (%v)", accepts, auditActions(events))
	}
}

// The recorded revision always matches the copied content: an edit between
// the accept's read and its provenance insert fails explicitly instead of
// recording a torn link, and the retry copies current content.
func TestSharingAcceptAfterSourceEditRecordsCurrentRevision(t *testing.T) {
	d := openSharingTestDB(t)
	alice, storeA := sharingUser(t, d, "alice")
	bob, _ := sharingUser(t, d, "bob")
	source := sharingPosting(t, storeA, sharingPostingA)
	if _, err := d.GrantSharedPosting(alice, sharingPostingA, store.SharingAudienceUser, bob, sharingKey(t)); err != nil {
		t.Fatal(err)
	}
	staleRevision, err := store.SharingSourceRevision(source)
	if err != nil {
		t.Fatal(err)
	}
	source.Name = "Edited source"
	if _, err := storeA.UpdatePosting(source); err != nil {
		t.Fatal(err)
	}
	current, err := d.ReadSharedPosting(alice, sharingPostingA, bob)
	if err != nil {
		t.Fatal(err)
	}
	currentRevision, err := store.SharingSourceRevision(current)
	if err != nil {
		t.Fatal(err)
	}
	if currentRevision == staleRevision {
		t.Fatal("owner edit did not move the source revision")
	}
	// The verification behind the accept rejects a stale snapshot.
	if _, err := d.verifySharingSourceCurrent(alice, sharingPostingA, bob, staleRevision); !errors.Is(err, store.ErrSharingConflict) {
		t.Fatalf("stale snapshot verify = %v, want conflict", err)
	}
	if _, err := d.verifySharingSourceCurrent(alice, sharingPostingA, bob, currentRevision); err != nil {
		t.Fatalf("current snapshot verify = %v, want nil", err)
	}
	copied, err := d.CopySharedPosting(alice, sharingPostingA, bob, sharingKey(t))
	if err != nil {
		t.Fatal(err)
	}
	if copied.Name != "Edited source" {
		t.Fatalf("copy content = %q, want current source content", copied.Name)
	}
	link, err := d.GetSharingLink(bob, copied.ID)
	if err != nil {
		t.Fatal(err)
	}
	if link.SourceRevision != currentRevision {
		t.Fatalf("link revision = %q, want current %q", link.SourceRevision, currentRevision)
	}
}

// Concurrent accepts with distinct keys converge on one copy with one
// audit row; concurrent retries with one shared key replay it. No
// link-identity constraint ever escapes as a raw storage error.
func TestSharingConcurrentAcceptsConverge(t *testing.T) {
	for _, shared := range []bool{false, true} {
		d := openSharingTestDB(t)
		alice, storeA := sharingUser(t, d, "alice")
		bob, _ := sharingUser(t, d, "bob")
		sharingPosting(t, storeA, sharingPostingA)
		if _, err := d.GrantSharedPosting(alice, sharingPostingA, store.SharingAudienceUser, bob, sharingKey(t)); err != nil {
			t.Fatal(err)
		}
		const racers = 16
		key := sharingKey(t)
		ids := make([]string, racers)
		errs := make([]error, racers)
		var wg sync.WaitGroup
		for i := range ids {
			wg.Add(1)
			go func(i int) {
				defer wg.Done()
				k := sharingKey(t)
				if shared {
					k = key
				}
				copied, err := d.CopySharedPosting(alice, sharingPostingA, bob, k)
				if err == nil {
					ids[i] = copied.ID
				} else {
					errs[i] = err
				}
			}(i)
		}
		wg.Wait()
		for i, err := range errs {
			if err != nil {
				t.Fatalf("shared=%v accept %d = %v, want convergence", shared, i, err)
			}
			if ids[i] == "" {
				t.Fatalf("shared=%v accept %d returned no copy", shared, i)
			}
			if ids[i] != ids[0] {
				t.Fatalf("shared=%v accept %d minted %q alongside %q", shared, i, ids[i], ids[0])
			}
		}
		if n := countSharingCopies(t, d); n != 1 {
			t.Fatalf("shared=%v provenance rows = %d, want 1", shared, n)
		}
		events, err := d.ListSharingAudit(alice, sharingPostingA)
		if err != nil {
			t.Fatal(err)
		}
		var accepts int
		for _, event := range events {
			if event.Action == store.SharingAuditCopyAccepted {
				accepts++
			}
		}
		if accepts != 1 {
			t.Fatalf("shared=%v accept audit rows = %d, want 1", shared, accepts)
		}
		d.Close()
	}
}

// Accepts racing owner edits either win with a matching revision or fail
// explicitly as conflicts; the link never records a torn revision, and a
// refresh afterwards always converges to current.
func TestSharingConcurrentAcceptAndEditNeverTears(t *testing.T) {
	d := openSharingTestDB(t)
	alice, storeA := sharingUser(t, d, "alice")
	bob, _ := sharingUser(t, d, "bob")
	posting := sharingPosting(t, storeA, sharingPostingA)
	if _, err := d.GrantSharedPosting(alice, sharingPostingA, store.SharingAudienceUser, bob, sharingKey(t)); err != nil {
		t.Fatal(err)
	}
	var wg sync.WaitGroup
	errs := make([]error, 16)
	for i := range errs {
		wg.Add(1)
		go func(i int) {
			defer wg.Done()
			if i%2 == 0 {
				_, errs[i] = d.CopySharedPosting(alice, sharingPostingA, bob, sharingKey(t))
				return
			}
			edited := posting
			edited.Name = "Race edit"
			_, errs[i] = storeA.UpdatePosting(edited)
		}(i)
	}
	wg.Wait()
	for i, err := range errs {
		if err != nil && !errors.Is(err, store.ErrSharingConflict) {
			t.Fatalf("racer %d = %v, want nil or conflict", i, err)
		}
		if err != nil && strings.Contains(err.Error(), "UNIQUE constraint") {
			t.Fatalf("racer %d leaked a storage constraint: %v", i, err)
		}
	}
	current, err := d.ReadSharedPosting(alice, sharingPostingA, bob)
	if err != nil {
		t.Fatal(err)
	}
	currentRevision, err := store.SharingSourceRevision(current)
	if err != nil {
		t.Fatal(err)
	}
	refreshed, err := d.RefreshSharingLink(bob, mustCopyID(t, d, alice, sharingPostingA, bob), sharingKey(t))
	if err != nil {
		// No accept won the race: the link does not exist yet, which is a
		// consistent outcome, not a torn one.
		if !errors.Is(err, store.ErrNotFound) {
			t.Fatalf("refresh after race = %v, want current or not-found", err)
		}
		return
	}
	_ = refreshed
	link := mustLink(t, d, alice, sharingPostingA, bob)
	if link.SourceRevision != currentRevision {
		if _, err := d.RefreshSharingLink(bob, link.CopyPostingID, sharingKey(t)); err != nil {
			t.Fatal(err)
		}
		if link = mustLink(t, d, alice, sharingPostingA, bob); link.SourceRevision != currentRevision {
			t.Fatalf("link revision = %q, want current %q", link.SourceRevision, currentRevision)
		}
	}
}

func mustCopyID(t *testing.T, d *Database, ownerID, postingID, recipientID string) string {
	t.Helper()
	copied, ok, err := d.findSharingCopy(ownerID, postingID, recipientID)
	if err != nil {
		t.Fatal(err)
	}
	if !ok {
		t.Fatal("no sharing copy recorded")
	}
	return copied.ID
}

func mustLink(t *testing.T, d *Database, ownerID, postingID, recipientID string) store.SharingLink {
	t.Helper()
	link, err := d.GetSharingLinkByID(store.SharingLinkID(ownerID, postingID, recipientID), recipientID)
	if err != nil {
		t.Fatal(err)
	}
	return link
}

// A refresh retry replays the recorded outcome; a later source edit moves
// the next refresh to source-changed, each appending its own audit row.
func TestSharingRefreshRetryReplays(t *testing.T) {
	d := openSharingTestDB(t)
	alice, storeA := sharingUser(t, d, "alice")
	bob, _ := sharingUser(t, d, "bob")
	source := sharingPosting(t, storeA, sharingPostingA)
	if _, err := d.GrantSharedPosting(alice, sharingPostingA, store.SharingAudienceUser, bob, sharingKey(t)); err != nil {
		t.Fatal(err)
	}
	copied, err := d.CopySharedPosting(alice, sharingPostingA, bob, sharingKey(t))
	if err != nil {
		t.Fatal(err)
	}

	key := sharingKey(t)
	first, err := d.RefreshSharingLink(bob, copied.ID, key)
	if err != nil {
		t.Fatal(err)
	}
	if first.Status != store.SharingLinkCurrent {
		t.Fatalf("refresh status = %q, want current", first.Status)
	}
	second, err := d.RefreshSharingLink(bob, copied.ID, key)
	if err != nil {
		t.Fatal(err)
	}
	if second.Status != first.Status || second.Link.RefreshedAt != first.Link.RefreshedAt {
		t.Fatalf("replayed refresh = %+v, want %+v", second, first)
	}
	source.Name = "Edited after refresh"
	if _, err := storeA.UpdatePosting(source); err != nil {
		t.Fatal(err)
	}
	changed, err := d.RefreshSharingLink(bob, copied.ID, sharingKey(t))
	if err != nil {
		t.Fatal(err)
	}
	if changed.Status != store.SharingLinkSourceChange {
		t.Fatalf("refresh status = %q, want source-changed", changed.Status)
	}
	if changed.CurrentSourceRevision == "" || changed.CurrentSourceRevision == first.Link.SourceRevision {
		t.Fatalf("refresh revision did not move: %+v", changed)
	}
	events, err := d.ListSharingAudit(alice, sharingPostingA)
	if err != nil {
		t.Fatal(err)
	}
	var refreshes int
	for _, event := range events {
		if event.Action == store.SharingAuditLinkRefreshed {
			refreshes++
			if event.ActorUserID != bob || event.LinkID != first.Link.LinkID || event.Status == "" {
				t.Fatalf("refresh audit = %+v, want recipient actor with link and status", event)
			}
		}
	}
	if refreshes != 2 {
		t.Fatalf("refresh audit rows = %d, want 2 (%v)", refreshes, auditActions(events))
	}
}

// The audit trail outlives the posting: deleting the source keeps the
// identity-only history while a grant retry still replays its outcome.
func TestSharingAuditSurvivesPostingDelete(t *testing.T) {
	d := openSharingTestDB(t)
	alice, storeA := sharingUser(t, d, "alice")
	bob, _ := sharingUser(t, d, "bob")
	sharingPosting(t, storeA, sharingPostingA)
	key := sharingKey(t)
	grant, err := d.GrantSharedPosting(alice, sharingPostingA, store.SharingAudienceUser, bob, key)
	if err != nil {
		t.Fatal(err)
	}
	if err := storeA.DeletePosting(sharingPostingA); err != nil {
		t.Fatal(err)
	}
	events, err := d.ListSharingAudit(alice, sharingPostingA)
	if err != nil {
		t.Fatal(err)
	}
	if len(events) != 1 || events[0].Action != store.SharingAuditGrantShared {
		t.Fatalf("audit after delete = %v, want the grant", auditActions(events))
	}
	replayed, err := d.GrantSharedPosting(alice, sharingPostingA, store.SharingAudienceUser, bob, key)
	if err != nil {
		t.Fatalf("grant retry after delete = %v, want replayed outcome", err)
	}
	if replayed != grant {
		t.Fatalf("replayed grant = %+v, want %+v", replayed, grant)
	}
}

// Clearing a scope resets its keys and trace: the same key executes fresh
// afterwards instead of replaying a cleared grant.
func TestSharingClearResetsKeysAndAudit(t *testing.T) {
	d := openSharingTestDB(t)
	alice, storeA := sharingUser(t, d, "alice")
	bob, _ := sharingUser(t, d, "bob")
	sharingPosting(t, storeA, sharingPostingA)
	key := sharingKey(t)
	if _, err := d.GrantSharedPosting(alice, sharingPostingA, store.SharingAudienceUser, bob, key); err != nil {
		t.Fatal(err)
	}
	if err := storeA.Clear(); err != nil {
		t.Fatal(err)
	}
	events, err := d.ListSharingAudit(alice, sharingPostingA)
	if err != nil {
		t.Fatal(err)
	}
	if len(events) != 0 {
		t.Fatalf("audit after clear = %v, want empty", auditActions(events))
	}
	// Clear removed the accounts too, so re-provision the scope the same
	// way as first setup before re-creating the posting.
	_, storeA = sharingUser(t, d, "alice")
	sharingPosting(t, storeA, sharingPostingA)
	if _, err := d.GrantSharedPosting(alice, sharingPostingA, store.SharingAudienceUser, bob, key); err != nil {
		t.Fatal(err)
	}
	events, err = d.ListSharingAudit(alice, sharingPostingA)
	if err != nil {
		t.Fatal(err)
	}
	if len(events) != 1 || events[0].RequestID != key {
		t.Fatalf("audit after re-grant = %+v, want one fresh grant row", events)
	}
}

// The race healer resolves a lost accept to the winner's copy without a
// second audit row, and reports a clean error when no copy exists.
func TestSharingHealCopyRace(t *testing.T) {
	d := openSharingTestDB(t)
	alice, storeA := sharingUser(t, d, "alice")
	bob, _ := sharingUser(t, d, "bob")
	sharingPosting(t, storeA, sharingPostingA)
	if _, err := d.GrantSharedPosting(alice, sharingPostingA, store.SharingAudienceUser, bob, sharingKey(t)); err != nil {
		t.Fatal(err)
	}
	winner, err := d.CopySharedPosting(alice, sharingPostingA, bob, sharingKey(t))
	if err != nil {
		t.Fatal(err)
	}
	linkID := store.SharingLinkID(alice, sharingPostingA, bob)
	healed, err := d.healSharingCopyRace(alice, sharingPostingA, bob, sharingKey(t), linkID)
	if err != nil {
		t.Fatal(err)
	}
	if healed.ID != winner.ID {
		t.Fatalf("healed copy = %q, want winner %q", healed.ID, winner.ID)
	}
	events, err := d.ListSharingAudit(alice, sharingPostingA)
	if err != nil {
		t.Fatal(err)
	}
	var accepts int
	for _, event := range events {
		if event.Action == store.SharingAuditCopyAccepted {
			accepts++
		}
	}
	if accepts != 1 {
		t.Fatalf("accept audit rows = %d, want 1", accepts)
	}
	carol, _ := sharingUser(t, d, "carol")
	if _, err := d.healSharingCopyRace(alice, sharingPostingA, carol, sharingKey(t), store.SharingLinkID(alice, sharingPostingA, carol)); err == nil {
		t.Fatal("heal without a recorded copy succeeded")
	}
}

// Audit payloads carry identities only: no amounts, names, accounts, or
// posting content, even for the copy-accepted event naming a recipient.
func TestSharingAuditCarriesNoEvidence(t *testing.T) {
	d := openSharingTestDB(t)
	alice, storeA := sharingUser(t, d, "alice")
	bob, _ := sharingUser(t, d, "bob")
	sharingPosting(t, storeA, sharingPostingA)
	if _, err := d.GrantSharedPosting(alice, sharingPostingA, store.SharingAudienceUser, bob, sharingKey(t)); err != nil {
		t.Fatal(err)
	}
	if _, err := d.CopySharedPosting(alice, sharingPostingA, bob, sharingKey(t)); err != nil {
		t.Fatal(err)
	}
	events, err := d.ListSharingAudit(alice, sharingPostingA)
	if err != nil {
		t.Fatal(err)
	}
	if len(events) != 2 {
		t.Fatalf("audit events = %v, want grant plus accept", auditActions(events))
	}
	raw, err := json.Marshal(events)
	if err != nil {
		t.Fatal(err)
	}
	var decoded []map[string]any
	if err := json.Unmarshal(raw, &decoded); err != nil {
		t.Fatal(err)
	}
	allowed := map[string]bool{
		"seq": true, "actorUserId": true, "action": true, "ownerUserId": true,
		"postingId": true, "audienceType": true, "audienceId": true,
		"linkId": true, "status": true, "requestId": true, "createdAt": true,
	}
	if len(decoded) != len(events) {
		t.Fatalf("decoded %d events, want %d", len(decoded), len(events))
	}
	for _, item := range decoded {
		for key, value := range item {
			if !allowed[key] {
				t.Fatalf("audit payload key %q = %v, want identities only", key, value)
			}
		}
	}
	payload := string(raw)
	for _, leaked := range []string{"Shared " + sharingPostingA, "checking", "expression", "amount", "balance"} {
		if strings.Contains(payload, leaked) {
			t.Fatalf("audit payload leaks transaction evidence %q: %s", leaked, payload)
		}
	}
}
