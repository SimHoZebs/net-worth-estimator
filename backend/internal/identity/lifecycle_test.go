package identity

import (
	"encoding/json"
	"errors"
	"fmt"
	"github.com/simhozebs/net-worth-estimator/backend/internal/store"
	"github.com/simhozebs/net-worth-estimator/backend/internal/store/adapters/sqlite"
	"net/http"
	"net/http/httptest"
	"net/url"
	"path/filepath"
	"strings"
	"sync"
	"testing"
	"time"

	"github.com/go-jose/go-jose/v4"
)

func signedIn(t *testing.T, p *testIDP, path string) (*Service, *httptest.Server, *http.Client) {
	t.Helper()
	s := newService(t, p, path)
	server := httptest.NewServer(s.Wrap(http.HandlerFunc(func(w http.ResponseWriter, _ *http.Request) { w.WriteHeader(204) })))
	t.Cleanup(server.Close)
	client := testClient(t)
	r := signIn(t, s, p, server, client, false)
	r.Body.Close()
	if r.StatusCode != 302 {
		t.Fatalf("sign in=%d", r.StatusCode)
	}
	return s, server, client
}

func currentGrant(t *testing.T, s *Service) store.Grant {
	t.Helper()
	var data []byte
	if err := s.store.(*sqlite.Database).SQL().QueryRow(`SELECT data FROM identity_grants LIMIT 1`).Scan(&data); err != nil {
		t.Fatal(err)
	}
	var g store.Grant
	if err := json.Unmarshal(data, &g); err != nil {
		t.Fatal(err)
	}
	return g
}

func staleGrant(t *testing.T, s *Service, expireToken bool) store.Grant {
	t.Helper()
	g := currentGrant(t, s)
	g.CheckedAt = time.Now().Add(-time.Hour).UnixNano()
	if expireToken {
		g.TokenExpiry = time.Now().Add(-time.Minute).Unix()
	}
	if err := s.store.UpdateGrant(g); err != nil {
		t.Fatal(err)
	}
	return g
}

func writeStatus(t *testing.T, client *http.Client, address string) int {
	t.Helper()
	r, err := client.Post(address+"/v1/accounts", "application/json", nil)
	if err != nil {
		t.Fatal(err)
	}
	defer r.Body.Close()
	return r.StatusCode
}

func TestProviderRevocationAndOutage(t *testing.T) {
	for _, revoked := range []bool{false, true} {
		t.Run(fmt.Sprint("revoked=", revoked), func(t *testing.T) {
			p := newIDP(t)
			s, server, client := signedIn(t, p, filepath.Join(t.TempDir(), "sessions.db"))
			g := staleGrant(t, s, false)
			want := 503
			if revoked {
				p.active.Store(false)
				want = 401
			} else {
				p.introspectionStatus.Store(503)
			}
			if got := writeStatus(t, client, server.URL); got != want {
				t.Fatalf("provider check=%d want=%d", got, want)
			}
			persisted, err := s.store.FindGrant(g.ID, g.Issuer)
			if err != nil || (persisted.ID == "") != revoked {
				t.Fatalf("grant retained/revoked=%v %v", persisted.ID != "", err)
			}
			if !revoked {
				p.introspectionStatus.Store(0)
				if got := writeStatus(t, client, server.URL); got != 204 {
					t.Fatalf("recovery after provider outage=%d", got)
				}
			}
		})
	}
}

func TestConcurrentRefreshAndAbsoluteSessionDeadline(t *testing.T) {
	p := newIDP(t)
	s, server, client := signedIn(t, p, filepath.Join(t.TempDir(), "sessions.db"))
	before := staleGrant(t, s, true)
	var requests sync.WaitGroup
	for range 16 {
		requests.Go(func() {
			r, err := client.Get(server.URL + "/v1/financial-model")
			if err != nil {
				t.Error(err)
				return
			}
			r.Body.Close()
			if r.StatusCode != 204 {
				t.Errorf("concurrent refresh status=%d", r.StatusCode)
			}
		})
	}
	requests.Wait()
	after := currentGrant(t, s)
	if p.refreshes.Load() != 1 || after.AccessToken != "access-refreshed" || after.Expiry != before.Expiry {
		t.Fatalf("refresh count=%d, access rotated=%v, absolute expiry preserved=%v", p.refreshes.Load(), after.AccessToken == "access-refreshed", after.Expiry == before.Expiry)
	}
}

func TestRefreshRejectsRevocationAndIdentityChanges(t *testing.T) {
	for _, changedIdentity := range []bool{false, true} {
		t.Run(fmt.Sprint("changed identity=", changedIdentity), func(t *testing.T) {
			p := newIDP(t)
			s, server, client := signedIn(t, p, filepath.Join(t.TempDir(), "sessions.db"))
			staleGrant(t, s, true)
			if changedIdentity {
				p.refreshedSubject = "different-user"
			} else {
				p.refreshReject.Store(true)
			}
			if got := writeStatus(t, client, server.URL); got != 401 {
				t.Fatalf("invalid refresh=%d", got)
			}
		})
	}
}

func TestRefreshRotationSurvivesIntrospectionOutage(t *testing.T) {
	p := newIDP(t)
	s, server, client := signedIn(t, p, filepath.Join(t.TempDir(), "sessions.db"))
	staleGrant(t, s, true)
	p.introspectionStatus.Store(503)
	if got := writeStatus(t, client, server.URL); got != 503 {
		t.Fatalf("outage after refresh=%d", got)
	}
	if currentGrant(t, s).AccessToken != "access-refreshed" {
		t.Fatal("rotated credentials were lost during introspection outage")
	}
	p.introspectionStatus.Store(0)
	if got := writeStatus(t, client, server.URL); got != 204 || p.refreshes.Load() != 1 {
		t.Fatalf("retry after outage=%d refreshes=%d", got, p.refreshes.Load())
	}
}

func logoutClaims(p *testIDP, jti string) map[string]any {
	return map[string]any{"iss": p.server.URL, "aud": "waypoint", "sub": "editor", "iat": time.Now().Unix(), "jti": jti,
		"events": map[string]any{logoutEvent: map[string]any{}}}
}

func logoutToken(t *testing.T, p *testIDP, claims map[string]any) string {
	t.Helper()
	signer, err := jose.NewSigner(jose.SigningKey{Algorithm: jose.RS256, Key: p.key}, (&jose.SignerOptions{}).WithHeader("kid", "test"))
	if err != nil {
		t.Fatal(err)
	}
	data, _ := json.Marshal(claims)
	signed, _ := signer.Sign(data)
	raw, _ := signed.CompactSerialize()
	return raw
}

func sendLogout(t *testing.T, server *httptest.Server, raw string) int {
	t.Helper()
	r, err := http.PostForm(server.URL+prefix+"backchannel-logout", url.Values{"logout_token": {raw}})
	if err != nil {
		t.Fatal(err)
	}
	defer r.Body.Close()
	if len(r.Cookies()) != 0 {
		t.Fatal("back-channel notification created a browser session")
	}
	return r.StatusCode
}

func TestBackchannelLogoutVerification(t *testing.T) {
	for _, scenario := range []struct {
		name   string
		change func(map[string]any)
	}{
		{"wrong issuer", func(c map[string]any) { c["iss"] = "https://other.test" }},
		{"wrong audience", func(c map[string]any) { c["aud"] = "other" }},
		{"old token", func(c map[string]any) { c["iat"] = time.Now().Add(-5 * time.Minute).Unix() }},
		{"future token", func(c map[string]any) { c["iat"] = time.Now().Add(5 * time.Minute).Unix() }},
		{"missing iat", func(c map[string]any) { delete(c, "iat") }},
		{"missing jti", func(c map[string]any) { delete(c, "jti") }},
		{"missing subject and sid", func(c map[string]any) { delete(c, "sub") }},
		{"nonce present", func(c map[string]any) { c["nonce"] = "" }},
		{"missing event", func(c map[string]any) { delete(c, "events") }},
		{"null event", func(c map[string]any) { c["events"] = map[string]any{logoutEvent: nil} }},
		{"expired exp", func(c map[string]any) { c["exp"] = time.Now().Add(-time.Minute).Unix() }},
	} {
		t.Run(scenario.name, func(t *testing.T) {
			p := newIDP(t)
			_, server, client := signedIn(t, p, filepath.Join(t.TempDir(), "sessions.db"))
			claims := logoutClaims(p, scenario.name)
			scenario.change(claims)
			if got := sendLogout(t, server, logoutToken(t, p, claims)); got != 400 {
				t.Fatalf("invalid notification=%d", got)
			}
			if got := writeStatus(t, client, server.URL); got != 204 {
				t.Fatalf("invalid notification changed session=%d", got)
			}
		})
	}
}

func TestBackchannelScopeReplayAndPersistence(t *testing.T) {
	for _, scoped := range []bool{false, true} {
		t.Run(fmt.Sprint("sid only=", scoped), func(t *testing.T) {
			p := newIDP(t)
			if scoped {
				p.sid = "provider-session"
			}
			path := filepath.Join(t.TempDir(), "sessions.db")
			s, server, client := signedIn(t, p, path)
			before := currentGrant(t, s)
			claims := logoutClaims(p, "persistent-jti")
			if scoped {
				delete(claims, "sub")
				claims["sid"] = p.sid
			} else {
				// Casdoor includes a sid in logout but omits it from its ID token.
				claims["sid"] = "unknown-provider-session"
			}
			raw := logoutToken(t, p, claims)
			if got := sendLogout(t, server, raw); got != 200 || writeStatus(t, client, server.URL) != 401 {
				t.Fatalf("logout notification=%d", got)
			}
			if err := s.store.UpdateGrant(before); !errors.Is(err, store.ErrGrantRevoked) {
				t.Fatalf("stale refresh restored a revoked grant: %v", err)
			}
			if err := s.store.CreateGrant(before); !errors.Is(err, store.ErrGrantRevoked) {
				t.Fatalf("pending callback restored a revoked grant: %v", err)
			}
			if err := s.Close(); err != nil {
				t.Fatal(err)
			}
			restarted := newService(t, p, path)
			other := httptest.NewServer(restarted.Wrap(http.HandlerFunc(func(w http.ResponseWriter, _ *http.Request) { w.WriteHeader(204) })))
			defer other.Close()
			r := signIn(t, restarted, p, other, client, false)
			r.Body.Close()
			if r.StatusCode != 302 {
				t.Fatalf("new login after notification=%d", r.StatusCode)
			}
			if got := sendLogout(t, other, raw); got != 200 || writeStatus(t, client, other.URL) != 204 {
				t.Fatalf("replayed logout revoked a new login after restart: status=%d", got)
			}
		})
	}
}

func TestBackchannelRejectsMethodBodyAndSignature(t *testing.T) {
	p := newIDP(t)
	_, server, client := signedIn(t, p, filepath.Join(t.TempDir(), "sessions.db"))
	r, _ := client.Get(server.URL + prefix + "backchannel-logout")
	r.Body.Close()
	if r.StatusCode != 405 {
		t.Fatalf("GET logout notification=%d", r.StatusCode)
	}
	if got := sendLogout(t, server, logoutToken(t, p, logoutClaims(p, "bad-signature"))+"broken"); got != 400 {
		t.Fatalf("bad signature=%d", got)
	}
	r, _ = http.Post(server.URL+prefix+"backchannel-logout", "application/x-www-form-urlencoded", strings.NewReader("logout_token="+strings.Repeat("x", 40<<10)))
	r.Body.Close()
	if r.StatusCode != 400 || writeStatus(t, client, server.URL) != 204 {
		t.Fatalf("oversized notification=%d", r.StatusCode)
	}
}
