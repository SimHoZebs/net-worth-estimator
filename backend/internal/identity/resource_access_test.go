package identity

import (
	"context"
	"encoding/json"
	"errors"
	"net/http"
	"net/http/httptest"
	"path/filepath"
	"testing"

	"github.com/simhozebs/net-worth-estimator/backend/internal/authorization"
)

func TestResourceAssertionsPreventCrossIdentityRequests(t *testing.T) {
	p := newIDP(t)
	s := newService(t, p, filepath.Join(t.TempDir(), "sessions.db"))
	s.config.RequireResourceHeader = true
	server := httptest.NewServer(s.Wrap(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		scope, ok := Scope(r.Context())
		if !ok || scope.Resource.ID != r.Header.Get(ResourceHeader) {
			t.Error("authorized resource context is missing or inconsistent")
		}
		w.WriteHeader(204)
	})))
	defer server.Close()
	client := testClient(t)
	guestID := authorization.ResourceFor(p.server.URL, "").ID
	ownerID := authorization.ResourceFor(p.server.URL, p.subject).ID
	check := func(method, resource string, want int) {
		t.Helper()
		rq, _ := http.NewRequest(method, server.URL+"/v1/accounts", nil)
		// A retired shared token cannot grant a guest access or replace a session.
		rq.Header.Set("Authorization", "Bearer retired-token")
		if resource != "" {
			rq.Header.Set(ResourceHeader, resource)
		}
		r, err := client.Do(rq)
		if err != nil {
			t.Fatal(err)
		}
		defer r.Body.Close()
		if r.StatusCode != want {
			t.Fatalf("%s resource %q=%d want %d", method, resource, r.StatusCode, want)
		}
		if want == http.StatusConflict {
			var problem struct{ Code string }
			if err := json.NewDecoder(r.Body).Decode(&problem); err != nil {
				t.Fatal(err)
			}
			if problem.Code != "RESOURCE_CHANGED" || r.Header.Get(ResourceHeader) == "" {
				t.Fatalf("resource conflict lacks its code or current resource: %+v", problem)
			}
		}
	}
	check("GET", "", 409)
	check("GET", guestID, 204)
	check("GET", ownerID, 409)
	check("POST", guestID, 401)
	r := signIn(t, s, p, server, client, false)
	r.Body.Close()
	check("GET", "", 409)
	check("GET", guestID, 409)
	check("GET", ownerID, 204)
	check("POST", ownerID, 204)
	check("POST", guestID, 409)
	check("POST", authorization.ResourceFor(p.server.URL, "another-account").ID, 409)
	staleLogout, _ := http.NewRequest("POST", server.URL+prefix+"logout", nil)
	staleLogout.Header.Set(ResourceHeader, guestID)
	r, _ = client.Do(staleLogout)
	var problem struct{ Code string }
	if err := json.NewDecoder(r.Body).Decode(&problem); err != nil {
		t.Fatal(err)
	}
	r.Body.Close()
	if r.StatusCode != 409 || problem.Code != "RESOURCE_CHANGED" {
		t.Fatalf("stale logout status=%d problem=%+v", r.StatusCode, problem)
	}
	check("POST", ownerID, 204)
	rq, _ := http.NewRequest("POST", server.URL+prefix+"logout", nil)
	r, _ = client.Do(rq)
	r.Body.Close()
	check("GET", ownerID, 409)
	check("POST", ownerID, 401)
	check("GET", guestID, 204)
}

func TestOrdinaryConflictDoesNotReportResourceChange(t *testing.T) {
	w := httptest.NewRecorder()
	failure(w, http.StatusConflict, "That account already exists.")
	var problem map[string]any
	if err := json.Unmarshal(w.Body.Bytes(), &problem); err != nil {
		t.Fatal(err)
	}
	if _, exists := problem["code"]; exists {
		t.Fatalf("ordinary conflict has a resource-change code: %+v", problem)
	}
	if w.Code != http.StatusConflict || problem["detail"] != "That account already exists." {
		t.Fatalf("ordinary conflict changed: status=%d problem=%+v", w.Code, problem)
	}
}

func TestCasdoorDecisionsAndOutagesAreNeverBypassed(t *testing.T) {
	p := newIDP(t)
	s := newService(t, p, filepath.Join(t.TempDir(), "sessions.db"))
	server := httptest.NewServer(s.Wrap(http.HandlerFunc(func(w http.ResponseWriter, _ *http.Request) { w.WriteHeader(204) })))
	defer server.Close()
	client := testClient(t)
	r := signIn(t, s, p, server, client, false)
	r.Body.Close()
	resolver := s.config.ResolveAccess
	s.config.ResolveAccess = func(ctx context.Context, subject string) (authorization.Scope, error) {
		scope, err := resolver(ctx, subject)
		scope.Permissions = []string{"account:read"}
		return scope, err
	}
	r, _ = client.Post(server.URL+"/v1/accounts", "application/json", nil)
	r.Body.Close()
	if r.StatusCode != 403 {
		t.Fatalf("signed-in account bypassed denied write=%d", r.StatusCode)
	}
	r, _ = client.Get(server.URL + prefix + "session")
	var session struct {
		Allowed  bool
		User     Principal
		Resource struct {
			ID, Kind    string
			Permissions []string
		}
	}
	if err := json.NewDecoder(r.Body).Decode(&session); err != nil {
		t.Fatal(err)
	}
	r.Body.Close()
	if !session.Allowed || session.Resource.Kind != "private" || len(session.Resource.Permissions) != 1 || session.Resource.Permissions[0] != authorization.Read {
		t.Fatalf("session did not reflect the resource permissions: %+v", session)
	}
	s.config.ResolveAccess = func(context.Context, string) (authorization.Scope, error) {
		return authorization.Scope{}, errors.New("provider unavailable")
	}
	for _, path := range []string{"/v1/financial-model", prefix + "session"} {
		r, _ = client.Get(server.URL + path)
		r.Body.Close()
		if r.StatusCode != 503 {
			t.Fatalf("authorization outage on %s=%d", path, r.StatusCode)
		}
	}
	s.config.ResolveAccess = nil
	r, _ = client.Get(server.URL + "/v1/financial-model")
	r.Body.Close()
	if r.StatusCode != 503 {
		t.Fatalf("missing authorization integration=%d", r.StatusCode)
	}
}
