package groups_test

import (
	"encoding/json"
	"net/http"
	"net/http/httptest"
	"path/filepath"
	"strings"
	"testing"
	"time"

	"github.com/simhozebs/net-worth-estimator/backend/internal/groups"
	"github.com/simhozebs/net-worth-estimator/backend/internal/identity"
	authcontract "github.com/simhozebs/net-worth-estimator/backend/internal/identity/contracts"
	"github.com/simhozebs/net-worth-estimator/backend/internal/store"
	"github.com/simhozebs/net-worth-estimator/backend/internal/store/adapters/sqlite"
)

const testIssuer = "https://issuer.test"

func testHandler(t *testing.T, readOnly bool) (*groups.Handler, store.Database) {
	t.Helper()
	db, err := sqlite.SetupDatabase(filepath.Join(t.TempDir(), "groups-http.db"))
	if err != nil {
		t.Fatal(err)
	}
	t.Cleanup(func() { db.Close() })
	return groups.New(db, testIssuer, groups.Config{ReadOnly: readOnly}), db
}

func withSubject(r *http.Request, subject, name string) *http.Request {
	return r.WithContext(identity.PrincipalContext(r.Context(), authcontract.Principal{Subject: subject, Name: name}))
}

func do(t *testing.T, h *groups.Handler, method, target, subject, body string, headers map[string]string) *httptest.ResponseRecorder {
	t.Helper()
	var reader *strings.Reader
	if body == "" {
		reader = strings.NewReader("")
	} else {
		reader = strings.NewReader(body)
	}
	r := httptest.NewRequest(method, target, reader)
	if body != "" {
		r.Header.Set("Content-Type", "application/json")
	}
	for key, value := range headers {
		r.Header.Set(key, value)
	}
	if subject != "" {
		r = withSubject(r, subject, subject)
	}
	w := httptest.NewRecorder()
	h.Routes().ServeHTTP(w, r)
	return w
}

func mustCreateGroup(t *testing.T, db store.Database, owner, name string) string {
	t.Helper()
	account, err := db.EnsureGroupAccount(testIssuer, owner)
	if err != nil {
		t.Fatal(err)
	}
	group, err := db.CreateGroup(account, name, owner)
	if err != nil {
		t.Fatal(err)
	}
	return group.ID
}

func TestGroupsHTTPRequiresAuthentication(t *testing.T) {
	h, _ := testHandler(t, false)
	for _, route := range []struct{ method, target, body string }{
		{"GET", "/v1/groups", ""},
		{"POST", "/v1/groups", `{"name":"x"}`},
		{"GET", "/v1/groups/abc", ""},
		{"POST", "/v1/invites/accept", `{"code":"x"}`},
	} {
		w := do(t, h, route.method, route.target, "", route.body, nil)
		if w.Code != http.StatusUnauthorized {
			t.Fatalf("%s %s = %d, want 401", route.method, route.target, w.Code)
		}
	}
}

func TestGroupsHTTPValidationNeverLeaksInternals(t *testing.T) {
	h, db := testHandler(t, false)
	if _, err := db.EnsureGroupAccount(testIssuer, "alice"); err != nil {
		t.Fatal(err)
	}
	w := do(t, h, "POST", "/v1/groups", "alice", `{"name":""}`, nil)
	if w.Code != http.StatusBadRequest {
		t.Fatalf("empty name = %d, want 400", w.Code)
	}
	if strings.Contains(w.Body.String(), "sql:") {
		t.Fatalf("leaked internals: %q", w.Body.String())
	}
	w = do(t, h, "POST", "/v1/groups/does-not-exist/invites", "alice", `{}`, nil)
	if w.Code != http.StatusNotFound {
		t.Fatalf("missing group invites = %d, want 404", w.Code)
	}
	if strings.Contains(w.Body.String(), "sql:") {
		t.Fatalf("leaked internals: %q", w.Body.String())
	}
	w = do(t, h, "POST", "/v1/invites/accept", "alice", `{"code":"nope"}`, nil)
	if w.Code != http.StatusNotFound {
		t.Fatalf("unknown code = %d, want 404", w.Code)
	}
}

func TestGroupsHTTPReadOnlyRejectsWrites(t *testing.T) {
	h, db := testHandler(t, true)
	if _, err := db.EnsureGroupAccount(testIssuer, "alice"); err != nil {
		t.Fatal(err)
	}
	id := mustCreateGroup(t, db, "alice", "Readonly")
	for _, route := range []struct{ method, target, body string }{
		{"POST", "/v1/groups", `{"name":"x"}`},
		{"PATCH", "/v1/groups/" + id, `{"name":"y"}`},
		{"DELETE", "/v1/groups/" + id, ""},
		{"POST", "/v1/invites/accept", `{"code":"x"}`},
	} {
		w := do(t, h, route.method, route.target, "alice", route.body, nil)
		if w.Code != http.StatusForbidden {
			t.Fatalf("read-only %s %s = %d, want 403", route.method, route.target, w.Code)
		}
	}
	w := do(t, h, "GET", "/v1/groups", "alice", "", nil)
	if w.Code != http.StatusOK {
		t.Fatalf("read-only GET = %d, want 200", w.Code)
	}
}

func TestGroupsHTTPMembershipMatrix(t *testing.T) {
	h, db := testHandler(t, false)
	for _, user := range []string{"alice", "bob"} {
		if _, err := db.EnsureGroupAccount(testIssuer, user); err != nil {
			t.Fatal(err)
		}
	}
	id := mustCreateGroup(t, db, "alice", "Matrix")

	if w := do(t, h, "GET", "/v1/groups/"+id, "bob", "", nil); w.Code != http.StatusNotFound {
		t.Fatalf("non-member get = %d, want 404", w.Code)
	}
	if w := do(t, h, "PATCH", "/v1/groups/"+id, "bob", `{"name":"x"}`, nil); w.Code != http.StatusForbidden {
		t.Fatalf("non-member rename = %d, want 403", w.Code)
	}

	// Alice invites Bob; Bob reads but cannot manage.
	invite, code, err := db.CreateInvite(id, mustAccount(t, db, "alice"), 5, 24*time.Hour)
	if err != nil {
		t.Fatal(err)
	}
	_ = invite
	w := do(t, h, "POST", "/v1/invites/accept", "bob", `{"code":`+strconv_quote(code)+`}`, nil)
	if w.Code != http.StatusOK {
		t.Fatalf("accept = %d (%s), want 200", w.Code, w.Body.String())
	}
	if w := do(t, h, "GET", "/v1/groups/"+id+"/invites", "bob", "", nil); w.Code != http.StatusForbidden {
		t.Fatalf("member list invites = %d, want 403", w.Code)
	}
	// Non-members learn nothing from privileged reads either.
	if w := do(t, h, "GET", "/v1/groups/"+id+"/invites", "carol", "", nil); w.Code != http.StatusNotFound {
		t.Fatalf("non-member list invites = %d, want 404", w.Code)
	}
	if w := do(t, h, "GET", "/v1/groups/"+id, "bob", "", nil); w.Code != http.StatusOK {
		t.Fatalf("member get = %d, want 200", w.Code)
	}
	if w := do(t, h, "DELETE", "/v1/groups/"+id+"/members/"+mustAccount(t, db, "alice"), "bob", "", nil); w.Code != http.StatusForbidden {
		t.Fatalf("member kick owner = %d, want 403", w.Code)
	}
	// Accepting the same code twice is a 400, not a 500.
	w = do(t, h, "POST", "/v1/invites/accept", "bob", `{"code":`+strconv_quote(code)+`}`, nil)
	if w.Code != http.StatusBadRequest {
		t.Fatalf("double accept = %d, want 400", w.Code)
	}
}

func mustAccount(t *testing.T, db store.Database, subject string) string {
	t.Helper()
	account, err := db.EnsureGroupAccount(testIssuer, subject)
	if err != nil {
		t.Fatal(err)
	}
	return account
}

func strconv_quote(s string) string {
	out, _ := json.Marshal(s)
	return string(out)
}

func TestGroupsHTTPMethodAndPreflight(t *testing.T) {
	h, _ := testHandler(t, false)
	w := do(t, h, "PUT", "/v1/groups", "alice", "", nil)
	if w.Code != http.StatusMethodNotAllowed || w.Header().Get("Allow") == "" {
		t.Fatalf("PUT = %d allow=%q, want 405 with Allow", w.Code, w.Header().Get("Allow"))
	}
	h2, db2 := testHandler(t, false)
	if _, err := db2.EnsureGroupAccount(testIssuer, "alice"); err != nil {
		t.Fatal(err)
	}
	leaveID := mustCreateGroup(t, db2, "alice", "Methods")
	if w := do(t, h2, "GET", "/v1/groups/"+leaveID+"/leave", "alice", "", nil); w.Code != http.StatusMethodNotAllowed {
		t.Fatalf("leave GET = %d, want 405", w.Code)
	}
	if w := do(t, h2, "POST", "/v1/groups/"+leaveID+"/invites/nope", "alice", "", nil); w.Code != http.StatusMethodNotAllowed {
		t.Fatalf("invite-item POST = %d, want 405", w.Code)
	}
	// Same-origin preflight passes without a session.
	w = do(t, h, "OPTIONS", "/v1/groups", "", "", map[string]string{
		"Origin":                        "http://example.com",
		"Access-Control-Request-Method": "POST",
	})
	if w.Code != http.StatusNoContent {
		t.Fatalf("preflight = %d, want 204", w.Code)
	}
	if got := w.Header().Get("Access-Control-Allow-Origin"); got != "http://example.com" {
		t.Fatalf("allow-origin = %q, want example.com", got)
	}
}
