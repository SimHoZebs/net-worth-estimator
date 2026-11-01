package sharing_test

import (
	"encoding/json"
	"net/http"
	"net/http/httptest"
	"path/filepath"
	"strings"
	"testing"
	"time"

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
	out, _ := json.Marshal(map[string]string{"postingId": postingID, "audienceType": audienceType, "audienceId": audienceID})
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
		"/v1/shared/postings",
		"/v1/shared/postings/users/abc/" + sharedPostingID,
		"/v1/shared/policies/01900000-0000-7000-8000-0000000000c1",
		"/v1/shared/policies/01900000-0000-7000-8000-0000000000c1/preview",
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
		{"GET", "/v1/shared/policies/01900000-0000-7000-8000-0000000000c1", ""},
		{"PUT", "/v1/shared/policies/01900000-0000-7000-8000-0000000000c1", `{"enabled":false}`},
		{"POST", "/v1/shared/policies/01900000-0000-7000-8000-0000000000c1/preview", `{"accountIds":[]}`},
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

func policyTarget(groupID string) string {
	return "/v1/shared/policies/" + groupID
}

func decodePolicyResponse(t *testing.T, body []byte) store.SharingPolicy {
	t.Helper()
	var out struct {
		Policy store.SharingPolicy `json:"policy"`
	}
	if err := json.Unmarshal(body, &out); err != nil {
		t.Fatal(err)
	}
	return out.Policy
}

func decodePreviewResponse(t *testing.T, body []byte) store.SharingPolicyPreview {
	t.Helper()
	var out struct {
		Preview store.SharingPolicyPreview `json:"preview"`
	}
	if err := json.Unmarshal(body, &out); err != nil {
		t.Fatal(err)
	}
	return out.Preview
}

// The consent flow through HTTP: an absent preference reports 404 (off by
// default), the draft preview counts exposure without persisting, enabling
// requires an owned account, and one member's opt-in never touches another
// member's state. No admin override path exists: the owner is always the
// authenticated caller.
func TestSharingHTTPPolicyConsentFlow(t *testing.T) {
	h, db := testHandler(t, false)
	_, storeA := mustUser(t, db, "alice")
	mustUser(t, db, "bob")
	mustPosting(t, storeA, sharedPostingID)
	groupID := mustGroup(t, db, "alice", "bob")
	target := policyTarget(groupID)

	if w := do(t, h, "GET", target, "alice", ""); w.Code != http.StatusNotFound {
		t.Fatalf("absent policy = %d, want 404 (off by default)", w.Code)
	}
	// Draft preview counts the one in-range posting for the two members
	// without persisting: a follow-up read still reports absent.
	previewBody := `{"accountIds":["checking"],"startDate":"2026-01-01"}`
	w := do(t, h, "POST", target+"/preview", "alice", previewBody)
	if w.Code != http.StatusOK {
		t.Fatalf("preview = %d (%s), want 200", w.Code, w.Body.String())
	}
	preview := decodePreviewResponse(t, w.Body.Bytes())
	if preview.EligiblePostings != 1 || preview.MemberCount != 2 {
		t.Fatalf("preview = %+v, want 1 eligible posting and 2 members", preview)
	}
	if previewBody := w.Body.String(); strings.Contains(previewBody, "Checking") || strings.Contains(previewBody, sharedPostingID) {
		t.Fatalf("preview leaks row detail: %s", previewBody)
	}
	if w := do(t, h, "GET", target, "alice", ""); w.Code != http.StatusNotFound {
		t.Fatalf("preview persisted policy = %d, want 404", w.Code)
	}
	// Enabling with zero accounts is rejected; a disabled draft persists.
	if w := do(t, h, "PUT", target, "alice", `{"enabled":true}`); w.Code != http.StatusBadRequest {
		t.Fatalf("enable without accounts = %d (%s), want 400", w.Code, w.Body.String())
	}
	if w := do(t, h, "PUT", target, "alice", `{"enabled":false,"accountIds":["checking"]}`); w.Code != http.StatusOK {
		t.Fatalf("disabled save = %d (%s), want 200", w.Code, w.Body.String())
	}
	if policy := decodePolicyResponse(t, do(t, h, "GET", target, "alice", "").Body.Bytes()); policy.Enabled {
		t.Fatalf("saved draft enabled itself: %+v", policy)
	}
	// Enabling opts in with a fixed setup-day-resolved start and an open
	// end; disabling again revokes on commit with a version bump.
	enable := `{"enabled":true,"accountIds":["checking"],"startDate":"2026-01-01"}`
	policy := decodePolicyResponse(t, do(t, h, "PUT", target, "alice", enable).Body.Bytes())
	if !policy.Enabled || policy.StartDate != "2026-01-01" || policy.EndDate != "" || policy.Version != 2 {
		t.Fatalf("enabled policy = %+v, want enabled from 2026-01-01 open-ended at version 2", policy)
	}
	if w := do(t, h, "PUT", target, "alice", `{"enabled":false,"accountIds":["checking"],"startDate":"2026-01-01"}`); w.Code != http.StatusOK {
		t.Fatalf("disable = %d (%s), want 200", w.Code, w.Body.String())
	}
	if policy := decodePolicyResponse(t, do(t, h, "GET", target, "alice", "").Body.Bytes()); policy.Enabled || policy.Version != 3 {
		t.Fatalf("disabled policy = %+v, want disabled at version 3", policy)
	}
	// Bob's opt-in is independent: Alice stays off.
	bobTarget := target
	if w := do(t, h, "PUT", bobTarget, "bob", `{"enabled":true,"accountIds":["checking"]}`); w.Code != http.StatusOK {
		t.Fatalf("bob enable = %d (%s), want 200", w.Code, w.Body.String())
	}
	if policy := decodePolicyResponse(t, do(t, h, "GET", target, "alice", "").Body.Bytes()); policy.Enabled {
		t.Fatalf("bob opt-in leaked into alice: %+v", policy)
	}
	// Leaving hides the surviving row without deleting it: reads fail
	// closed, and rejoining resumes the stored preference.
	bobID, err := db.EnsureGroupUser(testIssuer, "bob")
	if err != nil {
		t.Fatal(err)
	}
	aliceID, err := db.EnsureGroupUser(testIssuer, "alice")
	if err != nil {
		t.Fatal(err)
	}
	if err := db.RemoveMember(groupID, aliceID, bobID); err != nil {
		t.Fatal(err)
	}
	if w := do(t, h, "GET", target, "bob", ""); w.Code != http.StatusNotFound {
		t.Fatalf("ex-member policy read = %d, want 404", w.Code)
	}
	if w := do(t, h, "POST", target+"/preview", "bob", previewBody); w.Code != http.StatusNotFound {
		t.Fatalf("ex-member preview = %d, want 404", w.Code)
	}
	_, code, err := db.CreateInvite(groupID, aliceID, 5, 24*time.Hour)
	if err != nil {
		t.Fatal(err)
	}
	if _, err := db.AcceptInvite(code, bobID, "bob"); err != nil {
		t.Fatal(err)
	}
	if policy := decodePolicyResponse(t, do(t, h, "GET", target, "bob", "").Body.Bytes()); !policy.Enabled {
		t.Fatalf("rejoin did not resume bob's preference: %+v", policy)
	}
	// Outsiders and invalid input fail closed without enumeration.
	if w := do(t, h, "GET", target, "carol", ""); w.Code != http.StatusNotFound {
		t.Fatalf("outsider policy read = %d, want 404", w.Code)
	}
	mustUser(t, db, "carol")
	if w := do(t, h, "POST", target+"/preview", "carol", previewBody); w.Code != http.StatusNotFound {
		t.Fatalf("outsider preview = %d, want 404", w.Code)
	}
	for _, bad := range []struct{ method, body string }{
		{"PUT", `{"enabled":true,"accountIds":["nope"],"startDate":"2026-01-01"}`},
		{"PUT", `{"enabled":true,"accountIds":["checking"],"startDate":"not-a-day"}`},
		{"PUT", `{"enabled":true,"accountIds":["checking"],"startDate":"2026-02-01","endDate":"2026-01-01"}`},
	} {
		if w := do(t, h, bad.method, target, "alice", bad.body); w.Code != http.StatusBadRequest {
			t.Fatalf("%s %s = %d, want 400", bad.method, bad.body, w.Code)
		}
	}
	if w := do(t, h, "POST", target+"/preview", "alice", `{"accountIds":["checking"],"endDate":"2026-01-01"}`); w.Code != http.StatusBadRequest {
		t.Fatalf("preview with end before resolved start = %d, want 400", w.Code)
	}
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
	copyBody, _ := json.Marshal(map[string]string{"owner": resourceOf(alice), "postingId": sharedPostingID})
	w := do(t, h, "POST", "/v1/shared/copies", "bob", string(copyBody))
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
	if _, err := db.GrantSharedPosting(alice, sharedPostingID, store.SharingAudienceUser, bob); err != nil {
		t.Fatal(err)
	}
	copyBody, _ := json.Marshal(map[string]string{"owner": resourceOf(alice), "postingId": sharedPostingID})
	w := do(t, h, "POST", "/v1/shared/copies", "bob", string(copyBody))
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
	w := do(t, h, "POST", "/v1/shared/exclusions", "alice", grant)
	if w.Code != http.StatusBadRequest || strings.Contains(w.Body.String(), "sql:") {
		t.Fatalf("exclusion over grant = %d (%s), want safe 400", w.Code, w.Body.String())
	}
	if w := do(t, h, "DELETE", "/v1/shared/grants", "alice", grant); w.Code != http.StatusOK {
		t.Fatalf("revoke = %d, want 200", w.Code)
	}
	if w := do(t, h, "POST", "/v1/shared/exclusions", "alice", grant); w.Code != http.StatusCreated {
		t.Fatalf("exclusion = %d (%s), want 201", w.Code, w.Body.String())
	}
	if w := do(t, h, "POST", "/v1/shared/grants", "alice", grant); w.Code != http.StatusBadRequest {
		t.Fatalf("grant over exclusion = %d, want 400", w.Code)
	}
	if w := do(t, h, "DELETE", "/v1/shared/exclusions", "alice", grant); w.Code != http.StatusOK {
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
