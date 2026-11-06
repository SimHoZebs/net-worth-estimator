package sqlite

import (
	"errors"
	"testing"

	"github.com/simhozebs/net-worth-estimator/backend/internal/store"
)

const feedTransactionA = "01900000-0000-7000-8000-0000000000c1"
const feedTransactionB = "01900000-0000-7000-8000-0000000000c2"
const feedTransactionC = "01900000-0000-7000-8000-0000000000c3"

// feedFixture provisions two users sharing one physical file with
// identical account IDs: Alice owns the shared transactions, Bob views them.
func feedFixture(t *testing.T) (*Database, string, string, store.Store, store.Store) {
	t.Helper()
	d := openSharingTestDB(t)
	alice, storeA := sharingUser(t, d, "alice-feed")
	bob, storeB := sharingUser(t, d, "bob-feed")
	return d, alice, bob, storeA, storeB
}

func feedGrant(t *testing.T, d *Database, owner, transaction, audienceType, audienceID string) {
	t.Helper()
	if _, err := d.GrantSharedTransaction(owner, transaction, audienceType, audienceID, sharingKey(t)); err != nil {
		t.Fatal(err)
	}
}

func feedPolicy(t *testing.T, d *Database, owner, group string) store.SharingPolicy {
	t.Helper()
	return enablePolicy(t, d, owner, group, store.SharingPolicyInput{
		Enabled: true, AccountIDs: []string{"checking"}, StartDate: "2020-01-01",
	})
}

func feedItems(t *testing.T, d *Database, requester, group string) []store.GroupFeedItem {
	t.Helper()
	items, err := d.ListGroupSharedFeed(requester, group)
	if err != nil {
		t.Fatal(err)
	}
	return items
}

// A group grant puts the owner's transaction in the member's group feed with
// the group display name and audience; outsiders fail closed.
func TestGroupFeedListsGrantedTransaction(t *testing.T) {
	d, alice, bob, storeA, _ := feedFixture(t)
	group := sharingGroup(t, d, "alice-feed", "Cabin", "bob-feed")
	transaction := sharingTransaction(t, storeA, feedTransactionA)
	feedGrant(t, d, alice, feedTransactionA, store.SharingAudienceGroup, group)

	items := feedItems(t, d, bob, group)
	if len(items) != 1 {
		t.Fatalf("feed items = %d, want 1", len(items))
	}
	item := items[0]
	if item.OwnerUserID != alice || item.Transaction.ID != transaction.ID {
		t.Fatalf("feed item = %+v, want alice transaction", item)
	}
	if item.SourceDisplayName != "alice-feed" {
		t.Fatalf("source display = %q, want alice-feed", item.SourceDisplayName)
	}
	if len(item.Audiences) != 1 || item.Audiences[0].Type != store.FeedAudienceGroup ||
		item.Audiences[0].ID != group || item.Audiences[0].Name != "Cabin" {
		t.Fatalf("audiences = %+v, want one group audience for Cabin", item.Audiences)
	}
	// A non-member and an unknown group both fail closed as not-found.
	carol, _ := sharingUser(t, d, "carol-feed")
	if _, err := d.ListGroupSharedFeed(carol, group); !errors.Is(err, store.ErrNotFound) {
		t.Fatalf("non-member feed = %v, want not-found", err)
	}
	if _, err := d.ListGroupSharedFeed(bob, "00000000-0000-4000-8000-000000000000"); !errors.Is(err, store.ErrNotFound) {
		t.Fatalf("unknown group feed = %v, want not-found", err)
	}
}

// One transaction reachable through a grant, a policy, and a direct share
// lists once with every authorizing path named.
func TestGroupFeedDeduplicatesReasons(t *testing.T) {
	d, alice, bob, storeA, _ := feedFixture(t)
	group := sharingGroup(t, d, "alice-feed", "Cabin", "bob-feed")
	sharingTransaction(t, storeA, feedTransactionA)
	feedGrant(t, d, alice, feedTransactionA, store.SharingAudienceGroup, group)
	feedGrant(t, d, alice, feedTransactionA, store.SharingAudienceUser, bob)
	feedPolicy(t, d, alice, group)

	items := feedItems(t, d, bob, group)
	if len(items) != 1 {
		t.Fatalf("feed items = %d, want 1", len(items))
	}
	audiences := items[0].Audiences
	groups, direct := 0, 0
	for _, audience := range audiences {
		switch audience.Type {
		case store.FeedAudienceGroup:
			groups++
			if audience.Name != "Cabin" {
				t.Fatalf("group audience = %+v, want Cabin", audience)
			}
		case store.FeedAudienceDirect:
			direct++
		default:
			t.Fatalf("audience type = %q, want group or direct", audience.Type)
		}
	}
	if groups != 1 || direct != 1 {
		t.Fatalf("audiences = %+v, want one group plus one direct", audiences)
	}
}

// Friend-specific exclusions deny the feed while the gate still denies
// detail: user, group, and wildcard exclusions each hide the transaction.
// Each exclusion names a different audience than the surviving grant:
// an explicit share and exclusion cannot coexist for one audience.
func TestGroupFeedHonorsExclusions(t *testing.T) {
	cases := []struct {
		name        string
		grantType   string
		grantID     func(group, bob string) string
		excludeType string
		excludeID   func(group, bob string) string
	}{
		{"user", store.SharingAudienceGroup,
			func(group, _ string) string { return group },
			store.SharingAudienceUser, func(_, bob string) string { return bob }},
		{"group", store.SharingAudienceUser,
			func(_, bob string) string { return bob },
			store.SharingAudienceGroup, func(group, _ string) string { return group }},
		{"wildcard", store.SharingAudienceGroup,
			func(group, _ string) string { return group },
			store.SharingAudienceAll, func(_, _ string) string { return "" }},
	}
	for _, tc := range cases {
		t.Run(tc.name, func(t *testing.T) {
			d, alice, bob, storeA, _ := feedFixture(t)
			group := sharingGroup(t, d, "alice-feed", "Cabin", "bob-feed")
			sharingTransaction(t, storeA, feedTransactionA)
			feedGrant(t, d, alice, feedTransactionA, tc.grantType, tc.grantID(group, bob))
			if _, err := d.ExcludeSharedTransaction(alice, feedTransactionA, tc.excludeType, tc.excludeID(group, bob), sharingKey(t)); err != nil {
				t.Fatal(err)
			}
			if items := feedItems(t, d, bob, group); len(items) != 0 {
				t.Fatalf("excluded feed items = %d, want 0", len(items))
			}
			if _, err := d.ReadSharedTransaction(alice, feedTransactionA, bob); !errors.Is(err, store.ErrNotFound) {
				t.Fatalf("excluded detail = %v, want not-found", err)
			}
		})
	}
}

// Pending bank rows qualify exactly like posted ones when authorized.
func TestGroupFeedIncludesPending(t *testing.T) {
	d, alice, bob, storeA, _ := feedFixture(t)
	group := sharingGroup(t, d, "alice-feed", "Cabin", "bob-feed")
	transaction := sharingTransaction(t, storeA, feedTransactionA)
	if _, err := d.db.Exec(`UPDATE transactions SET pending = 1, source = 'banksync' WHERE user_id = ? AND id = ?`, alice, transaction.ID); err != nil {
		t.Fatal(err)
	}
	feedGrant(t, d, alice, feedTransactionA, store.SharingAudienceGroup, group)

	items := feedItems(t, d, bob, group)
	if len(items) != 1 || !items[0].Transaction.Pending {
		t.Fatalf("pending feed = %+v, want one pending transaction", items)
	}
}

// Leaving the group revokes feed and detail access to source originals;
// removal revokes the removed member the same way.
func TestGroupFeedRevokesOnLeaveAndRemoval(t *testing.T) {
	d, alice, bob, storeA, _ := feedFixture(t)
	group := sharingGroup(t, d, "alice-feed", "Cabin", "bob-feed")
	sharingTransaction(t, storeA, feedTransactionA)
	feedGrant(t, d, alice, feedTransactionA, store.SharingAudienceGroup, group)
	if items := feedItems(t, d, bob, group); len(items) != 1 {
		t.Fatalf("feed before leave = %d, want 1", len(items))
	}
	if err := d.LeaveGroup(group, bob); err != nil {
		t.Fatal(err)
	}
	if _, err := d.ListGroupSharedFeed(bob, group); !errors.Is(err, store.ErrNotFound) {
		t.Fatalf("feed after leave = %v, want not-found", err)
	}
	if _, err := d.ReadSharedTransaction(alice, feedTransactionA, bob); !errors.Is(err, store.ErrNotFound) {
		t.Fatalf("detail after leave = %v, want not-found", err)
	}

	d2, alice2, bob2, storeA2, _ := feedFixture(t)
	group2 := sharingGroup(t, d2, "alice-feed", "Cabin", "bob-feed")
	sharingTransaction(t, storeA2, feedTransactionA)
	feedGrant(t, d2, alice2, feedTransactionA, store.SharingAudienceGroup, group2)
	if err := d2.RemoveMember(group2, alice2, bob2); err != nil {
		t.Fatal(err)
	}
	if _, err := d2.ListGroupSharedFeed(bob2, group2); !errors.Is(err, store.ErrNotFound) {
		t.Fatalf("feed after removal = %v, want not-found", err)
	}
}

// Automatic policy shares flow into the feed through the reference index;
// disabling the policy revokes them on commit with no cache.
func TestGroupFeedFollowsPolicy(t *testing.T) {
	d, alice, bob, storeA, _ := feedFixture(t)
	group := sharingGroup(t, d, "alice-feed", "Cabin", "bob-feed")
	sharingTransaction(t, storeA, feedTransactionA)
	sharingTransaction(t, storeA, feedTransactionB)
	feedPolicy(t, d, alice, group)

	items := feedItems(t, d, bob, group)
	if len(items) != 2 {
		t.Fatalf("policy feed items = %d, want 2", len(items))
	}
	for _, item := range items {
		if len(item.Audiences) != 1 || item.Audiences[0].Type != store.FeedAudienceGroup {
			t.Fatalf("policy audiences = %+v, want one group audience", item.Audiences)
		}
	}
	policy, err := d.GetSharingPolicy(alice, group)
	if err != nil {
		t.Fatal(err)
	}
	policy.Enabled = false
	if _, err := d.SetSharingPolicy(alice, group, store.SharingPolicyInput{
		Enabled: false, AccountIDs: policy.AccountIDs, StartDate: policy.StartDate, EndDate: policy.EndDate,
	}); err != nil {
		t.Fatal(err)
	}
	if items := feedItems(t, d, bob, group); len(items) != 0 {
		t.Fatalf("feed after disable = %d, want 0", len(items))
	}
}

// Direct shares from group members surface in their group feed labeled as
// direct; direct shares from outside the group belong to no group feed.
func TestGroupFeedShowsDirectSharesFromMembers(t *testing.T) {
	d, alice, bob, storeA, _ := feedFixture(t)
	group := sharingGroup(t, d, "alice-feed", "Cabin", "bob-feed")
	carol, storeC := sharingUser(t, d, "carol-feed")
	sharingTransaction(t, storeA, feedTransactionA)
	sharingTransaction(t, storeC, feedTransactionB)
	feedGrant(t, d, alice, feedTransactionA, store.SharingAudienceUser, bob)
	feedGrant(t, d, carol, feedTransactionB, store.SharingAudienceUser, bob)

	items := feedItems(t, d, bob, group)
	if len(items) != 1 || items[0].Transaction.ID != feedTransactionA {
		t.Fatalf("direct feed = %+v, want only the member's direct share", items)
	}
	if len(items[0].Audiences) != 1 || items[0].Audiences[0].Type != store.FeedAudienceDirect {
		t.Fatalf("direct audiences = %+v, want one direct audience", items[0].Audiences)
	}
}

// The viewer reviews what the group sees from them: own rows shared
// with the group list in the viewer's own feed, attributed like anyone
// else's. Other members still see them.
func TestGroupFeedListsOwnRows(t *testing.T) {
	d, alice, bob, _, storeB := feedFixture(t)
	group := sharingGroup(t, d, "alice-feed", "Cabin", "bob-feed")
	transaction := sharingTransaction(t, storeB, feedTransactionC)
	feedGrant(t, d, bob, feedTransactionC, store.SharingAudienceGroup, group)

	items := feedItems(t, d, bob, group)
	if len(items) != 1 {
		t.Fatalf("own feed = %d, want 1", len(items))
	}
	item := items[0]
	if item.OwnerUserID != bob || item.Transaction.ID != transaction.ID {
		t.Fatalf("own feed item = %+v, want bob transaction", item)
	}
	if len(item.Audiences) != 1 || item.Audiences[0].Type != store.FeedAudienceGroup ||
		item.Audiences[0].ID != group {
		t.Fatalf("own audiences = %+v, want one group audience", item.Audiences)
	}
	if items := feedItems(t, d, alice, group); len(items) != 1 {
		t.Fatalf("member feed = %d, want 1", len(items))
	}
}

// Own rows shared through an enabled policy list in the viewer's own
// feed exactly like granted ones.
func TestGroupFeedListsOwnPolicyRows(t *testing.T) {
	d, _, bob, _, storeB := feedFixture(t)
	group := sharingGroup(t, d, "alice-feed", "Cabin", "bob-feed")
	sharingTransaction(t, storeB, feedTransactionC)
	feedPolicy(t, d, bob, group)

	if items := feedItems(t, d, bob, group); len(items) != 1 {
		t.Fatalf("own policy feed = %d, want 1", len(items))
	}
}

// A group or wildcard exclusion keeps an own row out of that group's
// feed; an exclusion naming another viewer does not hide it from its
// owner.
func TestGroupFeedOwnRowsHonorExclusions(t *testing.T) {
	cases := []struct {
		name        string
		excludeType string
		excludeID   func(group, bob string) string
		wantItems   int
	}{
		{"group", store.SharingAudienceGroup, func(group, _ string) string { return group }, 0},
		{"wildcard", store.SharingAudienceAll, func(_, _ string) string { return "" }, 0},
		{"other-viewer", store.SharingAudienceUser, func(_, bob string) string { return bob }, 1},
	}
	for _, tc := range cases {
		t.Run(tc.name, func(t *testing.T) {
			d, alice, bob, _, storeB := feedFixture(t)
			group := sharingGroup(t, d, "alice-feed", "Cabin", "bob-feed")
			sharingTransaction(t, storeB, feedTransactionC)
			feedPolicy(t, d, bob, group)
			feedGrant(t, d, bob, feedTransactionC, store.SharingAudienceGroup, group)
			if tc.excludeType == store.SharingAudienceGroup {
				// Exactly one intent per audience: revoke the grant
				// before excluding the same group. The policy keeps the
				// row a candidate, so the exclusion does the hiding.
				if err := d.RevokeSharedTransaction(bob, feedTransactionC, store.SharingAudienceGroup, group, sharingKey(t)); err != nil {
					t.Fatal(err)
				}
			}
			if _, err := d.ExcludeSharedTransaction(bob, feedTransactionC, tc.excludeType, tc.excludeID(group, alice), sharingKey(t)); err != nil {
				t.Fatal(err)
			}
			if items := feedItems(t, d, bob, group); len(items) != tc.wantItems {
				t.Fatalf("own excluded feed = %d, want %d", len(items), tc.wantItems)
			}
		})
	}
}

// Feed ordering stays owner then transaction so keyset consumers page stably.
func TestGroupFeedOrdersByOwnerThenTransaction(t *testing.T) {
	d, alice, bob, storeA, _ := feedFixture(t)
	carol, storeC := sharingUser(t, d, "carol-feed")
	group := sharingGroup(t, d, "alice-feed", "Cabin", "bob-feed", "carol-feed")
	sharingTransaction(t, storeA, feedTransactionB)
	sharingTransaction(t, storeA, feedTransactionA)
	sharingTransaction(t, storeC, feedTransactionC)
	feedGrant(t, d, alice, feedTransactionB, store.SharingAudienceGroup, group)
	feedGrant(t, d, alice, feedTransactionA, store.SharingAudienceGroup, group)
	feedGrant(t, d, carol, feedTransactionC, store.SharingAudienceGroup, group)

	items := feedItems(t, d, bob, group)
	if len(items) != 3 {
		t.Fatalf("feed items = %d, want 3", len(items))
	}
	for i := 1; i < len(items); i++ {
		prev, curr := items[i-1], items[i]
		if prev.OwnerUserID > curr.OwnerUserID ||
			(prev.OwnerUserID == curr.OwnerUserID && prev.Transaction.ID > curr.Transaction.ID) {
			t.Fatalf("feed out of order at %d: %+v", i, items)
		}
	}
}
