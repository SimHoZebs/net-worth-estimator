package identity

import (
	"encoding/json"
	"net/http"
	"net/http/httptest"
	"path/filepath"
	"slices"
	"strings"
	"testing"

	"github.com/simhozebs/net-worth-estimator/backend/internal/api"
	"github.com/simhozebs/net-worth-estimator/backend/internal/store/adapters/sqlite"
)

func TestResourceCapabilitiesDriveAPIReadOnlyStatus(t *testing.T) {
	p := newIDP(t)
	p.subject = "new-account-with-no-grant"
	s := newService(t, p, filepath.Join(t.TempDir(), "sessions.db"))
	database, err := sqlite.Open(filepath.Join(t.TempDir(), "financial.db"))
	if err != nil {
		t.Fatal(err)
	}
	defer database.Close()
	server := httptest.NewServer(s.Wrap(api.New(database, api.Config{CanWrite: CanWrite})))
	defer server.Close()
	client := testClient(t)

	checkSession := func(authenticated, writable bool) {
		t.Helper()
		r, err := client.Get(server.URL + prefix + "session")
		if err != nil {
			t.Fatal(err)
		}
		defer r.Body.Close()
		var session struct {
			Authenticated, Allowed bool
			User                   map[string]any
			Resource               struct{ Permissions []string }
		}
		if err := json.NewDecoder(r.Body).Decode(&session); err != nil {
			t.Fatal(err)
		}
		if r.StatusCode != 200 || session.Authenticated != authenticated || !session.Allowed || slices.Contains(session.Resource.Permissions, "account:write") != writable {
			t.Fatalf("session status=%d body=%+v", r.StatusCode, session)
		}
		if _, exists := session.User["role"]; exists {
			t.Fatal("session contains a redundant role instead of capabilities")
		}
	}
	checkStatus := func(readOnly bool) {
		t.Helper()
		r, err := client.Get(server.URL + "/v1/status")
		if err != nil {
			t.Fatal(err)
		}
		defer r.Body.Close()
		var status struct{ ReadOnly bool }
		if err := json.NewDecoder(r.Body).Decode(&status); err != nil {
			t.Fatal(err)
		}
		if r.StatusCode != 200 || status.ReadOnly != readOnly {
			t.Fatalf("status=%d readOnly=%v want=%v", r.StatusCode, status.ReadOnly, readOnly)
		}
	}
	checkWrite := func(want int, origin string) {
		t.Helper()
		rq, _ := http.NewRequest(http.MethodPost, server.URL+"/v1/accounts", strings.NewReader(`{"name":"Demo checking","kind":"cash","enabled":true}`))
		rq.Header.Set("Content-Type", "application/json")
		if origin != "" {
			rq.Header.Set("Origin", origin)
		}
		r, err := client.Do(rq)
		if err != nil {
			t.Fatal(err)
		}
		r.Body.Close()
		if r.StatusCode != want {
			t.Fatalf("account write=%d want=%d", r.StatusCode, want)
		}
	}

	checkSession(false, false)
	checkStatus(true)
	checkWrite(http.StatusUnauthorized, "")
	r, err := client.Get(server.URL + "/v1/financial-model")
	if err != nil {
		t.Fatal(err)
	}
	r.Body.Close()
	if r.StatusCode != http.StatusOK {
		t.Fatalf("guest model=%d", r.StatusCode)
	}
	r = signIn(t, s, p, server, client, false)
	r.Body.Close()
	if r.StatusCode != http.StatusFound {
		t.Fatalf("login=%d", r.StatusCode)
	}
	checkSession(true, true)
	checkStatus(false)
	checkWrite(http.StatusOK, "")
	checkWrite(http.StatusForbidden, "https://evil.test")

	// The global read-only guard still overrides an editor session.
	readOnly := httptest.NewServer(s.Wrap(api.New(database, api.Config{CanWrite: CanWrite, ReadOnly: true})))
	defer readOnly.Close()
	rq, _ := http.NewRequest(http.MethodPost, readOnly.URL+"/v1/accounts", strings.NewReader(`{"name":"Blocked","kind":"cash","enabled":true}`))
	rq.Header.Set("Content-Type", "application/json")
	r, err = client.Do(rq)
	if err != nil {
		t.Fatal(err)
	}
	r.Body.Close()
	if r.StatusCode != http.StatusForbidden {
		t.Fatalf("read-only override=%d", r.StatusCode)
	}

	rq, _ = http.NewRequest(http.MethodPost, server.URL+prefix+"logout", nil)
	r, err = client.Do(rq)
	if err != nil {
		t.Fatal(err)
	}
	r.Body.Close()
	if r.StatusCode != http.StatusOK {
		t.Fatalf("logout=%d", r.StatusCode)
	}
	checkSession(false, false)
	checkStatus(true)
	checkWrite(http.StatusUnauthorized, "")
}

func TestGuestComputeAndFutureWriteBoundary(t *testing.T) {
	p := newIDP(t)
	s := newService(t, p, filepath.Join(t.TempDir(), "sessions.db"))
	server := httptest.NewServer(s.Wrap(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		if CanWrite(r.Context()) {
			t.Error("guest received write permission")
		}
		w.WriteHeader(http.StatusNoContent)
	})))
	defer server.Close()
	for _, test := range []struct {
		method, path string
		want         int
	}{
		{"GET", "/v1/accounts", 204}, {"HEAD", "/v1/financial-model", 204},
		{"POST", "/v1/projections/deterministic", 204}, {"POST", "/v1/projections/stochastic", 204},
		{"POST", "/v1/position", 204},
		{"POST", "/v1/future-write", 401}, {"PATCH", "/v1/accounts/a", 401},
		{"DELETE", "/v1/accounts/a", 401}, {"PUT", "/v1/pinned-evaluations", 401}, {"PUT", "/v1/safe-spending-settings", 401},
	} {
		rq, _ := http.NewRequest(test.method, server.URL+test.path, nil)
		r, err := testClient(t).Do(rq)
		if err != nil {
			t.Fatal(err)
		}
		r.Body.Close()
		if r.StatusCode != test.want {
			t.Errorf("%s %s=%d want=%d", test.method, test.path, r.StatusCode, test.want)
		}
	}
}
