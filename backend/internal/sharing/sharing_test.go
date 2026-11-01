package sharing_test

import (
	"encoding/json"
	"net/http"
	"net/http/httptest"
	"path/filepath"
	"strings"
	"testing"
	"time"

	"github.com/google/uuid"
	"github.com/simhozebs/net-worth-estimator/backend/internal/identity"
	authcontract "github.com/simhozebs/net-worth-estimator/backend/internal/identity/contracts"
	"github.com/simhozebs/net-worth-estimator/backend/internal/sharing"
	"github.com/simhozebs/net-worth-estimator/backend/internal/store"
	"github.com/simhozebs/net-worth-estimator/backend/internal/store/adapters/sqlite"
	"github.com/simhozebs/net-worth-estimator/backend/internal/types"
)

const testIssuer = "https://issuer.test"
const sharedPostingID = "01900000-0000-7000-8000-0000000000b1"

func testHandler(t *testing.T, readOnly bool) (*sharing.Handler, store.Database) {
	t.Helper()
	db, err := sqlite.SetupDatabase(filepath.Join(t.TempDir(), "sharing-http.db"))
	if err != nil {
		t.Fatal(err)
	}
	t.Cleanup(func() { db.Close() })
	return sharing.New(db, testIssuer, sharing.Config{ReadOnly: readOnly}), db
}

func withSubject(r *http.Request, subject string) *http.Request {
	return r.WithContext(identity.PrincipalContext(r.Context(), authcontract.Principal{Subject: subject, Name: subject}))
}

func do(t *testing.T, h *sharing.Handler, method, target, subject, body string) *httptest.ResponseRecorder {
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

func mustGroup(t *testing.T, db store.Database, owner string, members ...string) string {
	t.Helper()
	ownerID, err := db.EnsureGroupUser(testIssuer, owner)
	if err != nil {
		t.Fatal(err)
	}
	group, err := db.CreateGroup(ownerID, "Club", owner)
	if err != nil {
		t.Fatal(err)
	}
	for _, member := range members {
		memberID, err := db.EnsureGroupUser(testIssuer, member)
		if err != nil {
			t.Fatal(err)
		}
		_, code, err := db.CreateInvite(group.ID, ownerID, 5, 24*time.Hour)
		if err != nil {
			t.Fatal(err)
		}
		if _, err := db.AcceptInvite(code, memberID, member); err != nil {
			t.Fatal(err)
		}
	}
	return group.ID
}

func resourceOf(user string) string {
	return "users/" + strings.TrimPrefix(user, "user:")
}

func grantBody(postingID, audienceType, audienceID string) string {
	out, _ := json.Marshal(map[string]string{"postingId": postingID, "audienceType": audienceType, "audienceId": audienceID, "requestId": uuid.NewString()})
	return string(out)
}

func copyBody(owner, postingID string) string {
	out, _ := json.Marshal(map[string]string{"owner": owner, "postingId": postingID, "requestId": uuid.NewString()})
	return string(out)
}

func grantKeyBody(postingID, audienceType, audienceID, key string) string {
	out, _ := json.Marshal(map[string]string{"postingId": postingID, "audienceType": audienceType, "audienceId": audienceID, "requestId": key})
	return string(out)
}

func copyKeyBody(owner, postingID, key string) string {
	out, _ := json.Marshal(map[string]string{"owner": owner, "postingId": postingID, "requestId": key})
	return string(out)
}

// Every path the sharing handler serves must be claimed by the identity
// route predicate, so no future sharing route can hide inside user routes
// and no user route is misrouted into sharing.
func TestSharingRoutesClaimedByIdentity(t *testing.T) {
	for _, path := range []string{
		"/v1/shared/grants",
		"/v1/shared/exclusions",
		"/v1/shared/copies",
		"/v1/shared/audit",
		"/v1/shared/postings",
		"/v1/shared/postings/users/abc/" + sharedPostingID,
	} {
		if !identity.IsSharingRoute(path) {
			t.Fatalf("sharing path not claimed: %s", path)
		}
	}
	for _, path := range []string{
		"/v1/postings", "/v1/accounts", "/v1/financial-model",
		"/v1/groups", "/v1/groups/abc", "/v1/invites/accept",
		"/v1/shared", "/v1/shared/accounts",
	} {
		if identity.IsSharingRoute(path) {
			t.Fatalf("non-sharing path claimed: %s", path)
		}
	}
}

func TestSharingHTTPRequiresAuthentication(t *testing.T) {
	h, _ := testHandler(t, false)
	for _, route := range []struct{ method, target, body string }{
		{"GET", "/v1/shared/grants", ""},
		{"POST", "/v1/shared/grants", `{"postingId":"x"}`},
		{"DELETE", "/v1/shared/grants", `{"postingId":"x"}`},
		{"POST", "/v1/shared/exclusions", `{"postingId":"x"}`},
		{"DELETE", "/v1/shared/exclusions", `{"postingId":"x"}`},
		{"GET", "/v1/shared/postings", ""},
		{"GET", "/v1/shared/postings/users/abc/" + sharedPostingID, ""},
		{"POST", "/v1/shared/copies", `{"owner":"users/abc"}`},
	} {
		w := do(t, h, route.method, route.target, "", route.body)
		if w.Code != http.StatusUnauthorized {
			t.Fatalf("%s %s = %d, want 401", route.method, route.target, w.Code)
		}
	}
}

// The full grant/read/revoke cycle through HTTP: the grant names the
// caller's own posting, the read returns the existing transaction shape,
// and revocation denies subsequent reads.
func TestSharingHTTPGrantReadRevoke(t *testing.T) {
	h, db := testHandler(t, false)
	alice, storeA := mustUser(t, db, "alice")
	bob, _ := mustUser(t, db, "bob")
	mustPosting(t, storeA, sharedPostingID)

	w := do(t, h, "POST", "/v1/shared/grants", "alice", grantBody(sharedPostingID, "user", bob))
	if w.Code != http.StatusCreated {
		t.Fatalf("grant = %d (%s), want 201", w.Code, w.Body.String())
	}
	readTarget := "/v1/shared/postings/" + resourceOf(alice) + "/" + sharedPostingID
	w = do(t, h, "GET", readTarget, "bob", "")
	if w.Code != http.StatusOK {
		t.Fatalf("shared read = %d (%s), want 200", w.Code, w.Body.String())
	}
	var read struct {
		OwnerUserID string        `json:"ownerUserId"`
		Posting     types.Posting `json:"posting"`
	}
	if err := json.Unmarshal(w.Body.Bytes(), &read); err != nil {
		t.Fatal(err)
	}
	if read.OwnerUserID != alice || read.Posting.ID != sharedPostingID || read.Posting.Name != "Posting "+sharedPostingID {
		t.Fatalf("shared read = %+v, want owner's existing transaction shape", read)
	}
	w = do(t, h, "GET", "/v1/shared/postings", "bob", "")
	if w.Code != http.StatusOK || !strings.Contains(w.Body.String(), sharedPostingID) {
		t.Fatalf("shared list = %d (%s), want entry", w.Code, w.Body.String())
	}
	w = do(t, h, "DELETE", "/v1/shared/grants", "alice", grantBody(sharedPostingID, "user", bob))
	if w.Code != http.StatusOK {
		t.Fatalf("revoke = %d (%s), want 200", w.Code, w.Body.String())
	}
	if w := do(t, h, "GET", readTarget, "bob", ""); w.Code != http.StatusNotFound {
		t.Fatalf("revoked read = %d, want 404", w.Code)
	}
	w = do(t, h, "GET", "/v1/shared/postings", "bob", "")
	if w.Code != http.StatusOK || strings.Contains(w.Body.String(), sharedPostingID) {
		t.Fatalf("revoked list = %d (%s), want empty", w.Code, w.Body.String())
	}
}

// Only the source owner can share: the grant owner is always the caller,
// so a group admin naming another member's posting shares nothing and the
// victim's posting stays unreadable to fellow members.
func TestSharingHTTPOnlySourceOwnerGrants(t *testing.T) {
	h, db := testHandler(t, false)
	alice, storeA := mustUser(t, db, "alice")
	_, storeB := mustUser(t, db, "bob")
	mustUser(t, db, "carol")
	mustPosting(t, storeA, sharedPostingID)
	mustGroup(t, db, "alice", "bob", "carol")

	// Bob is a group member but owns no such posting: the grant fails
	// closed and shares nothing of Alice's.
	w := do(t, h, "POST", "/v1/shared/grants", "bob", grantBody(sharedPostingID, "group", mustGroupID(t, db, "alice")))
	if w.Code != http.StatusNotFound {
		t.Fatalf("admin grant for another member = %d (%s), want 404", w.Code, w.Body.String())
	}
	readTarget := "/v1/shared/postings/" + resourceOf(alice) + "/" + sharedPostingID
	if w := do(t, h, "GET", readTarget, "carol", ""); w.Code != http.StatusNotFound {
		t.Fatalf("carol read after admin grant = %d, want 404", w.Code)
	}
	// Bob sharing his own posting with the identical ID authorizes nothing
	// of Alice's: the owner direction does not leak.
	mustPosting(t, storeB, sharedPostingID)
	if w := do(t, h, "GET", readTarget, "carol", ""); w.Code != http.StatusNotFound {
		t.Fatalf("owner direction leaked = %d, want 404", w.Code)
	}
}

func mustGroupID(t *testing.T, db store.Database, owner string) string {
	t.Helper()
	ownerID, err := db.EnsureGroupUser(testIssuer, owner)
	if err != nil {
		t.Fatal(err)
	}
	groups, err := db.ListGroupsForUser(ownerID)
	if err != nil || len(groups) == 0 {
		t.Fatalf("groups = %+v, %v", groups, err)
	}
	return groups[0].ID
}

// Forged owner/posting IDs, stale membership, and outsiders all report
// 404 without distinguishing denial from absence.
func TestSharingHTTPForgedAndStaleDeny(t *testing.T) {
	h, db := testHandler(t, false)
	alice, storeA := mustUser(t, db, "alice")
	mustUser(t, db, "bob")
	mustUser(t, db, "carol")
	mustPosting(t, storeA, sharedPostingID)
	group := mustGroup(t, db, "alice", "bob")

	if w := do(t, h, "POST", "/v1/shared/grants", "alice", grantBody(sharedPostingID, "group", group)); w.Code != http.StatusCreated {
		t.Fatalf("grant = %d, want 201", w.Code)
	}
	valid := "/v1/shared/postings/" + resourceOf(alice) + "/" + sharedPostingID
	if w := do(t, h, "GET", valid, "bob", ""); w.Code != http.StatusOK {
		t.Fatalf("member read = %d, want 200", w.Code)
	}
	for _, target := range []string{
		"/v1/shared/postings/users/0000000000000000000000000000000000000000000000000000000000000000/" + sharedPostingID,
		"/v1/shared/postings/not-a-resource/" + sharedPostingID,
		"/v1/shared/postings/" + resourceOf(alice) + "/not-a-uuid",
		"/v1/shared/postings/" + resourceOf(alice) + "/01900000-0000-7000-8000-0000000000ff",
		"/v1/shared/postings/" + resourceOf(alice),
	} {
		if w := do(t, h, "GET", target, "bob", ""); w.Code != http.StatusNotFound {
			t.Fatalf("GET %s = %d, want 404", target, w.Code)
		}
	}
	// Outsider carol learns nothing.
	if w := do(t, h, "GET", valid, "carol", ""); w.Code != http.StatusNotFound {
		t.Fatalf("outsider read = %d, want 404", w.Code)
	}
	// Stale membership: after removal the same read denies.
	bobID, err := db.EnsureGroupUser(testIssuer, "bob")
	if err != nil {
		t.Fatal(err)
	}
	if err := db.RemoveMember(group, alice, bobID); err != nil {
		t.Fatal(err)
	}
	if w := do(t, h, "GET", valid, "bob", ""); w.Code != http.StatusNotFound {
		t.Fatalf("stale member read = %d, want 404", w.Code)
	}
}

// The sharing surface exposes postings only: unrelated account, balance,
// model, secret, and receipt paths do not exist here.
func TestSharingHTTPUnrelatedKindsDeny(t *testing.T) {
	h, db := testHandler(t, false)
	_, storeA := mustUser(t, db, "alice")
	mustUser(t, db, "bob")
	mustPosting(t, storeA, sharedPostingID)

	for _, target := range []struct{ method, path string }{
		{"GET", "/v1/shared/accounts"},
		{"GET", "/v1/shared/balances"},
		{"GET", "/v1/shared/financial-model"},
		{"GET", "/v1/shared/receipts"},
		{"GET", "/v1/shared/receipts/" + sharedPostingID},
		{"POST", "/v1/shared/postings"},
		{"GET", "/v1/shared"},
	} {
		w := do(t, h, target.method, target.path, "bob", "")
		if w.Code == http.StatusOK {
			t.Fatalf("%s %s = 200, want non-200", target.method, target.path)
		}
	}
}

// Delegated writes to another member's original are deferred: every
// non-GET method on the read path is rejected.
func TestSharingHTTPDeferredSourceWrites(t *testing.T) {
	h, db := testHandler(t, false)
	alice, storeA := mustUser(t, db, "alice")
	mustUser(t, db, "bob")
	mustPosting(t, storeA, sharedPostingID)
	if w := do(t, h, "POST", "/v1/shared/grants", "alice", grantBody(sharedPostingID, "user", mustID(t, db, "bob"))); w.Code != http.StatusCreated {
		t.Fatalf("grant = %d, want 201", w.Code)
	}
	target := "/v1/shared/postings/" + resourceOf(alice) + "/" + sharedPostingID
	for _, method := range []string{http.MethodPatch, http.MethodPut, http.MethodDelete, http.MethodPost} {
		w := do(t, h, method, target, "bob", `{"name":"hijack"}`)
		if w.Code != http.StatusMethodNotAllowed {
			t.Fatalf("%s shared original = %d, want 405", method, w.Code)
		}
	}
	model, err := storeA.LoadModel()
	if err != nil {
		t.Fatal(err)
	}
	if len(model.Postings) != 1 || model.Postings[0].Name != "Posting "+sharedPostingID {
		t.Fatalf("source original changed: %+v", model.Postings)
	}
}

func mustID(t *testing.T, db store.Database, subject string) string {
	t.Helper()
	user, err := db.EnsureGroupUser(testIssuer, subject)
	if err != nil {
		t.Fatal(err)
	}
	return user
}

// Read-only mode rejects grant, exclusion, and copy writes but keeps
// authorized reads.
func TestSharingHTTPReadOnlyRejectsWrites(t *testing.T) {
	h, db := testHandler(t, false)
	alice, storeA := mustUser(t, db, "alice")
	mustUser(t, db, "bob")
	mustPosting(t, storeA, sharedPostingID)
	if w := do(t, h, "POST", "/v1/shared/grants", "alice", grantBody(sharedPostingID, "user", mustID(t, db, "bob"))); w.Code != http.StatusCreated {
		t.Fatalf("grant = %d, want 201", w.Code)
	}
	ro := sharing.New(db, testIssuer, sharing.Config{ReadOnly: true})
	target := "/v1/shared/postings/" + resourceOf(alice) + "/" + sharedPostingID
	if w := do(t, ro, "GET", target, "bob", ""); w.Code != http.StatusOK {
		t.Fatalf("read-only read = %d, want 200", w.Code)
	}
	for _, route := range []struct{ method, target, body string }{
		{"POST", "/v1/shared/grants", grantBody(sharedPostingID, "user", mustID(t, db, "bob"))},
		{"DELETE", "/v1/shared/grants", grantBody(sharedPostingID, "user", mustID(t, db, "bob"))},
		{"POST", "/v1/shared/exclusions", grantBody(sharedPostingID, "all", "")},
		{"POST", "/v1/shared/copies", `{"owner":"` + resourceOf(alice) + `","postingId":"` + sharedPostingID + `"}`},
	} {
		if w := do(t, ro, route.method, route.target, "bob", route.body); w.Code != http.StatusForbidden {
			t.Fatalf("read-only %s %s = %d, want 403", route.method, route.target, w.Code)
		}
	}
}

// Accepted copies are recipient-owned: revocation keeps the copy and the
// recipient edits it in their own scope.
func TestSharingHTTPCopyIndependent(t *testing.T) {
	h, db := testHandler(t, false)
	alice, storeA := mustUser(t, db, "alice")
	_, storeB := mustUser(t, db, "bob")
	mustPosting(t, storeA, sharedPostingID)
	if w := do(t, h, "POST", "/v1/shared/grants", "alice", grantBody(sharedPostingID, "user", mustID(t, db, "bob"))); w.Code != http.StatusCreated {
		t.Fatalf("grant = %d, want 201", w.Code)
	}
	w := do(t, h, "POST", "/v1/shared/copies", "bob", copyBody(resourceOf(alice), sharedPostingID))
	if w.Code != http.StatusCreated {
		t.Fatalf("copy = %d (%s), want 201", w.Code, w.Body.String())
	}
	var copied struct {
		Posting types.Posting `json:"posting"`
	}
	if err := json.Unmarshal(w.Body.Bytes(), &copied); err != nil {
		t.Fatal(err)
	}
	if copied.Posting.ID == "" || copied.Posting.ID == sharedPostingID {
		t.Fatalf("copy kept source identity %q", copied.Posting.ID)
	}
	if w := do(t, h, "DELETE", "/v1/shared/grants", "alice", grantBody(sharedPostingID, "user", mustID(t, db, "bob"))); w.Code != http.StatusOK {
		t.Fatalf("revoke = %d, want 200", w.Code)
	}
	model, err := storeB.LoadModel()
	if err != nil {
		t.Fatal(err)
	}
	if len(model.Postings) != 1 || model.Postings[0].ID != copied.Posting.ID {
		t.Fatalf("recipient copy lost after revocation: %+v", model.Postings)
	}
	if _, err := storeB.UpdatePosting(types.Posting{
		ID: copied.Posting.ID, Name: "Edited copy", SourceAccountID: copied.Posting.SourceAccountID,
		Destinations: copied.Posting.Destinations, Amount: copied.Posting.Amount,
		PostedTime: copied.Posting.PostedTime, TransactionTime: copied.Posting.TransactionTime, Enabled: copied.Posting.Enabled,
	}); err != nil {
		t.Fatalf("recipient edit of own copy: %v", err)
	}
}

// A recipient who never provisioned financial tables can still accept a
// copy: accepting seeds their private model first.
func TestSharingHTTPCopySeedsRecipientModel(t *testing.T) {
	h, db := testHandler(t, false)
	alice, storeA := mustUser(t, db, "alice")
	bob, err := db.EnsureGroupUser(testIssuer, "bob")
	if err != nil {
		t.Fatal(err)
	}
	mustPosting(t, storeA, sharedPostingID)
	if _, err := db.GrantSharedPosting(alice, sharedPostingID, store.SharingAudienceUser, bob, uuid.NewString()); err != nil {
		t.Fatal(err)
	}
	w := do(t, h, "POST", "/v1/shared/copies", "bob", copyBody(resourceOf(alice), sharedPostingID))
	if w.Code != http.StatusCreated {
		t.Fatalf("copy = %d (%s), want 201", w.Code, w.Body.String())
	}
	scoped, err := db.User(bob)
	if err != nil {
		t.Fatal(err)
	}
	model, err := scoped.LoadModel()
	if err != nil {
		t.Fatal(err)
	}
	if model == nil || len(model.Postings) != 1 {
		t.Fatalf("recipient model after accept: %+v", model)
	}
}

// Grant/exclusion conflicts report 400 with a safe message, and malformed
// bodies never leak storage internals.
func TestSharingHTTPGrantExclusionConflicts(t *testing.T) {
	h, db := testHandler(t, false)
	_, storeA := mustUser(t, db, "alice")
	bob := mustID(t, db, "bob")
	mustPosting(t, storeA, sharedPostingID)

	grant := grantBody(sharedPostingID, "user", bob)
	if w := do(t, h, "POST", "/v1/shared/grants", "alice", grant); w.Code != http.StatusCreated {
		t.Fatalf("grant = %d, want 201", w.Code)
	}
	// Each logical request carries its own key: reusing the grant's key
	// for a different action is a 409, so every step below mints a body.
	w := do(t, h, "POST", "/v1/shared/exclusions", "alice", grantBody(sharedPostingID, "user", bob))
	if w.Code != http.StatusBadRequest || strings.Contains(w.Body.String(), "sql:") {
		t.Fatalf("exclusion over grant = %d (%s), want safe 400", w.Code, w.Body.String())
	}
	if w := do(t, h, "DELETE", "/v1/shared/grants", "alice", grantBody(sharedPostingID, "user", bob)); w.Code != http.StatusOK {
		t.Fatalf("revoke = %d, want 200", w.Code)
	}
	if w := do(t, h, "POST", "/v1/shared/exclusions", "alice", grantBody(sharedPostingID, "user", bob)); w.Code != http.StatusCreated {
		t.Fatalf("exclusion = %d (%s), want 201", w.Code, w.Body.String())
	}
	if w := do(t, h, "POST", "/v1/shared/grants", "alice", grantBody(sharedPostingID, "user", bob)); w.Code != http.StatusBadRequest {
		t.Fatalf("grant over exclusion = %d, want 400", w.Code)
	}
	if w := do(t, h, "DELETE", "/v1/shared/exclusions", "alice", grantBody(sharedPostingID, "user", bob)); w.Code != http.StatusOK {
		t.Fatalf("remove exclusion = %d, want 200", w.Code)
	}
	if w := do(t, h, "POST", "/v1/shared/grants", "alice", grant); w.Code != http.StatusCreated {
		t.Fatalf("re-grant = %d, want 201", w.Code)
	}
	w = do(t, h, "POST", "/v1/shared/grants", "alice", `{"postingId":`)
	if w.Code != http.StatusBadRequest || strings.Contains(w.Body.String(), "sql:") {
		t.Fatalf("malformed body = %d (%s), want safe 400", w.Code, w.Body.String())
	}
}

// Mutating social requests require a UUID request ID: missing and
// malformed keys fail with 400 before touching storage.
func TestSharingHTTPRequestIDRequired(t *testing.T) {
	h, db := testHandler(t, false)
	alice, storeA := mustUser(t, db, "alice")
	bob := mustID(t, db, "bob")
	mustPosting(t, storeA, sharedPostingID)

	bodies := map[string]string{
		"missing":   `{"postingId":"` + sharedPostingID + `","audienceType":"user","audienceId":"` + bob + `"}`,
		"malformed": `{"postingId":"` + sharedPostingID + `","audienceType":"user","audienceId":"` + bob + `","requestId":"nope"}`,
	}
	for name, body := range bodies {
		if w := do(t, h, "POST", "/v1/shared/grants", "alice", body); w.Code != http.StatusBadRequest {
			t.Fatalf("grant %s key = %d, want 400", name, w.Code)
		}
		if w := do(t, h, "DELETE", "/v1/shared/grants", "alice", body); w.Code != http.StatusBadRequest {
			t.Fatalf("revoke %s key = %d, want 400", name, w.Code)
		}
	}
	copyBodies := map[string]string{
		"missing":   `{"owner":"` + resourceOf(alice) + `","postingId":"` + sharedPostingID + `"}`,
		"malformed": `{"owner":"` + resourceOf(alice) + `","postingId":"` + sharedPostingID + `","requestId":"nope"}`,
	}
	for name, body := range copyBodies {
		if w := do(t, h, "POST", "/v1/shared/copies", "bob", body); w.Code != http.StatusBadRequest {
			t.Fatalf("copy %s key = %d, want 400", name, w.Code)
		}
	}
	// Rejected keys changed nothing: no grant was recorded.
	if w := do(t, h, "GET", "/v1/shared/grants", "alice", ""); w.Body.String() != "{\"grants\":[]}\n" {
		t.Fatalf("grants after rejected keys = %s, want empty", w.Body.String())
	}
}

// A retry with the same key replays the recorded outcome byte-for-byte.
func TestSharingHTTPReplayIdentical(t *testing.T) {
	h, db := testHandler(t, false)
	alice, storeA := mustUser(t, db, "alice")
	bob := mustID(t, db, "bob")
	mustPosting(t, storeA, sharedPostingID)

	grant := grantKeyBody(sharedPostingID, "user", bob, uuid.NewString())
	first := do(t, h, "POST", "/v1/shared/grants", "alice", grant)
	second := do(t, h, "POST", "/v1/shared/grants", "alice", grant)
	if first.Code != http.StatusCreated || second.Code != http.StatusCreated {
		t.Fatalf("grant replay = %d/%d, want 201/201", first.Code, second.Code)
	}
	if first.Body.String() != second.Body.String() {
		t.Fatalf("replayed grant differs:\n%s\n%s", first.Body.String(), second.Body.String())
	}
	copy := copyKeyBody(resourceOf(alice), sharedPostingID, uuid.NewString())
	firstCopy := do(t, h, "POST", "/v1/shared/copies", "bob", copy)
	secondCopy := do(t, h, "POST", "/v1/shared/copies", "bob", copy)
	if firstCopy.Code != http.StatusCreated || secondCopy.Code != http.StatusCreated {
		t.Fatalf("copy replay = %d/%d, want 201/201", firstCopy.Code, secondCopy.Code)
	}
	if firstCopy.Body.String() != secondCopy.Body.String() {
		t.Fatalf("replayed copy differs:\n%s\n%s", firstCopy.Body.String(), secondCopy.Body.String())
	}
}

// A key reused for a different action fails with 409 and no session
// discovery code: ordinary operation conflicts never retarget the session.
func TestSharingHTTPRequestIDReuseConflicts(t *testing.T) {
	h, db := testHandler(t, false)
	_, storeA := mustUser(t, db, "alice")
	bob := mustID(t, db, "bob")
	mustPosting(t, storeA, sharedPostingID)

	key := uuid.NewString()
	if w := do(t, h, "POST", "/v1/shared/grants", "alice", grantKeyBody(sharedPostingID, "user", bob, key)); w.Code != http.StatusCreated {
		t.Fatalf("grant = %d, want 201", w.Code)
	}
	w := do(t, h, "POST", "/v1/shared/exclusions", "alice", grantKeyBody(sharedPostingID, "user", bob, key))
	if w.Code != http.StatusConflict {
		t.Fatalf("exclusion with grant key = %d, want 409", w.Code)
	}
	if strings.Contains(w.Body.String(), "RESOURCE_CHANGED") {
		t.Fatalf("conflict triggers session discovery: %s", w.Body.String())
	}
	w = do(t, h, "DELETE", "/v1/shared/grants", "alice", grantKeyBody(sharedPostingID, "user", bob, key))
	if w.Code != http.StatusConflict {
		t.Fatalf("revoke with grant key = %d, want 409", w.Code)
	}
}

// The owner reads their posting's trace in order: actor, action, target,
// and time per event, with no transaction evidence in the payload. Other
// owners read only their own scope, never another owner's trace.
func TestSharingHTTPAuditTrace(t *testing.T) {
	h, db := testHandler(t, false)
	alice, storeA := mustUser(t, db, "alice")
	bob := mustID(t, db, "bob")
	mustPosting(t, storeA, sharedPostingID)

	grantKey, copyKey, revokeKey := uuid.NewString(), uuid.NewString(), uuid.NewString()
	if w := do(t, h, "POST", "/v1/shared/grants", "alice", grantKeyBody(sharedPostingID, "user", bob, grantKey)); w.Code != http.StatusCreated {
		t.Fatalf("grant = %d, want 201", w.Code)
	}
	if w := do(t, h, "POST", "/v1/shared/copies", "bob", copyKeyBody(resourceOf(alice), sharedPostingID, copyKey)); w.Code != http.StatusCreated {
		t.Fatalf("copy = %d, want 201", w.Code)
	}
	if w := do(t, h, "DELETE", "/v1/shared/grants", "alice", grantKeyBody(sharedPostingID, "user", bob, revokeKey)); w.Code != http.StatusOK {
		t.Fatalf("revoke = %d, want 200", w.Code)
	}
	target := "/v1/shared/audit?postingId=" + sharedPostingID
	w := do(t, h, "GET", target, "alice", "")
	if w.Code != http.StatusOK {
		t.Fatalf("audit = %d (%s), want 200", w.Code, w.Body.String())
	}
	var trace struct {
		Audit []store.SharingAuditEvent `json:"audit"`
	}
	if err := json.Unmarshal(w.Body.Bytes(), &trace); err != nil {
		t.Fatal(err)
	}
	want := []struct{ action, actor, key string }{
		{store.SharingAuditGrantShared, alice, grantKey},
		{store.SharingAuditCopyAccepted, bob, copyKey},
		{store.SharingAuditRevokeShared, alice, revokeKey},
	}
	if len(trace.Audit) != len(want) {
		t.Fatalf("audit events = %+v, want %d in order", trace.Audit, len(want))
	}
	for i, event := range want {
		got := trace.Audit[i]
		if got.Action != event.action || got.ActorUserID != event.actor || got.RequestID != event.key {
			t.Fatalf("audit event %d = %+v, want %v", i, got, event)
		}
		if got.OwnerUserID != alice || got.PostingID != sharedPostingID || got.CreatedAt == 0 || got.Seq == 0 {
			t.Fatalf("audit event %d target/time = %+v, want owner posting and time", i, got)
		}
		if i > 0 && got.Seq <= trace.Audit[i-1].Seq {
			t.Fatalf("audit sequence out of order: %+v", trace.Audit)
		}
	}
	// No transaction evidence in the wire payload: no posting object,
	// amount descriptor, account reference, or name.
	for _, leaked := range []string{`"posting":{`, `"amount"`, "sourceAccount", "Posting " + sharedPostingID} {
		if strings.Contains(w.Body.String(), leaked) {
			t.Fatalf("audit payload leaks evidence %q: %s", leaked, w.Body.String())
		}
	}
	// Another owner reads only their own scope: bob sees an empty trace
	// for alice's posting, not her history.
	w = do(t, h, "GET", target, "bob", "")
	if w.Code != http.StatusOK {
		t.Fatalf("cross-owner audit = %d, want 200", w.Code)
	}
	var foreign struct {
		Audit []store.SharingAuditEvent `json:"audit"`
	}
	if err := json.Unmarshal(w.Body.Bytes(), &foreign); err != nil {
		t.Fatal(err)
	}
	if len(foreign.Audit) != 0 {
		t.Fatalf("cross-owner audit = %+v, want empty", foreign.Audit)
	}
	if w := do(t, h, "GET", target, "", ""); w.Code != http.StatusUnauthorized {
		t.Fatalf("anonymous audit = %d, want 401", w.Code)
	}
	if w := do(t, h, "GET", "/v1/shared/audit", "alice", ""); w.Code != http.StatusBadRequest {
		t.Fatalf("audit without posting = %d, want 400", w.Code)
	}
	if w := do(t, h, "POST", target, "alice", ""); w.Code != http.StatusMethodNotAllowed {
		t.Fatalf("audit write = %d, want 405", w.Code)
	}
}
