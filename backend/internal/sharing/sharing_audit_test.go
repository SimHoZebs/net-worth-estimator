package sharing_test

// Social-operation idempotency over HTTP (FND-05): mutating share routes
// require a client request ID, retries replay byte-for-byte, key reuse
// across actions reports 409 without session discovery, and the source
// owner reads the identity-only audit trace at GET /v1/shared/audit.

import (
	"encoding/json"
	"net/http"
	"strings"
	"testing"

	"github.com/simhozebs/net-worth-estimator/backend/internal/sharing"
	"github.com/simhozebs/net-worth-estimator/backend/internal/store"
)

// Mutating share routes reject missing or malformed request IDs with 400
// before touching storage.
func TestSharingHTTPRequiresRequestID(t *testing.T) {
	h, db := testHandler(t, false)
	alice, storeA := mustUser(t, db, "alice")
	bob := mustID(t, db, "bob")
	mustPosting(t, storeA, sharedPostingID)

	bodies := []struct{ method, target, body string }{
		{"POST", "/v1/shared/grants", grantBodyNoKey(sharedPostingID, "user", bob)},
		{"DELETE", "/v1/shared/grants", grantBodyNoKey(sharedPostingID, "user", bob)},
		{"POST", "/v1/shared/exclusions", grantBodyNoKey(sharedPostingID, "all", "")},
		{"DELETE", "/v1/shared/exclusions", grantBodyNoKey(sharedPostingID, "all", "")},
		{"POST", "/v1/shared/grants", grantBodyBadKey(sharedPostingID, "user", bob)},
		{
			"POST", "/v1/shared/copies",
			`{"owner":"` + resourceOf(alice) + `","postingId":"` + sharedPostingID + `"}`,
		},
		{
			"POST", "/v1/shared/copies",
			`{"owner":"` + resourceOf(alice) + `","postingId":"` + sharedPostingID + `","requestId":"nope"}`,
		},
	}
	for _, route := range bodies {
		if w := do(t, h, route.method, route.target, "alice", route.body); w.Code != http.StatusBadRequest {
			t.Fatalf("%s %s = %d (%s), want 400", route.method, route.target, w.Code, w.Body.String())
		}
	}
	if w := do(t, h, "GET", "/v1/shared/grants", "alice", ""); w.Code != http.StatusOK ||
		!strings.Contains(w.Body.String(), `"grants":[]`) {
		t.Fatalf("rejected keys changed grants = %d (%s)", w.Code, w.Body.String())
	}
}

func grantBodyNoKey(postingID, audienceType, audienceID string) string {
	out, _ := json.Marshal(map[string]string{"postingId": postingID, "audienceType": audienceType, "audienceId": audienceID})
	return string(out)
}

func grantBodyBadKey(postingID, audienceType, audienceID string) string {
	out, _ := json.Marshal(map[string]string{"postingId": postingID, "audienceType": audienceType, "audienceId": audienceID, "requestId": "not-a-uuid"})
	return string(out)
}

// Grant and accept retries replay byte-identical bodies with one audit
// row each.
func TestSharingHTTPReplayIdentical(t *testing.T) {
	h, db := testHandler(t, false)
	alice, storeA := mustUser(t, db, "alice")
	bob := mustID(t, db, "bob")
	mustPosting(t, storeA, sharedPostingID)

	key := testRequestKey(t)
	body := grantBodyKey(sharedPostingID, "user", bob, key)
	first := do(t, h, "POST", "/v1/shared/grants", "alice", body)
	if first.Code != http.StatusCreated {
		t.Fatalf("grant = %d (%s), want 201", first.Code, first.Body.String())
	}
	second := do(t, h, "POST", "/v1/shared/grants", "alice", body)
	if second.Code != http.StatusCreated || second.Body.String() != first.Body.String() {
		t.Fatalf("grant replay = %d (%s), want byte-identical 201", second.Code, second.Body.String())
	}
	acceptKey := testRequestKey(t)
	accept := copyBodyKey(resourceOf(alice), sharedPostingID, acceptKey)
	third := do(t, h, "POST", "/v1/shared/copies", "bob", accept)
	if third.Code != http.StatusCreated {
		t.Fatalf("accept = %d (%s), want 201", third.Code, third.Body.String())
	}
	fourth := do(t, h, "POST", "/v1/shared/copies", "bob", accept)
	if fourth.Code != http.StatusCreated || fourth.Body.String() != third.Body.String() {
		t.Fatalf("accept replay = %d (%s), want byte-identical 201", fourth.Code, fourth.Body.String())
	}
	w := do(t, h, "GET", "/v1/shared/audit?postingId="+sharedPostingID, "alice", "")
	if w.Code != http.StatusOK {
		t.Fatalf("audit = %d (%s), want 200", w.Code, w.Body.String())
	}
	var out struct {
		Audit []store.SharingAuditEvent `json:"audit"`
	}
	if err := json.Unmarshal(w.Body.Bytes(), &out); err != nil {
		t.Fatal(err)
	}
	if len(out.Audit) != 2 || out.Audit[0].Action != "grant" || out.Audit[1].Action != store.SharingAuditCopyAccepted {
		t.Fatalf("audit = %+v, want grant then copy-accepted", out.Audit)
	}
	if out.Audit[0].RequestID != key || out.Audit[1].RequestID != acceptKey {
		t.Fatalf("audit keys = %q/%q, want replay keys", out.Audit[0].RequestID, out.Audit[1].RequestID)
	}
	if out.Audit[1].LinkID == "" || out.Audit[1].ActorUserID == "" {
		t.Fatalf("accept audit missing link or actor: %+v", out.Audit[1])
	}
}

func grantBodyKey(postingID, audienceType, audienceID, key string) string {
	out, _ := json.Marshal(map[string]string{"postingId": postingID, "audienceType": audienceType, "audienceId": audienceID, "requestId": key})
	return string(out)
}

// grantKeyBody aliases grantBodyKey under the name the QA-02 security
// track uses, so its keyed grant bodies compile unchanged.
func grantKeyBody(postingID, audienceType, audienceID, key string) string {
	return grantBodyKey(postingID, audienceType, audienceID, key)
}

func copyBodyKey(owner, postingID, key string) string {
	out, _ := json.Marshal(map[string]string{"owner": owner, "postingId": postingID, "requestId": key})
	return string(out)
}

// copyKeyBody aliases copyBodyKey under the name the QA-02 security
// track uses, so its keyed accept bodies compile unchanged.
func copyKeyBody(owner, postingID, key string) string {
	return copyBodyKey(owner, postingID, key)
}

// A key reused for a different action reports 409 with no session
// discovery code.
func TestSharingHTTPKeyReuseConflicts(t *testing.T) {
	h, db := testHandler(t, false)
	_, storeA := mustUser(t, db, "alice")
	bob := mustID(t, db, "bob")
	mustPosting(t, storeA, sharedPostingID)

	key := testRequestKey(t)
	if w := do(t, h, "POST", "/v1/shared/grants", "alice", grantBodyKey(sharedPostingID, "user", bob, key)); w.Code != http.StatusCreated {
		t.Fatalf("grant = %d, want 201", w.Code)
	}
	w := do(t, h, "POST", "/v1/shared/exclusions", "alice", grantBodyKey(sharedPostingID, "user", bob, key))
	if w.Code != http.StatusConflict {
		t.Fatalf("exclusion with grant key = %d (%s), want 409", w.Code, w.Body.String())
	}
	if strings.Contains(w.Body.String(), "RESOURCE_CHANGED") {
		t.Fatalf("conflict triggers session discovery: %s", w.Body.String())
	}
}

// The audit read is owner-scoped: the source owner sees the trace,
// another owner sees an empty list, anonymous callers fail, and the
// posting selector is required.
func TestSharingHTTPAuditOwnerScoped(t *testing.T) {
	h, db := testHandler(t, false)
	_, storeA := mustUser(t, db, "alice")
	bob := mustID(t, db, "bob")
	mustUser(t, db, "carol")
	mustPosting(t, storeA, sharedPostingID)
	if w := do(t, h, "POST", "/v1/shared/grants", "alice", grantBody(t, sharedPostingID, "user", bob)); w.Code != http.StatusCreated {
		t.Fatalf("grant = %d, want 201", w.Code)
	}
	w := do(t, h, "GET", "/v1/shared/audit?postingId="+sharedPostingID, "alice", "")
	if w.Code != http.StatusOK {
		t.Fatalf("owner audit = %d (%s), want 200", w.Code, w.Body.String())
	}
	var out struct {
		Audit []store.SharingAuditEvent `json:"audit"`
	}
	if err := json.Unmarshal(w.Body.Bytes(), &out); err != nil {
		t.Fatal(err)
	}
	if len(out.Audit) != 1 || out.Audit[0].Action != "grant" || out.Audit[0].RequestID == "" {
		t.Fatalf("owner audit = %+v, want one keyed grant row", out.Audit)
	}
	for _, leak := range []string{"amount", "Checking", "expression", "receipt", "secret"} {
		if strings.Contains(w.Body.String(), leak) {
			t.Fatalf("audit payload leaks %q: %s", leak, w.Body.String())
		}
	}
	// A different owner reads an empty trace, never another owner's.
	if w := do(t, h, "GET", "/v1/shared/audit?postingId="+sharedPostingID, "carol", ""); w.Code != http.StatusOK ||
		!strings.Contains(w.Body.String(), `"audit":[]`) {
		t.Fatalf("cross-owner audit = %d (%s), want 200 with []", w.Code, w.Body.String())
	}
	if w := do(t, h, "GET", "/v1/shared/audit?postingId="+sharedPostingID, "", ""); w.Code != http.StatusUnauthorized {
		t.Fatalf("anonymous audit = %d, want 401", w.Code)
	}
	if w := do(t, h, "GET", "/v1/shared/audit", "alice", ""); w.Code != http.StatusBadRequest {
		t.Fatalf("audit without posting = %d, want 400", w.Code)
	}
	if w := do(t, h, "POST", "/v1/shared/audit?postingId="+sharedPostingID, "alice", ""); w.Code != http.StatusMethodNotAllowed {
		t.Fatalf("audit POST = %d, want 405", w.Code)
	}
}

// Read-only mode rejects mutating share requests before any replay:
// even a retry of a committed key reports 403 while reads stay 200.
func TestSharingHTTPReadOnlyRejectsReplay(t *testing.T) {
	h, db := testHandler(t, false)
	alice, storeA := mustUser(t, db, "alice")
	bob := mustID(t, db, "bob")
	mustPosting(t, storeA, sharedPostingID)

	key := testRequestKey(t)
	body := grantBodyKey(sharedPostingID, "user", bob, key)
	if w := do(t, h, "POST", "/v1/shared/grants", "alice", body); w.Code != http.StatusCreated {
		t.Fatalf("grant = %d, want 201", w.Code)
	}
	ro := sharing.New(db, testIssuer, sharing.Config{ReadOnly: true})
	for _, route := range []struct{ method, target, body string }{
		{"POST", "/v1/shared/grants", body},
		{"DELETE", "/v1/shared/grants", body},
		{"POST", "/v1/shared/exclusions", body},
		{"DELETE", "/v1/shared/exclusions", body},
		{"POST", "/v1/shared/copies", copyBodyKey(resourceOf(alice), sharedPostingID, testRequestKey(t))},
	} {
		if w := do(t, ro, route.method, route.target, "alice", route.body); w.Code != http.StatusForbidden {
			t.Fatalf("read-only replay %s %s = %d, want 403", route.method, route.target, w.Code)
		}
	}
	if w := do(t, ro, "GET", "/v1/shared/audit?postingId="+sharedPostingID, "alice", ""); w.Code != http.StatusOK {
		t.Fatalf("read-only audit = %d, want 200", w.Code)
	}
}
