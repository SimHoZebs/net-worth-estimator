package identity

import (
	"context"
	"net/http"
	"net/http/httptest"
	"path/filepath"
	"testing"

	"github.com/simhozebs/net-worth-estimator/backend/internal/authorization"
)

func TestReceiptRoutesUseExistingIdentityAndWriteBoundary(t *testing.T) {
	p := newIDP(t)
	s := newService(t, p, filepath.Join(t.TempDir(), "sessions.db"))
	s.config.RequireResourceHeader = true
	server := httptest.NewServer(s.Wrap(http.HandlerFunc(func(w http.ResponseWriter, _ *http.Request) { w.WriteHeader(204) })))
	defer server.Close()
	client := testClient(t)
	owner := authorization.ResourceFor(p.server.URL, p.subject).ID
	guest := authorization.ResourceFor(p.server.URL, s.config.GuestSubject).ID
	check := func(method, path, resource string, want int) {
		t.Helper()
		rq, _ := http.NewRequest(method, server.URL+path, nil)
		rq.Header.Set(ResourceHeader, resource)
		r, err := client.Do(rq)
		if err != nil {
			t.Fatal(err)
		}
		r.Body.Close()
		if r.StatusCode != want {
			t.Fatalf("%s %s=%d want %d", method, path, r.StatusCode, want)
		}
	}
	writes := []struct{ method, path string }{{"POST", "/v1/receipts"}, {"POST", "/v1/receipts/id/extract"}, {"PATCH", "/v1/receipts/id"}, {"PUT", "/v1/receipts/id/image"}, {"DELETE", "/v1/receipts/id"}}
	for _, route := range writes {
		check(route.method, route.path, guest, 401)
	}
	r := signIn(t, s, p, server, client, false)
	r.Body.Close()
	for _, route := range writes {
		check(route.method, route.path, owner, 204)
		check(route.method, route.path, guest, 409)
	}
	check("GET", "/v1/receipts/id/image", owner, 204)
	resolver := s.config.ResolveAccess
	s.config.ResolveAccess = func(ctx context.Context, subject string) (authorization.Scope, error) {
		scope, err := resolver(ctx, subject)
		scope.Permissions = []string{authorization.Read}
		return scope, err
	}
	for _, route := range writes {
		check(route.method, route.path, owner, 403)
	}
	check("GET", "/v1/receipts/id/image", owner, 204)
}
