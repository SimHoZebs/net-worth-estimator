package sqlite

import (
	"errors"
	"path/filepath"
	"testing"

	"github.com/simhozebs/net-worth-estimator/backend/internal/store"
)

// seedFriendship inserts one directed accepted edge directly. No request
// lifecycle writes these rows yet, so tests seed the accepted state the
// lifecycle will eventually produce in symmetric pairs.
func seedFriendship(t *testing.T, d *Database, user, friend, name string, created int64) {
	t.Helper()
	if _, err := d.db.Exec(`INSERT INTO friendships(user_id, friend_user_id, display_name, created_at) VALUES (?, ?, ?, ?)`,
		user, friend, name, created); err != nil {
		t.Fatal(err)
	}
}

func openFriendTestDB(t *testing.T) (*Database, string, string, string) {
	t.Helper()
	d, err := SetupDatabase(filepath.Join(t.TempDir(), "friends.db"))
	if err != nil {
		t.Fatal(err)
	}
	t.Cleanup(func() { d.Close() })
	// Two users share one SQLite file; isolation between them is the point.
	alice := ensureTestUser(t, d, "https://issuer.test", "alice")
	bob := ensureTestUser(t, d, "https://issuer.test", "bob")
	carol := ensureTestUser(t, d, "https://issuer.test", "carol")
	return d, alice, bob, carol
}

func TestFriendsListIsScopedToCaller(t *testing.T) {
	d, alice, bob, carol := openFriendTestDB(t)
	seedFriendship(t, d, alice, bob, "Bob", 100)
	seedFriendship(t, d, bob, alice, "Alice", 101)

	friends, err := d.ListFriends(alice, "")
	if err != nil {
		t.Fatal(err)
	}
	if len(friends) != 1 || friends[0].AccountID != bob || friends[0].DisplayName != "Bob" {
		t.Fatalf("alice friends = %+v, want only bob", friends)
	}

	// Carol shares the file but sees none of Alice's friendships.
	empty, err := d.ListFriends(carol, "")
	if err != nil {
		t.Fatal(err)
	}
	if len(empty) != 0 {
		t.Fatalf("carol friends = %+v, want none", empty)
	}

	if _, err := d.ListFriends("", ""); err == nil {
		t.Fatal("empty user listed friends")
	}
}

func TestFriendsSearchMatchesLiteralSubstring(t *testing.T) {
	d, alice, bob, carol := openFriendTestDB(t)
	seedFriendship(t, d, alice, bob, "Bobby Tables", 100)
	seedFriendship(t, d, alice, carol, "bobbie ann", 101)
	seedFriendship(t, d, bob, carol, "Carol", 102)

	// Case-insensitive substring over the caller's accepted friends only.
	found, err := d.ListFriends(alice, "BOBB")
	if err != nil {
		t.Fatal(err)
	}
	if len(found) != 2 {
		t.Fatalf("search BOBB = %+v, want both duplicate-name friends", found)
	}

	// LIKE metacharacters match literally, never as wildcards.
	seedFriendship(t, d, bob, alice, "100%_sure", 103)
	wild, err := d.ListFriends(bob, "%")
	if err != nil {
		t.Fatal(err)
	}
	for _, f := range wild {
		if f.AccountID == carol {
			t.Fatalf("search %% matched carol: %+v", wild)
		}
	}
	literal, err := d.ListFriends(bob, "100%_sure")
	if err != nil {
		t.Fatal(err)
	}
	if len(literal) != 1 || literal[0].AccountID != alice {
		t.Fatalf("literal search = %+v, want alice", literal)
	}

	// A stranger's name never matches: search stays inside accepted friends.
	none, err := d.ListFriends(carol, "Bob")
	if err != nil {
		t.Fatal(err)
	}
	if len(none) != 0 {
		t.Fatalf("carol search Bob = %+v, want none", none)
	}
}

func TestFriendsGetIsNotEnumerable(t *testing.T) {
	d, alice, bob, carol := openFriendTestDB(t)
	seedFriendship(t, d, alice, bob, "Bob", 100)

	got, err := d.GetFriend(alice, bob)
	if err != nil {
		t.Fatal(err)
	}
	if got.AccountID != bob || got.DisplayName != "Bob" || got.CreatedAt != 100 {
		t.Fatalf("GetFriend = %+v, want bob", got)
	}

	// Non-friends and unknown users report the same absence.
	for name, args := range map[string][2]string{
		"stranger": {alice, carol},
		"unknown":  {alice, "user:missing"},
		"blank":    {alice, ""},
	} {
		if _, err := d.GetFriend(args[0], args[1]); !errors.Is(err, store.ErrNotFound) {
			t.Fatalf("%s: err = %v, want not found", name, err)
		}
	}
}

func TestFriendsPredicateReadsOneEdge(t *testing.T) {
	d, alice, bob, carol := openFriendTestDB(t)
	seedFriendship(t, d, alice, bob, "Bob", 100)

	ok, err := d.AreFriends(alice, bob)
	if err != nil || !ok {
		t.Fatalf("AreFriends(alice, bob) = %v, %v; want true", ok, err)
	}
	// Directed: the reverse edge does not exist yet.
	rev, err := d.AreFriends(bob, alice)
	if err != nil || rev {
		t.Fatalf("AreFriends(bob, alice) = %v, %v; want false", rev, err)
	}
	none, err := d.AreFriends(alice, carol)
	if err != nil || none {
		t.Fatalf("AreFriends(alice, carol) = %v, %v; want false", none, err)
	}
	blank, err := d.AreFriends("", bob)
	if err != nil || blank {
		t.Fatalf("AreFriends(blank, bob) = %v, %v; want false", blank, err)
	}
}

func TestFriendsTouchDisplayRefreshesPointers(t *testing.T) {
	d, alice, bob, carol := openFriendTestDB(t)
	seedFriendship(t, d, alice, bob, "Old Bob", 100)
	seedFriendship(t, d, carol, bob, "", 101)

	d.TouchFriendDisplay(bob, "New Bob")
	got, err := d.GetFriend(alice, bob)
	if err != nil {
		t.Fatal(err)
	}
	if got.DisplayName != "New Bob" {
		t.Fatalf("display = %q, want refreshed name", got.DisplayName)
	}
	other, err := d.GetFriend(carol, bob)
	if err != nil {
		t.Fatal(err)
	}
	if other.DisplayName != "New Bob" {
		t.Fatalf("carol view = %q, want refreshed name", other.DisplayName)
	}

	// Empty names never wipe the cache.
	d.TouchFriendDisplay(bob, "   ")
	kept, err := d.GetFriend(alice, bob)
	if err != nil {
		t.Fatal(err)
	}
	if kept.DisplayName != "New Bob" {
		t.Fatalf("display = %q, want cached name kept", kept.DisplayName)
	}
}
