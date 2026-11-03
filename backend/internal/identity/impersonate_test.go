package identity

import (
	"context"
	"net/http"
	"net/http/httptest"
	"path/filepath"
	"strings"
	"testing"

	"github.com/simhozebs/net-worth-estimator/backend/internal/authorization"
)

func TestAdminImpersonationBranch(t *testing.T) {
	targetSubject := "target-user-subject"

	t.Run("admin receives synthesized target scope", func(t *testing.T) {
		p := newIDP(t)
		p.subject = "admin-subject"
		issuer := p.server.URL
		targetResource := authorization.ResourceFor(issuer, targetSubject)
		options := func(c *Config) {
			c.Impersonate = func(_ context.Context, p Principal, header string) (Principal, authorization.Scope, bool, error) {
				if p.Subject != "admin-subject" {
					return Principal{}, authorization.Scope{}, false, nil
				}
				return Principal{Subject: targetSubject, Authenticated: true},
					authorization.Scope{Resource: targetResource, Permissions: []string{authorization.Read, authorization.Project, authorization.Write}},
					true, nil
			}
		}
		s := newService(t, p, filepath.Join(t.TempDir(), "sessions.db"), options)
		server := httptest.NewServer(s.Wrap(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
			if got := Subject(r.Context()); got != targetSubject {
				t.Errorf("handler subject=%q", got)
			}
			if !CanWrite(r.Context()) {
				t.Error("handler did not receive write permission")
			}
			w.WriteHeader(http.StatusNoContent)
		})))
		defer server.Close()
		client := testClient(t)
		r := signIn(t, s, p, server, client, false)
		r.Body.Close()
		rq, _ := http.NewRequest(http.MethodGet, server.URL+"/v1/financial-model", nil)
		rq.Header.Set(ResourceHeader, targetResource.ID)
		r, err := client.Do(rq)
		if err != nil {
			t.Fatal(err)
		}
		r.Body.Close()
		if r.StatusCode != http.StatusNoContent {
			t.Fatalf("status=%d", r.StatusCode)
		}
		if got := r.Header.Get(ResourceHeader); got != targetResource.ID {
			t.Fatalf("resource header=%q", got)
		}
	})

	t.Run("non-admin callers fall through to the standard boundary", func(t *testing.T) {
		p := newIDP(t)
		p.subject = "ordinary-member"
		options := func(c *Config) {
			c.Impersonate = func(ctx context.Context, p Principal, _ string) (Principal, authorization.Scope, bool, error) {
				// The hook is consulted for every caller; it must no-op for
				// anyone but the configured admin subject.
				if p.Subject != "admin-subject" {
					return Principal{}, authorization.Scope{}, false, nil
				}
				t.Fatal("impersonator ran for the admin subject in a fall-through test")
				return Principal{}, authorization.Scope{}, false, nil
			}
		}
		s := newService(t, p, filepath.Join(t.TempDir(), "sessions.db"), options)
		server := httptest.NewServer(s.Wrap(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
			if got := Subject(r.Context()); got != "ordinary-member" {
				t.Errorf("subject=%q", got)
			}
			w.WriteHeader(http.StatusNoContent)
		})))
		defer server.Close()
		client := testClient(t)
		r := signIn(t, s, p, server, client, false)
		r.Body.Close()
		rq, _ := http.NewRequest(http.MethodGet, server.URL+"/v1/financial-model", nil)
		rq.Header.Set(ResourceHeader, authorization.ResourceFor(p.server.URL, "ordinary-member").ID)
		r, err := client.Do(rq)
		if err != nil {
			t.Fatal(err)
		}
		r.Body.Close()
		if r.StatusCode != http.StatusNoContent {
			t.Fatalf("status=%d", r.StatusCode)
		}
	})

	t.Run("impersonator error maps to its status code and the handler does not run", func(t *testing.T) {
		p := newIDP(t)
		p.subject = "admin-subject"
		want := http.StatusNotFound
		options := func(c *Config) {
			c.Impersonate = func(_ context.Context, _ Principal, _ string) (Principal, authorization.Scope, bool, error) {
				return Principal{}, authorization.Scope{}, true, impersonationStatusError{status: want, message: "Unknown user resource."}
			}
		}
		s := newService(t, p, filepath.Join(t.TempDir(), "sessions.db"), options)
		called := false
		server := httptest.NewServer(s.Wrap(http.HandlerFunc(func(w http.ResponseWriter, _ *http.Request) {
			called = true
			w.WriteHeader(http.StatusNoContent)
		})))
		defer server.Close()
		client := testClient(t)
		r := signIn(t, s, p, server, client, false)
		r.Body.Close()
		rq, _ := http.NewRequest(http.MethodGet, server.URL+"/v1/financial-model", nil)
		rq.Header.Set(ResourceHeader, "users/"+strings.Repeat("b", 64))
		r, err := client.Do(rq)
		if err != nil {
			t.Fatal(err)
		}
		r.Body.Close()
		if r.StatusCode != want {
			t.Fatalf("status=%d want=%d", r.StatusCode, want)
		}
		if called {
			t.Fatal("handler ran despite impersonation failure")
		}
	})
}

type impersonationStatusError struct {
	status  int
	message string
}

func (e impersonationStatusError) Error() string   { return e.message }
func (e impersonationStatusError) StatusCode() int { return e.status }
