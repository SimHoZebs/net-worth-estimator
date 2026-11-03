package identity

import (
	"net/http"
	"net/http/httptest"
	"path/filepath"
	"strings"
	"testing"
)

func TestClientErrorsActionAllowsGuests(t *testing.T) {
	p := newIDP(t)
	s := newService(t, p, filepath.Join(t.TempDir(), "sessions.db"))
	called := false
	server := httptest.NewServer(s.Wrap(http.HandlerFunc(func(w http.ResponseWriter, _ *http.Request) {
		called = true
		w.WriteHeader(http.StatusNoContent)
	})))
	defer server.Close()
	client := testClient(t)
	rq, _ := http.NewRequest(http.MethodPost, server.URL+"/v1/client-errors", strings.NewReader(`{"message":"boom","source":"error"}`))
	rq.Header.Set("Content-Type", "application/json")
	r, err := client.Do(rq)
	if err != nil {
		t.Fatal(err)
	}
	r.Body.Close()
	if r.StatusCode != http.StatusNoContent || !called {
		t.Fatalf("status=%d called=%v", r.StatusCode, called)
	}
}

func TestClientErrorsBeaconSkipsResourceAssertion(t *testing.T) {
	p := newIDP(t)
	s := newService(t, p, filepath.Join(t.TempDir(), "sessions.db"), func(c *Config) { c.RequireResourceHeader = true })
	called := false
	server := httptest.NewServer(s.Wrap(http.HandlerFunc(func(w http.ResponseWriter, _ *http.Request) {
		called = true
		w.WriteHeader(http.StatusNoContent)
	})))
	defer server.Close()
	client := testClient(t)

	beacon, _ := http.NewRequest(http.MethodPost, server.URL+"/v1/client-errors", strings.NewReader(`{"message":"boom"}`))
	beacon.Header.Set("Content-Type", "application/json")
	r, err := client.Do(beacon)
	if err != nil {
		t.Fatal(err)
	}
	r.Body.Close()
	if r.StatusCode != http.StatusNoContent || !called {
		t.Fatalf("beacon status=%d called=%v", r.StatusCode, called)
	}

	// Every other route keeps the assertion; a guest-readable route isolates
	// it from the permission check, which fires first on write routes.
	other, _ := http.NewRequest(http.MethodGet, server.URL+"/v1/financial-model", nil)
	r, err = client.Do(other)
	if err != nil {
		t.Fatal(err)
	}
	r.Body.Close()
	if r.StatusCode != http.StatusConflict {
		t.Fatalf("other route status=%d", r.StatusCode)
	}

	getRequest, _ := http.NewRequest(http.MethodGet, server.URL+"/v1/client-errors", nil)
	r, err = client.Do(getRequest)
	if err != nil {
		t.Fatal(err)
	}
	r.Body.Close()
	if r.StatusCode != http.StatusConflict {
		t.Fatalf("GET beacon route status=%d", r.StatusCode)
	}
}

func TestGuestDeniedUnknownWriteRoute(t *testing.T) {
	p := newIDP(t)
	s := newService(t, p, filepath.Join(t.TempDir(), "sessions.db"))
	server := httptest.NewServer(s.Wrap(http.HandlerFunc(func(w http.ResponseWriter, _ *http.Request) {
		w.WriteHeader(http.StatusNoContent)
	})))
	defer server.Close()
	client := testClient(t)
	rq, _ := http.NewRequest(http.MethodPost, server.URL+"/v1/client-errorss", strings.NewReader(`{}`))
	r, err := client.Do(rq)
	if err != nil {
		t.Fatal(err)
	}
	r.Body.Close()
	if r.StatusCode != http.StatusUnauthorized {
		t.Fatalf("status=%d", r.StatusCode)
	}
}
