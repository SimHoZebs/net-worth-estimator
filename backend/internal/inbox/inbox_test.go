package inbox_test

import (
	"encoding/json"
	"net/http"
	"net/http/httptest"
	"path/filepath"
	"strings"
	"testing"

	"github.com/google/uuid"
	"github.com/simhozebs/net-worth-estimator/backend/internal/identity"
	authcontract "github.com/simhozebs/net-worth-estimator/backend/internal/identity/contracts"
	"github.com/simhozebs/net-worth-estimator/backend/internal/inbox"
	"github.com/simhozebs/net-worth-estimator/backend/internal/store"
	"github.com/simhozebs/net-worth-estimator/backend/internal/store/adapters/sqlite"
	"github.com/simhozebs/net-worth-estimator/backend/internal/types"
)

const testIssuer = "https://issuer.test"
const inboxPostingID = "01900000-0000-7000-8000-0000000000d1"
const inboxPostingID2 = "01900000-0000-7000-8000-0000000000d2"

func testRequestKey(t *testing.T) string {
	t.Helper()
	id, err := uuid.NewV7()
	if err != nil {
		t.Fatal(err)
	}
	return id.String()
}

func testHandler(t *testing.T, readOnly bool) (*inbox.Handler, store.Database) {
	t.Helper()
	db, err := sqlite.SetupDatabase(filepath.Join(t.TempDir(), "inbox-http.db"))
	if err != nil {
		t.Fatal(err)
	}
	t.Cleanup(func() { db.Close() })
	return inbox.New(db, testIssuer, inbox.Config{ReadOnly: readOnly}), db
}

func withSubject(r *http.Request, subject string) *http.Request {
	return r.WithContext(identity.PrincipalContext(r.Context(), authcontract.Principal{Subject: subject, Name: subject}))
}

func do(t *testing.T, h *inbox.Handler, method, target, subject, body string) *httptest.ResponseRecorder {
	t.Helper()
	r := httptest.NewRequest(method, target, strings.NewReader(body))
	if body != "" {
		r.Header.Set("Content-Type", "application/json")
	}
	if subject != "" {
		r = withSubject(r, subject)
	}
	w := httptest.NewRecorder()
	h.Routes().ServeHTTP(w, r)
	return w
}

func mustUser(t *testing.T, db store.Database, subject string) (string, store.Store) {
	t.Helper()
	user, err := db.EnsureGroupUser(testIssuer, subject)
	if err != nil {
		t.Fatal(err)
	}
	scoped, err := db.EnsureUser(user, testIssuer, subject)
	if err != nil {
		t.Fatal(err)
	}
	if _, err := scoped.CreateAccount(types.Account{ID: "checking", Name: "Checking", Enabled: true}); err != nil {
		t.Fatal(err)
	}
	return user, scoped
}

func mustPosting(t *testing.T, scoped store.Store, id string) {
	t.Helper()
	source := "checking"
	if _, err := scoped.CreatePosting(types.Posting{
		ID: id, Name: "Posting " + id, SourceAccountID: &source,
		Amount:          types.PostingAmountResolution{Resolver: "expression", Config: map[string]any{"expression": "10"}, Inputs: map[string]types.AmountInputBinding{}},
		PostedTime:      1782950400,
		TransactionTime: 1782950400,
		Enabled:         true,
	}); err != nil {
		t.Fatal(err)
	}
}

func resourceOf(user string) string {
	return "users/" + strings.TrimPrefix(user, "user:")
}

func shareBody(owner, postingID string) string {
	out, _ := json.Marshal(map[string]string{"owner": resourceOf(owner), "postingId": postingID})
	return string(out)
}

func grant(t *testing.T, db store.Database, owner, posting, audienceType, audienceID string) {
	t.Helper()
	if _, err := db.GrantSharedPosting(owner, posting, audienceType, audienceID, testRequestKey(t)); err != nil {
		t.Fatal(err)
	}
}

type inboxList struct {
	Items []store.InboxShareItem `json:"items"`
	Count int                    `json:"unreadCount"`
}

func getList(t *testing.T, h *inbox.Handler, target, subject string) (int, inboxList) {
	t.Helper()
	w := do(t, h, http.MethodGet, target, subject, "")
	var list inboxList
	if w.Code == http.StatusOK {
		if err := json.Unmarshal(w.Body.Bytes(), &list); err != nil {
			t.Fatal(err)
		}
	}
	return w.Code, list
}

func postItem(t *testing.T, h *inbox.Handler, target, subject, body string) (int, store.InboxShareItem) {
	t.Helper()
	w := do(t, h, http.MethodPost, target, subject, body)
	var out struct {
		Item store.InboxShareItem `json:"item"`
	}
	if w.Code == http.StatusOK {
		if err := json.Unmarshal(w.Body.Bytes(), &out); err != nil {
			t.Fatal(err)
		}
	}
	return w.Code, out.Item
}

// Every path the inbox handler serves must be claimed by the identity
// route predicate, so no future inbox route can hide inside user routes
// and no user route is misrouted into the inbox.
func TestInboxRoutesClaimedByIdentity(t *testing.T) {
	for _, path := range []string{
		"/v1/inbox",
		"/v1/inbox/shares/accept",
		"/v1/inbox/shares/decline",
		"/v1/inbox/shares/dismiss",
		"/v1/inbox/shares/read",
	} {
		if !identity.IsInboxRoute(path) {
			t.Fatalf("inbox route %s not claimed by identity", path)
		}
	}
	for _, path := range []string{
		"/v1/inbox/other",
		"/v1/inbox/shares",
		"/v1/inbox/shares/accept/extra",
		"/v1/groups",
		"/v1/shared/postings",
		"/v1/accounts",
	} {
		if identity.IsInboxRoute(path) {
			t.Fatalf("non-inbox route %s claimed by identity", path)
		}
	}
}

func TestInboxHTTPRequiresAuthentication(t *testing.T) {
	h, _ := testHandler(t, false)
	for _, target := range []string{"/v1/inbox", "/v1/inbox/shares/accept", "/v1/inbox/shares/decline", "/v1/inbox/shares/dismiss", "/v1/inbox/shares/read"} {
		method := http.MethodGet
		if target != "/v1/inbox" {
			method = http.MethodPost
		}
		if w := do(t, h, method, target, "", `{"owner":"users/0","postingId":"x"}`); w.Code != http.StatusUnauthorized {
			t.Fatalf("%s %s = %d, want 401", method, target, w.Code)
		}
	}
}

func TestInboxHTTPListFilters(t *testing.T) {
	h, db := testHandler(t, false)
	alice, storeA := mustUser(t, db, "alice")
	bob, _ := mustUser(t, db, "bob")
	mustPosting(t, storeA, inboxPostingID)
	mustPosting(t, storeA, inboxPostingID2)
	grant(t, db, alice, inboxPostingID, store.SharingAudienceUser, bob)
	grant(t, db, alice, inboxPostingID2, store.SharingAudienceUser, bob)

	if code, list := getList(t, h, "/v1/inbox", "bob"); code != http.StatusOK || len(list.Items) != 2 || list.Count != 2 {
		t.Fatalf("default list = %d items unread %d, want 2 pending unread 2", len(list.Items), list.Count)
	}
	if code, item := postItem(t, h, "/v1/inbox/shares/accept", "bob", shareBody(alice, inboxPostingID)); code != http.StatusOK || item.Status != store.InboxStatusAccepted {
		t.Fatalf("accept = %d %+v, want accepted", code, item)
	}
	if code, list := getList(t, h, "/v1/inbox", "bob"); code != http.StatusOK || len(list.Items) != 1 || list.Items[0].PostingID != inboxPostingID2 {
		t.Fatalf("pending list = %+v, want only the undecided share", list.Items)
	}
	if code, list := getList(t, h, "/v1/inbox?status=accepted", "bob"); code != http.StatusOK || len(list.Items) != 1 || list.Items[0].CopyPostingID == "" {
		t.Fatalf("accepted list = %+v, want the accepted share with copy", list.Items)
	}
	if code, list := getList(t, h, "/v1/inbox?status=all", "bob"); code != http.StatusOK || len(list.Items) != 2 {
		t.Fatalf("all list = %d items, want 2", len(list.Items))
	}
	if code, _ := getList(t, h, "/v1/inbox?status=bogus", "bob"); code != http.StatusBadRequest {
		t.Fatalf("bogus filter = %d, want 400", code)
	}
	if code, list := getList(t, h, "/v1/inbox?status=canceled", "carol-subject"); code != http.StatusOK || len(list.Items) != 0 {
		t.Fatalf("outsider list = %d, want empty", len(list.Items))
	}
}

// Accepting twice saves one copy; declining a direct share removes the
// recipient from the sender's list; revocation cancels the pending item
// without content; forged shares fail closed.
func TestInboxHTTPAcceptDeclineCancel(t *testing.T) {
	h, db := testHandler(t, false)
	alice, storeA := mustUser(t, db, "alice")
	bob, _ := mustUser(t, db, "bob")
	mustPosting(t, storeA, inboxPostingID)
	mustPosting(t, storeA, inboxPostingID2)
	grant(t, db, alice, inboxPostingID, store.SharingAudienceUser, bob)
	grant(t, db, alice, inboxPostingID2, store.SharingAudienceUser, bob)

	// Listing records the sightings that later revocation cancels.
	if code, list := getList(t, h, "/v1/inbox", "bob"); code != http.StatusOK || len(list.Items) != 2 {
		t.Fatalf("initial list = %+v, want 2 pending", list.Items)
	}
	code, first := postItem(t, h, "/v1/inbox/shares/accept", "bob", shareBody(alice, inboxPostingID))
	if code != http.StatusOK || first.CopyPostingID == "" {
		t.Fatalf("accept = %d %+v", code, first)
	}
	code, second := postItem(t, h, "/v1/inbox/shares/accept", "bob", shareBody(alice, inboxPostingID))
	if code != http.StatusOK || second.CopyPostingID != first.CopyPostingID {
		t.Fatalf("accept retry = %d %+v, want same copy %q", code, second, first.CopyPostingID)
	}
	// Revoking a pending share cancels it without content; accepting
	// afterwards fails closed.
	if err := db.RevokeSharedPosting(alice, inboxPostingID2, store.SharingAudienceUser, bob, testRequestKey(t)); err != nil {
		t.Fatal(err)
	}
	if code, list := getList(t, h, "/v1/inbox?status=canceled", "bob"); code != http.StatusOK || len(list.Items) != 1 || list.Items[0].PostingID != inboxPostingID2 || list.Items[0].Posting != nil {
		t.Fatalf("canceled list = %+v, want one item without preview", list.Items)
	}
	if w := do(t, h, http.MethodPost, "/v1/inbox/shares/accept", "bob", shareBody(alice, inboxPostingID2)); w.Code != http.StatusNotFound {
		t.Fatalf("accept-after-revoke = %d, want 404", w.Code)
	}
	// Resharing returns the item to pending; declining then removes the
	// recipient from the sender's list.
	grant(t, db, alice, inboxPostingID2, store.SharingAudienceUser, bob)
	if code, list := getList(t, h, "/v1/inbox", "bob"); code != http.StatusOK || len(list.Items) != 1 || list.Items[0].Status != store.InboxStatusPending {
		t.Fatalf("reshared list = %+v, want one pending", list.Items)
	}
	code, declined := postItem(t, h, "/v1/inbox/shares/decline", "bob", shareBody(alice, inboxPostingID2))
	if code != http.StatusOK || declined.Status != store.InboxStatusDeclined || declined.Posting != nil {
		t.Fatalf("decline = %d %+v, want declined without preview", code, declined)
	}
	grants, err := db.ListSharingGrants(alice)
	if err != nil {
		t.Fatal(err)
	}
	if len(grants) != 1 || grants[0].PostingID != inboxPostingID {
		t.Fatalf("sender grants = %+v, want declined share gone", grants)
	}
	unknownOwner := "user:aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa"
	if w := do(t, h, http.MethodPost, "/v1/inbox/shares/accept", "bob", shareBody(unknownOwner, inboxPostingID)); w.Code != http.StatusNotFound {
		t.Fatalf("forged-owner accept = %d, want 404", w.Code)
	}
	if w := do(t, h, http.MethodPost, "/v1/inbox/shares/accept", "bob", `{"owner":"nope","postingId":"`+inboxPostingID+`"}`); w.Code != http.StatusBadRequest {
		t.Fatalf("malformed-owner accept = %d, want 400", w.Code)
	}
	if w := do(t, h, http.MethodDelete, "/v1/inbox", "bob", ""); w.Code != http.StatusMethodNotAllowed {
		t.Fatalf("DELETE inbox = %d, want 405", w.Code)
	}
}

// Dismissing hides without deciding and unhiding restores; unread state
// changes only through explicit marking, never through listing or
// deciding.
func TestInboxHTTPDismissAndRead(t *testing.T) {
	h, db := testHandler(t, false)
	alice, storeA := mustUser(t, db, "alice")
	bob, _ := mustUser(t, db, "bob")
	mustPosting(t, storeA, inboxPostingID)
	grant(t, db, alice, inboxPostingID, store.SharingAudienceUser, bob)

	if _, list := getList(t, h, "/v1/inbox", "bob"); len(list.Items) != 1 || !list.Items[0].Unread {
		t.Fatalf("initial = %+v, want one unread", list.Items)
	}
	if code, item := postItem(t, h, "/v1/inbox/shares/dismiss", "bob", shareBody(alice, inboxPostingID)); code != http.StatusOK || !item.Dismissed {
		t.Fatalf("dismiss = %d %+v", code, item)
	}
	if _, list := getList(t, h, "/v1/inbox", "bob"); len(list.Items) != 0 {
		t.Fatalf("dismissed still listed: %+v", list.Items)
	}
	if _, list := getList(t, h, "/v1/inbox?showDismissed=1", "bob"); len(list.Items) != 1 {
		t.Fatalf("show-dismissed = %d items, want 1", len(list.Items))
	}
	if code, item := postItem(t, h, "/v1/inbox/shares/dismiss", "bob", `{"owner":"`+resourceOf(alice)+`","postingId":"`+inboxPostingID+`","dismissed":false}`); code != http.StatusOK || item.Dismissed {
		t.Fatalf("unhide = %d %+v", code, item)
	}
	if code, item := postItem(t, h, "/v1/inbox/shares/accept", "bob", shareBody(alice, inboxPostingID)); code != http.StatusOK || !item.Unread {
		t.Fatalf("deciding cleared unread: %+v", item)
	}
	if code, item := postItem(t, h, "/v1/inbox/shares/read", "bob", shareBody(alice, inboxPostingID)); code != http.StatusOK || item.Unread {
		t.Fatalf("mark-read = %d %+v", code, item)
	}
	if _, list := getList(t, h, "/v1/inbox?status=all", "bob"); list.Count != 0 {
		t.Fatalf("unread count = %d after mark-read, want 0", list.Count)
	}
	if code, item := postItem(t, h, "/v1/inbox/shares/read", "bob", `{"owner":"`+resourceOf(alice)+`","postingId":"`+inboxPostingID+`","read":false}`); code != http.StatusOK || !item.Unread {
		t.Fatalf("mark-unread = %d %+v", code, item)
	}
}

func TestInboxHTTPReadOnlyRejectsWrites(t *testing.T) {
	h, db := testHandler(t, true)
	alice, storeA := mustUser(t, db, "alice")
	bob, _ := mustUser(t, db, "bob")
	mustPosting(t, storeA, inboxPostingID)
	grant(t, db, alice, inboxPostingID, store.SharingAudienceUser, bob)

	if code, _ := getList(t, h, "/v1/inbox", "bob"); code != http.StatusOK {
		t.Fatalf("read-only list = %d, want 200", code)
	}
	for _, target := range []string{"/v1/inbox/shares/accept", "/v1/inbox/shares/decline", "/v1/inbox/shares/dismiss", "/v1/inbox/shares/read"} {
		if w := do(t, h, http.MethodPost, target, "bob", shareBody(alice, inboxPostingID)); w.Code != http.StatusForbidden {
			t.Fatalf("read-only %s = %d, want 403", target, w.Code)
		}
	}
}
