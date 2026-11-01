package friends_test

import (
	"encoding/json"
	"net/http"
	"net/http/httptest"
	"path/filepath"
	"strings"
	"testing"

	"github.com/simhozebs/net-worth-estimator/backend/internal/friends"
	"github.com/simhozebs/net-worth-estimator/backend/internal/identity"
	authcontract "github.com/simhozebs/net-worth-estimator/backend/internal/identity/contracts"
	"github.com/simhozebs/net-worth-estimator/backend/internal/store"
	"github.com/simhozebs/net-worth-estimator/backend/internal/store/adapters/sqlite"
)

const testIssuer = "https://issuer.test"

func testHandler(t *testing.T) (*friends.Handler, store.Database) {
	t.Helper()
	db, err := sqlite.SetupDatabase(filepath.Join(t.TempDir(), "friends-http.db"))
	if err != nil {
		t.Fatal(err)
	}
	t.Cleanup(func() { db.Close() })
	return friends.New(db, testIssuer, friends.Config{}), db
}

func testUser(t *testing.T, db store.Database, subject string) string {
	t.Helper()
	id, err := db.EnsureGroupUser(testIssuer, subject)
	if err != nil {
		t.Fatal(err)
	}
	return id
}

// seedEdge inserts one directed accepted edge. The request lifecycle that
// will write these rows is out of scope; tests seed accepted state.
func seedEdge(t *testing.T, db store.Database, user, friend, name string) {
	t.Helper()
	sqldb, ok := db.(*sqlite.Database)
	if !ok {
		t.Fatal("friends tests require the sqlite backend")
	}
	if _, err := sqldb.SQL().Exec(`INSERT INTO friendships(user_id, friend_user_id, display_name, created_at) VALUES (?, ?, ?, 100)`,
		user, friend, name); err != nil {
		t.Fatal(err)
	}
}

func withSubject(r *http.Request, subject string) *http.Request {
	return r.WithContext(identity.PrincipalContext(r.Context(), authcontract.Principal{Subject: subject, Name: subject}))
}

func do(t *testing.T, h *friends.Handler, method, target, subject string) *httptest.ResponseRecorder {
	t.Helper()
	r := httptest.NewRequest(method, target, strings.NewReader(""))
	if subject != "" {
		r = withSubject(r, subject)
	}
	w := httptest.NewRecorder()
	h.Routes().ServeHTTP(w, r)
	return w
}

func decodeFriends(t *testing.T, w *httptest.ResponseRecorder) []store.Friend {
	t.Helper()
	var body struct {
		Friends []store.Friend `json:"friends"`
	}
	if err := json.Unmarshal(w.Body.Bytes(), &body); err != nil {
		t.Fatal(err)
	}
	return body.Friends
}

func TestFriendsHTTPRequiresAuthentication(t *testing.T) {
	h, _ := testHandler(t)
	for _, route := range []struct{ method, target string }{
		{"GET", "/v1/friends"},
		{"GET", "/v1/friends/user:abc"},
	} {
		if w := do(t, h, route.method, route.target, ""); w.Code != http.StatusUnauthorized {
			t.Fatalf("%s %s = %d, want 401", route.method, route.target, w.Code)
		}
	}
}

func TestFriendsHTTPListAndSearchStayScoped(t *testing.T) {
	h, db := testHandler(t)
	alice := testUser(t, db, "alice")
	bob := testUser(t, db, "bob")
	carol := testUser(t, db, "carol")
	seedEdge(t, db, alice, bob, "Bobby")
	seedEdge(t, db, alice, carol, "Carol")
	seedEdge(t, db, bob, carol, "Carol")

	w := do(t, h, "GET", "/v1/friends", "alice")
	if w.Code != http.StatusOK {
		t.Fatalf("list = %d, want 200", w.Code)
	}
	if friends := decodeFriends(t, w); len(friends) != 2 {
		t.Fatalf("alice friends = %+v, want 2", friends)
	}

	w = do(t, h, "GET", "/v1/friends?search=bob", "alice")
	if w.Code != http.StatusOK {
		t.Fatalf("search = %d, want 200", w.Code)
	}
	if friends := decodeFriends(t, w); len(friends) != 1 || friends[0].AccountID != bob {
		t.Fatalf("search bob = %+v, want only bob", friends)
	}

	// Carol shares the database but sees none of Alice's friendships.
	w = do(t, h, "GET", "/v1/friends", "carol")
	if w.Code != http.StatusOK {
		t.Fatalf("carol list = %d, want 200", w.Code)
	}
	if friends := decodeFriends(t, w); len(friends) != 0 {
		t.Fatalf("carol friends = %+v, want none", friends)
	}
}

func TestFriendsHTTPGetIsNotEnumerable(t *testing.T) {
	h, db := testHandler(t)
	alice := testUser(t, db, "alice")
	bob := testUser(t, db, "bob")
	testUser(t, db, "carol")
	seedEdge(t, db, alice, bob, "Bobby")

	w := do(t, h, "GET", "/v1/friends/"+bob, "alice")
	if w.Code != http.StatusOK {
		t.Fatalf("get friend = %d, want 200", w.Code)
	}

	// A non-friend, an unknown ID, and a malformed path all read 404.
	for name, target := range map[string]string{
		"non-friend": "/v1/friends/" + testUser(t, db, "dave"),
		"unknown":    "/v1/friends/user:missing",
		"nested":     "/v1/friends/" + bob + "/extra",
	} {
		if w := do(t, h, "GET", target, "alice"); w.Code != http.StatusNotFound {
			t.Fatalf("%s = %d, want 404", name, w.Code)
		}
	}

	// Bob cannot resolve Alice's edge as his own.
	w = do(t, h, "GET", "/v1/friends/"+alice, "bob")
	if w.Code != http.StatusNotFound {
		t.Fatalf("reverse edge = %d, want 404", w.Code)
	}
}
