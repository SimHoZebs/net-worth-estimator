// Social-operation audit and idempotency (FND-05) on the landed GRP-05
// shape: per-actor request keys with recorded outcomes and byte-identical
// replay, conflict on key reuse across actions or targets, no key
// consumption by failed attempts, explicit concurrent-revision failures
// including the double-accept race, total share/revoke ordering through
// the audit sequence, and identity-only audit rows (actor, action,
// target, link, status, key, time) through the landed sharing_audit
// table with link/status/key inside the detail payload.
package sqlite

import (
	"errors"
	"strings"
	"sync"
	"testing"

	"github.com/simhozebs/net-worth-estimator/backend/internal/store"
	"github.com/simhozebs/net-worth-estimator/backend/internal/types"
)

func sharingAudit(t *testing.T, d *Database, owner, posting string) []store.SharingAuditEvent {
	t.Helper()
	events, err := d.ListSharingAudit(owner, posting)
	if err != nil {
		t.Fatal(err)
	}
	return events
}

func sharingRequestCount(t *testing.T, d *Database) int {
	t.Helper()
	var count int
	if err := d.db.QueryRow(`SELECT COUNT(*) FROM sharing_requests`).Scan(&count); err != nil {
		t.Fatal(err)
	}
	return count
}

// A grant retry with the same key returns the recorded grant verbatim
// with one audit row carrying the request key and consent target.
func TestSharingGrantReplayIdentical(t *testing.T) {
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
	if first != second {
		t.Fatalf("grant replay = %+v, want %+v", second, first)
	}
	events := sharingAudit(t, d, alice, sharingPostingA)
	if len(events) != 1 {
		t.Fatalf("audit rows = %d, want 1", len(events))
	}
	event := events[0]
	if event.Action != "grant" || event.ActorUserID != alice || event.OwnerUserID != alice ||
		event.PostingID != sharingPostingA || event.Audience != store.SharingAudienceUser ||
		event.AudienceID != bob || event.RequestID != key {
		t.Fatalf("grant audit = %+v, want actor/action/target/key", event)
	}
	if event.Seq == 0 || event.CreatedAt == 0 {
		t.Fatalf("grant audit missing sequence or time: %+v", event)
	}
}

// A key reused for a different action or target fails as a conflict and
// records nothing new.
func TestSharingKeyReuseAcrossActionsConflicts(t *testing.T) {
	d := openSharingTestDB(t)
	alice, storeA := sharingUser(t, d, "alice")
	bob, _ := sharingUser(t, d, "bob")
	sharingPosting(t, storeA, sharingPostingA)
	sharingPosting(t, storeA, sharingPostingB)

	key := sharingKey(t)
	if _, err := d.GrantSharedPosting(alice, sharingPostingA, store.SharingAudienceUser, bob, key); err != nil {
		t.Fatal(err)
	}
	// Same key, different action.
	if _, err := d.ExcludeSharedPosting(alice, sharingPostingA, store.SharingAudienceUser, bob, key); !errors.Is(err, store.ErrSharingConflict) {
		t.Fatalf("exclude with grant key = %v, want conflict", err)
	}
	// Same key and action, different target.
	if _, err := d.GrantSharedPosting(alice, sharingPostingB, store.SharingAudienceUser, bob, key); !errors.Is(err, store.ErrSharingConflict) {
		t.Fatalf("grant for other posting with same key = %v, want conflict", err)
	}
	// Revoke and exclusion-removal replays match on their own actions.
	if err := d.RevokeSharedPosting(alice, sharingPostingA, store.SharingAudienceUser, bob, key); !errors.Is(err, store.ErrSharingConflict) {
		t.Fatalf("revoke with grant key = %v, want conflict", err)
	}
	if err := d.RemoveSharedExclusion(alice, sharingPostingA, store.SharingAudienceUser, bob, key); !errors.Is(err, store.ErrSharingConflict) {
		t.Fatalf("remove-exclusion with grant key = %v, want conflict", err)
	}
	if events := sharingAudit(t, d, alice, sharingPostingA); len(events) != 1 {
		t.Fatalf("audit rows = %d, want only the committed grant", len(events))
	}
	if events := sharingAudit(t, d, alice, sharingPostingB); len(events) != 0 {
		t.Fatalf("other posting audit = %d, want none", len(events))
	}
}

// Failed attempts never consume the key: malformed keys, unknown owners
// and postings, and missing-grant revokes record nothing, and the same
// key shape executes fresh afterwards.
func TestSharingRejectedKeysConsumeNothing(t *testing.T) {
	d := openSharingTestDB(t)
	alice, storeA := sharingUser(t, d, "alice")
	bob, _ := sharingUser(t, d, "bob")
	sharingPosting(t, storeA, sharingPostingA)

	bad := []string{"", "not-a-uuid", "01900000-0000-7000-8000-0000000000A1"}
	for _, key := range bad {
		if _, err := d.GrantSharedPosting(alice, sharingPostingA, store.SharingAudienceUser, bob, key); !errors.Is(err, store.ErrGroupInvalid) {
			t.Fatalf("grant with key %q = %v, want invalid", key, err)
		}
		if err := d.RevokeSharedPosting(alice, sharingPostingA, store.SharingAudienceUser, bob, key); !errors.Is(err, store.ErrGroupInvalid) {
			t.Fatalf("revoke with key %q = %v, want invalid", key, err)
		}
		if _, err := d.ExcludeSharedPosting(alice, sharingPostingA, store.SharingAudienceUser, bob, key); !errors.Is(err, store.ErrGroupInvalid) {
			t.Fatalf("exclude with key %q = %v, want invalid", key, err)
		}
		if err := d.RemoveSharedExclusion(alice, sharingPostingA, store.SharingAudienceUser, bob, key); !errors.Is(err, store.ErrGroupInvalid) {
			t.Fatalf("remove-exclusion with key %q = %v, want invalid", key, err)
		}
		if _, err := d.CopySharedPosting(alice, sharingPostingA, bob, key); !errors.Is(err, store.ErrGroupInvalid) {
			t.Fatalf("accept with key %q = %v, want invalid", key, err)
		}
	}
	if n := sharingRequestCount(t, d); n != 0 {
		t.Fatalf("request rows after rejections = %d, want 0", n)
	}
	if events := sharingAudit(t, d, alice, sharingPostingA); len(events) != 0 {
		t.Fatalf("audit rows after rejections = %d, want 0", len(events))
	}
	// A well-formed key against a missing grant reports not-found and
	// consumes nothing; the same key executes fresh on retry.
	key := sharingKey(t)
	if err := d.RevokeSharedPosting(alice, sharingPostingA, store.SharingAudienceUser, bob, key); !errors.Is(err, store.ErrNotFound) {
		t.Fatalf("revoke of missing grant = %v, want not-found", err)
	}
	if _, err := d.GrantSharedPosting(alice, sharingPostingA, store.SharingAudienceUser, bob, key); err != nil {
		t.Fatalf("grant with unspent key = %v, want success", err)
	}
	fresh := sharingKey(t)
	if _, err := d.GrantSharedPosting(alice, sharingPostingA, store.SharingAudienceUser, bob, fresh); err != nil {
		t.Fatalf("grant with fresh key = %v, want success", err)
	}
}

// Share, revoke, replay, and re-grant order totally through the audit
// sequence: a revoke retry replays success instead of missing-grant.
func TestSharingRevokeReplayAndOrdering(t *testing.T) {
	d := openSharingTestDB(t)
	alice, storeA := sharingUser(t, d, "alice")
	bob, _ := sharingUser(t, d, "bob")
	sharingPosting(t, storeA, sharingPostingA)

	grantKey, revokeKey, regrantKey := sharingKey(t), sharingKey(t), sharingKey(t)
	if _, err := d.GrantSharedPosting(alice, sharingPostingA, store.SharingAudienceUser, bob, grantKey); err != nil {
		t.Fatal(err)
	}
	if err := d.RevokeSharedPosting(alice, sharingPostingA, store.SharingAudienceUser, bob, revokeKey); err != nil {
		t.Fatal(err)
	}
	// The revoke retry replays success, not the now-missing grant.
	if err := d.RevokeSharedPosting(alice, sharingPostingA, store.SharingAudienceUser, bob, revokeKey); err != nil {
		t.Fatalf("revoke replay = %v, want nil", err)
	}
	if _, err := d.GrantSharedPosting(alice, sharingPostingA, store.SharingAudienceUser, bob, regrantKey); err != nil {
		t.Fatal(err)
	}
	if err := d.RevokeSharedPosting(alice, sharingPostingA, store.SharingAudienceUser, bob, sharingKey(t)); err != nil {
		t.Fatal(err)
	}
	events := sharingAudit(t, d, alice, sharingPostingA)
	want := []struct {
		action, key string
	}{
		{"grant", grantKey}, {"revoke", revokeKey}, {"grant", regrantKey}, {"revoke", ""},
	}
	if len(events) != len(want) {
		t.Fatalf("audit actions = %+v, want %d rows", events, len(want))
	}
	for i, row := range want {
		if events[i].Action != row.action {
			t.Fatalf("audit[%d] action = %q, want %q", i, events[i].Action, row.action)
		}
		if row.key != "" && events[i].RequestID != row.key {
			t.Fatalf("audit[%d] key = %q, want %q", i, events[i].RequestID, row.key)
		}
		if i > 0 && events[i].Seq <= events[i-1].Seq {
			t.Fatalf("audit out of sequence order at %d: %+v", i, events)
		}
	}
}

// Accept retries replay the recorded copy; a distinct key for the same
// triple converges on it with one audit row, and both keys replay after.
func TestSharingAcceptReplayAndConverge(t *testing.T) {
	d := openSharingTestDB(t)
	alice, storeA := sharingUser(t, d, "alice")
	bob, storeB := sharingUser(t, d, "bob")
	sharingPosting(t, storeA, sharingPostingA)
	if _, err := d.GrantSharedPosting(alice, sharingPostingA, store.SharingAudienceUser, bob, sharingKey(t)); err != nil {
		t.Fatal(err)
	}

	key, other := sharingKey(t), sharingKey(t)
	first, err := d.CopySharedPosting(alice, sharingPostingA, bob, key)
	if err != nil {
		t.Fatal(err)
	}
	replay, err := d.CopySharedPosting(alice, sharingPostingA, bob, key)
	if err != nil {
		t.Fatal(err)
	}
	if replay.ID != first.ID || replay.Name != first.Name {
		t.Fatalf("accept replay = %+v, want %+v", replay, first)
	}
	converged, err := d.CopySharedPosting(alice, sharingPostingA, bob, other)
	if err != nil {
		t.Fatal(err)
	}
	if converged.ID != first.ID {
		t.Fatalf("distinct-key accept = %q, want winner %q", converged.ID, first.ID)
	}
	if replay, err := d.CopySharedPosting(alice, sharingPostingA, bob, other); err != nil || replay.ID != first.ID {
		t.Fatalf("converged key replay = %+v, %v, want %q", replay, err, first.ID)
	}
	var copies int
	if err := d.db.QueryRow(`SELECT COUNT(*) FROM sharing_copies WHERE recipient_user_id = ? AND source_owner_id = ? AND source_posting_id = ?`,
		bob, alice, sharingPostingA).Scan(&copies); err != nil {
		t.Fatal(err)
	}
	if copies != 1 {
		t.Fatalf("provenance rows = %d, want 1", copies)
	}
	events := sharingAudit(t, d, alice, sharingPostingA)
	accepted := 0
	for _, event := range events {
		if event.Action != store.SharingAuditCopyAccepted {
			continue
		}
		accepted++
		if event.ActorUserID != bob || event.LinkID != store.SharingLinkID(alice, sharingPostingA, bob) || event.RequestID == "" {
			t.Fatalf("accept audit = %+v, want recipient actor, link, and key", event)
		}
	}
	if accepted != 1 {
		t.Fatalf("accept audit rows = %d, want 1", accepted)
	}
	model, err := storeB.LoadModel()
	if err != nil {
		t.Fatal(err)
	}
	if len(model.Postings) != 1 || model.Postings[0].ID != first.ID {
		t.Fatalf("recipient model = %+v, want the one copy", model.Postings)
	}
}

// Concurrent accepts converge on one copy with one audit row however the
// keys distribute, and no raw uniqueness error escapes.
func TestSharingDoubleAcceptRaceConverges(t *testing.T) {
	for _, shared := range []bool{false, true} {
		d := openSharingTestDB(t)
		alice, storeA := sharingUser(t, d, "alice")
		bob, _ := sharingUser(t, d, "bob")
		sharingPosting(t, storeA, sharingPostingA)
		if _, err := d.GrantSharedPosting(alice, sharingPostingA, store.SharingAudienceUser, bob, sharingKey(t)); err != nil {
			t.Fatal(err)
		}
		const racers = 16
		keys := make([]string, racers)
		same := sharingKey(t)
		for i := range keys {
			keys[i] = sharingKey(t)
			if shared {
				keys[i] = same
			}
		}
		ids := make([]string, racers)
		errs := make([]error, racers)
		var wg sync.WaitGroup
		for i := 0; i < racers; i++ {
			wg.Add(1)
			go func(i int) {
				defer wg.Done()
				copied, err := d.CopySharedPosting(alice, sharingPostingA, bob, keys[i])
				if err == nil {
					ids[i] = copied.ID
				}
				errs[i] = err
			}(i)
		}
		wg.Wait()
		for i, err := range errs {
			if err != nil {
				t.Fatalf("shared=%v racer %d = %v, want convergence", shared, i, err)
			}
			if ids[i] != ids[0] {
				t.Fatalf("shared=%v racer %d copy = %q, want %q", shared, i, ids[i], ids[0])
			}
		}
		events := sharingAudit(t, d, alice, sharingPostingA)
		accepted := 0
		for _, event := range events {
			if event.Action == store.SharingAuditCopyAccepted {
				accepted++
			}
		}
		if accepted != 1 {
			t.Fatalf("shared=%v accept audit rows = %d, want 1", shared, accepted)
		}
	}
}

func TestSharingAcceptFailsOnStaleRevision(t *testing.T) {
	d := openSharingTestDB(t)
	alice, storeA := sharingUser(t, d, "alice")
	bob, _ := sharingUser(t, d, "bob")
	source := sharingPosting(t, storeA, sharingPostingA)
	if _, err := d.GrantSharedPosting(alice, sharingPostingA, store.SharingAudienceUser, bob, sharingKey(t)); err != nil {
		t.Fatal(err)
	}
	snapshot, err := store.SharingSourceRevision(source)
	if err != nil {
		t.Fatal(err)
	}
	edited := source
	edited.Name = "Concurrent revision"
	if _, err := storeA.UpdatePosting(edited); err != nil {
		t.Fatal(err)
	}
	if _, err := d.verifySharingSourceCurrent(alice, sharingPostingA, bob, snapshot); !errors.Is(err, store.ErrSharingConflict) {
		t.Fatalf("stale verify = %v, want conflict", err)
	}
	current, err := store.SharingSourceRevision(source)
	if err != nil {
		t.Fatal(err)
	}
	_ = current
	live, err := d.ReadSharedPosting(alice, sharingPostingA, bob)
	if err != nil {
		t.Fatal(err)
	}
	liveRevision, err := store.SharingSourceRevision(live)
	if err != nil {
		t.Fatal(err)
	}
	if liveRevision == snapshot {
		t.Fatalf("owner edit did not move the source revision")
	}
	if _, err := d.verifySharingSourceCurrent(alice, sharingPostingA, bob, liveRevision); err != nil {
		t.Fatalf("current verify = %v, want nil", err)
	}
	copied, err := d.CopySharedPosting(alice, sharingPostingA, bob, sharingKey(t))
	if err != nil {
		t.Fatal(err)
	}
	link := sharingLink(t, d, bob, copied.ID)
	if link.SourceRevision != liveRevision {
		t.Fatalf("link revision = %q, want current %q", link.SourceRevision, liveRevision)
	}
}

// Refresh retries replay the recorded outcome; a source edit moves the
// next refresh to source-changed with one audit row per distinct key,
// each carrying link, status, and key.
func TestSharingRefreshReplayAndStatuses(t *testing.T) {
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
	link := sharingLink(t, d, bob, copied.ID)

	key := sharingKey(t)
	first, err := d.RefreshSharingLink(bob, copied.ID, key)
	if err != nil {
		t.Fatal(err)
	}
	if first.Status != store.SharingLinkCurrent {
		t.Fatalf("refresh status = %q, want current", first.Status)
	}
	replay, err := d.RefreshSharingLink(bob, copied.ID, key)
	if err != nil {
		t.Fatal(err)
	}
	if replay.Status != first.Status || replay.Link.RefreshedAt != first.Link.RefreshedAt {
		t.Fatalf("refresh replay = %+v, want %+v", replay, first)
	}
	edited := source
	edited.Name = "Edited source"
	if _, err := storeA.UpdatePosting(edited); err != nil {
		t.Fatal(err)
	}
	moved, err := d.RefreshSharingLink(bob, copied.ID, sharingKey(t))
	if err != nil {
		t.Fatal(err)
	}
	if moved.Status != store.SharingLinkSourceChange || moved.CurrentSourceRevision == link.SourceRevision {
		t.Fatalf("post-edit refresh = %+v, want source-changed with a moved revision", moved)
	}
	events := sharingAudit(t, d, alice, sharingPostingA)
	var refreshed []store.SharingAuditEvent
	for _, event := range events {
		if event.Action == store.SharingAuditLinkRefreshed {
			refreshed = append(refreshed, event)
		}
	}
	if len(refreshed) != 2 {
		t.Fatalf("refresh audit rows = %d, want 2", len(refreshed))
	}
	if refreshed[0].Status != store.SharingLinkCurrent || refreshed[1].Status != store.SharingLinkSourceChange {
		t.Fatalf("refresh statuses = %q/%q, want current/source-changed", refreshed[0].Status, refreshed[1].Status)
	}
	for _, event := range refreshed {
		if event.ActorUserID != bob || event.LinkID != link.LinkID || event.RequestID == "" {
			t.Fatalf("refresh audit = %+v, want recipient actor, link, status, and key", event)
		}
	}
	// Key reuse across actions conflicts even for refresh keys.
	if _, err := d.CopySharedPosting(alice, sharingPostingA, bob, key); !errors.Is(err, store.ErrSharingConflict) {
		t.Fatalf("accept with refresh key = %v, want conflict", err)
	}
}

// Concurrent refreshes with one shared key converge on the winner's
// recorded outcome with one audit row: the key executes once and every
// retry replays it.
func TestSharingConcurrentRefreshSameKeyConverges(t *testing.T) {
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
	const racers = 8
	key := sharingKey(t)
	statuses := make([]string, racers)
	touches := make([]int64, racers)
	errs := make([]error, racers)
	var wg sync.WaitGroup
	for i := 0; i < racers; i++ {
		wg.Add(1)
		go func(i int) {
			defer wg.Done()
			refreshed, err := d.RefreshSharingLink(bob, copied.ID, key)
			if err == nil {
				statuses[i], touches[i] = refreshed.Status, refreshed.Link.RefreshedAt
			}
			errs[i] = err
		}(i)
	}
	wg.Wait()
	for i, err := range errs {
		if err != nil {
			t.Fatalf("racer %d = %v, want convergence", i, err)
		}
		if statuses[i] != statuses[0] || touches[i] != touches[0] {
			t.Fatalf("racer %d outcome = %q/%d, want %q/%d", i, statuses[i], touches[i], statuses[0], touches[0])
		}
	}
	events := sharingAudit(t, d, alice, sharingPostingA)
	refreshed := 0
	for _, event := range events {
		if event.Action == store.SharingAuditLinkRefreshed {
			refreshed++
		}
	}
	if refreshed != 1 {
		t.Fatalf("refresh audit rows = %d, want 1", refreshed)
	}
}

// Request keys are per-actor: the recipient may reuse the owner's key
// value in their own keyspace.
func TestSharingKeysArePerActor(t *testing.T) {
	d := openSharingTestDB(t)
	alice, storeA := sharingUser(t, d, "alice")
	bob, _ := sharingUser(t, d, "bob")
	sharingPosting(t, storeA, sharingPostingA)

	key := sharingKey(t)
	if _, err := d.GrantSharedPosting(alice, sharingPostingA, store.SharingAudienceUser, bob, key); err != nil {
		t.Fatal(err)
	}
	if _, err := d.CopySharedPosting(alice, sharingPostingA, bob, key); err != nil {
		t.Fatalf("recipient accept with owner's key value = %v, want success", err)
	}
}

// Clearing the model resets keys and user-touching audit rows: the same
// key executes fresh afterwards with a new audit row.
func TestSharingClearResetsKeysAndAudit(t *testing.T) {
	d := openSharingTestDB(t)
	alice, storeA := sharingUser(t, d, "alice")
	bob, _ := sharingUser(t, d, "bob")
	sharingPosting(t, storeA, sharingPostingA)

	key := sharingKey(t)
	if _, err := d.GrantSharedPosting(alice, sharingPostingA, store.SharingAudienceUser, bob, key); err != nil {
		t.Fatal(err)
	}
	if len(sharingAudit(t, d, alice, sharingPostingA)) != 1 {
		t.Fatal("want one audit row before clear")
	}
	scoped, err := d.User(alice)
	if err != nil {
		t.Fatal(err)
	}
	if err := scoped.Clear(); err != nil {
		t.Fatal(err)
	}
	if events := sharingAudit(t, d, alice, sharingPostingA); len(events) != 0 {
		t.Fatalf("audit after clear = %d, want empty trace", len(events))
	}
	if n := sharingRequestCount(t, d); n != 0 {
		t.Fatalf("request rows after clear = %d, want 0", n)
	}
	// The same key executes fresh afterwards with a new audit row.
	// Clear removes model rows including accounts, so re-provision
	// before re-creating the posting.
	if _, err := storeA.CreateAccount(types.Account{ID: "checking", Name: "Checking", Enabled: true}); err != nil {
		t.Fatal(err)
	}
	sharingPosting(t, storeA, sharingPostingA)
	if _, err := d.GrantSharedPosting(alice, sharingPostingA, store.SharingAudienceUser, bob, key); err != nil {
		t.Fatalf("re-grant with cleared key = %v, want success", err)
	}
	if events := sharingAudit(t, d, alice, sharingPostingA); len(events) != 1 || events[0].RequestID != key {
		t.Fatalf("audit after re-grant = %+v, want one row with the reused key", events)
	}
}

// Audit reads carry identities only: no amounts, names, accounts, memos,
// or posting content travel in events or detail payloads.
func TestSharingAuditCarriesNoEvidence(t *testing.T) {
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
	if _, err := d.RefreshSharingLink(bob, copied.ID, sharingKey(t)); err != nil {
		t.Fatal(err)
	}
	events := sharingAudit(t, d, alice, sharingPostingA)
	if len(events) == 0 {
		t.Fatal("want audit rows to scan")
	}
	raw := ""
	for _, event := range events {
		raw += event.ActorUserID + event.Action + event.OwnerUserID + event.PostingID +
			event.Audience + event.AudienceID + event.LinkID + event.Status + event.RequestID
	}
	for _, leak := range []string{"amount", "balance", "Checking", "checking", "expression", "memo", "receipt", "secret", "password", "Posting "} {
		if strings.Contains(raw, leak) {
			t.Fatalf("audit trace leaks %q: %s", leak, raw)
		}
	}
}
