package sharing_test

// Social-operation idempotency over HTTP (FND-05): mutating share routes
// require a client request ID, retries replay byte-for-byte, and key reuse
// across actions reports 409 without session discovery.

import (
	"encoding/json"
	"net/http"
	"strings"
	"testing"

	"github.com/simhozebs/net-worth-estimator/backend/internal/sharing"
)

// Mutating share routes reject missing or malformed request IDs with 400
// before touching storage.
func TestSharingHTTPRequiresRequestID(t *testing.T) {
	h, db := testHandler(t, false)
	alice, storeA := mustUser(t, db, "alice")
	bob := mustID(t, db, "bob")
	mustTransaction(t, storeA, sharedTransactionID)

	bodies := []struct{ method, target, body string }{
		{"POST", "/v1/shared/grants", grantBodyNoKey(sharedTransactionID, "user", bob)},
		{"DELETE", "/v1/shared/grants", grantBodyNoKey(sharedTransactionID, "user", bob)},
		{"POST", "/v1/shared/exclusions", grantBodyNoKey(sharedTransactionID, "all", "")},
		{"DELETE", "/v1/shared/exclusions", grantBodyNoKey(sharedTransactionID, "all", "")},
		{"POST", "/v1/shared/grants", grantBodyBadKey(sharedTransactionID, "user", bob)},
		{
			"POST", "/v1/shared/copies",
			`{"owner":"` + resourceOf(alice) + `","transactionId":"` + sharedTransactionID + `"}`,
		},
		{
			"POST", "/v1/shared/copies",
			`{"owner":"` + resourceOf(alice) + `","transactionId":"` + sharedTransactionID + `","requestId":"nope"}`,
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

func grantBodyNoKey(transactionID, audienceType, audienceID string) string {
	out, _ := json.Marshal(map[string]string{"transactionId": transactionID, "audienceType": audienceType, "audienceId": audienceID})
	return string(out)
}

func grantBodyBadKey(transactionID, audienceType, audienceID string) string {
	out, _ := json.Marshal(map[string]string{"transactionId": transactionID, "audienceType": audienceType, "audienceId": audienceID, "requestId": "not-a-uuid"})
	return string(out)
}

// Grant and accept retries replay byte-identical bodies.
func TestSharingHTTPReplayIdentical(t *testing.T) {
	h, db := testHandler(t, false)
	alice, storeA := mustUser(t, db, "alice")
	bob := mustID(t, db, "bob")
	mustTransaction(t, storeA, sharedTransactionID)

	key := testRequestKey(t)
	body := grantBodyKey(sharedTransactionID, "user", bob, key)
	first := do(t, h, "POST", "/v1/shared/grants", "alice", body)
	if first.Code != http.StatusCreated {
		t.Fatalf("grant = %d (%s), want 201", first.Code, first.Body.String())
	}
	second := do(t, h, "POST", "/v1/shared/grants", "alice", body)
	if second.Code != http.StatusCreated || second.Body.String() != first.Body.String() {
		t.Fatalf("grant replay = %d (%s), want byte-identical 201", second.Code, second.Body.String())
	}
	acceptKey := testRequestKey(t)
	accept := copyBodyKey(resourceOf(alice), sharedTransactionID, acceptKey)
	third := do(t, h, "POST", "/v1/shared/copies", "bob", accept)
	if third.Code != http.StatusCreated {
		t.Fatalf("accept = %d (%s), want 201", third.Code, third.Body.String())
	}
	fourth := do(t, h, "POST", "/v1/shared/copies", "bob", accept)
	if fourth.Code != http.StatusCreated || fourth.Body.String() != third.Body.String() {
		t.Fatalf("accept replay = %d (%s), want byte-identical 201", fourth.Code, fourth.Body.String())
	}
}

func grantBodyKey(transactionID, audienceType, audienceID, key string) string {
	out, _ := json.Marshal(map[string]string{"transactionId": transactionID, "audienceType": audienceType, "audienceId": audienceID, "requestId": key})
	return string(out)
}

func copyBodyKey(owner, transactionID, key string) string {
	out, _ := json.Marshal(map[string]string{"owner": owner, "transactionId": transactionID, "requestId": key})
	return string(out)
}

// A key reused for a different action reports 409 with no session
// discovery code.
func TestSharingHTTPKeyReuseConflicts(t *testing.T) {
	h, db := testHandler(t, false)
	_, storeA := mustUser(t, db, "alice")
	bob := mustID(t, db, "bob")
	mustTransaction(t, storeA, sharedTransactionID)

	key := testRequestKey(t)
	if w := do(t, h, "POST", "/v1/shared/grants", "alice", grantBodyKey(sharedTransactionID, "user", bob, key)); w.Code != http.StatusCreated {
		t.Fatalf("grant = %d, want 201", w.Code)
	}
	w := do(t, h, "POST", "/v1/shared/exclusions", "alice", grantBodyKey(sharedTransactionID, "user", bob, key))
	if w.Code != http.StatusConflict {
		t.Fatalf("exclusion with grant key = %d (%s), want 409", w.Code, w.Body.String())
	}
	if strings.Contains(w.Body.String(), "RESOURCE_CHANGED") {
		t.Fatalf("conflict triggers session discovery: %s", w.Body.String())
	}
}

// Read-only mode rejects mutating share requests before any replay:
// even a retry of a committed key reports 403.
func TestSharingHTTPReadOnlyRejectsReplay(t *testing.T) {
	h, db := testHandler(t, false)
	alice, storeA := mustUser(t, db, "alice")
	bob := mustID(t, db, "bob")
	mustTransaction(t, storeA, sharedTransactionID)

	key := testRequestKey(t)
	body := grantBodyKey(sharedTransactionID, "user", bob, key)
	if w := do(t, h, "POST", "/v1/shared/grants", "alice", body); w.Code != http.StatusCreated {
		t.Fatalf("grant = %d, want 201", w.Code)
	}
	ro := sharing.New(db, testIssuer, sharing.Config{ReadOnly: true})
	for _, route := range []struct{ method, target, body string }{
		{"POST", "/v1/shared/grants", body},
		{"DELETE", "/v1/shared/grants", body},
		{"POST", "/v1/shared/exclusions", body},
		{"DELETE", "/v1/shared/exclusions", body},
		{"POST", "/v1/shared/copies", copyBodyKey(resourceOf(alice), sharedTransactionID, testRequestKey(t))},
	} {
		if w := do(t, ro, route.method, route.target, "alice", route.body); w.Code != http.StatusForbidden {
			t.Fatalf("read-only replay %s %s = %d, want 403", route.method, route.target, w.Code)
		}
	}
}
