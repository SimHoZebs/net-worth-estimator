package identity

import (
	"context"
	"net/http"
	"net/http/httptest"
	"path/filepath"
	"testing"

	"github.com/simhozebs/net-worth-estimator/backend/internal/authorization"
)

func TestAnonymousGuestGroupDataUsesGrantsNotIdentityCategory(t *testing.T) {
	p := newIDP(t)
	s := newService(t, p, filepath.Join(t.TempDir(), "sessions.db"))
	s.config.RequireResourceHeader = true
	reached := 0
	server := httptest.NewServer(s.Wrap(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		reached++
		if _, ok := Scope(r.Context()); !ok {
			t.Error("group request missing verified scope")
		}
		w.WriteHeader(http.StatusNoContent)
	})))
	defer server.Close()
	client := testClient(t)
	guestID := authorization.ResourceFor(p.server.URL, s.config.GuestSubject).ID

	do := func(method, path, resource string) (int, string) {
		t.Helper()
		rq, _ := http.NewRequest(method, server.URL+path, nil)
		if resource != "" {
			rq.Header.Set(ResourceHeader, resource)
		}
		r, err := client.Do(rq)
		if err != nil {
			t.Fatal(err)
		}
		defer r.Body.Close()
		return r.StatusCode, r.Header.Get(ResourceHeader)
	}

	// Anonymous ordinary guest with provider read reaches the group handler.
	reached = 0
	if code, header := do("GET", "/v1/groups", guestID); code != http.StatusNoContent || reached != 1 || header != guestID {
		t.Fatalf("guest group GET=%d reached=%d header=%q want 204/1/%q", code, reached, header, guestID)
	}
	// Viewer without user:write cannot create; denied by grants, not identity.
	reached = 0
	if code, _ := do("POST", "/v1/groups", guestID); code != http.StatusUnauthorized || reached != 0 {
		t.Fatalf("guest group POST without write=%d reached=%d want 401/0", code, reached)
	}
	// Granting write at the provider lets the same anonymous guest through;
	// there is no authenticated branch blocking group data.
	resolver := s.config.ResolveAccess
	s.config.ResolveAccess = func(ctx context.Context, subject string) (authorization.Scope, error) {
		scope, err := resolver(ctx, subject)
		if err != nil {
			return scope, err
		}
		if subject == s.config.GuestSubject {
			scope.Permissions = []string{authorization.Read, authorization.Project, authorization.Write}
		}
		return scope, nil
	}
	reached = 0
	if code, header := do("POST", "/v1/groups", guestID); code != http.StatusNoContent || reached != 1 || header != guestID {
		t.Fatalf("granted guest group POST=%d reached=%d header=%q want 204/1/%q", code, reached, header, guestID)
	}
	// Header assertion is the normal resource check.
	reached = 0
	otherID := authorization.ResourceFor(p.server.URL, "other-user").ID
	if code, _ := do("GET", "/v1/groups", otherID); code != http.StatusConflict || reached != 0 {
		t.Fatalf("wrong group resource=%d reached=%d want 409/0", code, reached)
	}
	if code, _ := do("GET", "/v1/groups", ""); code != http.StatusConflict || reached != 0 {
		t.Fatalf("missing group resource=%d reached=%d want 409/0", code, reached)
	}
}
