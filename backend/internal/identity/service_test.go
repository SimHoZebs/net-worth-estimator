package identity

import (
	"context"
	"crypto/rand"
	"crypto/rsa"
	"crypto/sha256"
	"encoding/base64"
	"encoding/json"
	"io"
	"net/http"
	"net/http/cookiejar"
	"net/http/httptest"
	"net/url"
	"os"
	"path/filepath"
	"sync/atomic"
	"testing"
	"time"

	"github.com/go-jose/go-jose/v4"
	"github.com/simhozebs/net-worth-estimator/backend/internal/authorization"
)

type testIDP struct {
	server                           *httptest.Server
	nonce, subject, audience, issuer string
	badSignature                     bool
	accessTokenHash                  string
	active                           atomic.Bool
	introspectionStatus              atomic.Int64
	refreshes                        atomic.Int64
	refreshReject                    atomic.Bool
	refreshedSubject                 string
	sid                              string
	key                              *rsa.PrivateKey
}

func newIDP(t *testing.T) *testIDP {
	t.Helper()
	key, err := rsa.GenerateKey(rand.Reader, 2048)
	if err != nil {
		t.Fatal(err)
	}
	p := &testIDP{key: key, subject: "editor", audience: "waypoint"}
	p.active.Store(true)
	p.server = httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		switch r.URL.Path {
		case "/.well-known/openid-configuration":
			respond(w, map[string]any{"issuer": p.server.URL, "authorization_endpoint": p.server.URL + "/authorize", "token_endpoint": p.server.URL + "/token", "jwks_uri": p.server.URL + "/jwks", "introspection_endpoint": p.server.URL + "/introspect", "backchannel_logout_supported": true, "id_token_signing_alg_values_supported": []string{"RS256"}})
		case "/jwks":
			respond(w, jose.JSONWebKeySet{Keys: []jose.JSONWebKey{{Key: &p.key.PublicKey, KeyID: "test", Algorithm: "RS256", Use: "sig"}}})
		case "/token":
			_ = r.ParseForm()
			refresh := r.Form.Get("grant_type") == "refresh_token"
			if refresh {
				p.refreshes.Add(1)
				if p.refreshReject.Load() {
					w.Header().Set("Content-Type", "application/json")
					w.WriteHeader(400)
					respond(w, map[string]string{"error": "invalid_grant"})
					return
				}
			}
			if !refresh && r.Form.Get("code_verifier") == "" {
				t.Error("missing PKCE verifier")
			}
			issuer := p.server.URL
			if p.issuer != "" {
				issuer = p.issuer
			}
			signer, err := jose.NewSigner(jose.SigningKey{Algorithm: jose.RS256, Key: p.key}, (&jose.SignerOptions{}).WithHeader("kid", "test"))
			if err != nil {
				t.Error(err)
				return
			}
			subject, nonce, access := p.subject, p.nonce, "access"
			if refresh {
				nonce, access = "", "access-refreshed"
				if p.refreshedSubject != "" {
					subject = p.refreshedSubject
				}
			}
			body, _ := json.Marshal(map[string]any{"iss": issuer, "aud": p.audience, "sub": subject, "sid": p.sid, "name": "Test user", "nonce": nonce, "exp": time.Now().Add(time.Hour).Unix(), "iat": time.Now().Unix(), "at_hash": p.accessTokenHash})
			signed, _ := signer.Sign(body)
			raw, _ := signed.CompactSerialize()
			if p.badSignature {
				raw += "broken"
			}
			respond(w, map[string]any{"access_token": access, "refresh_token": "refresh", "token_type": "Bearer", "expires_in": 3600, "id_token": raw})
		case "/introspect":
			if status := p.introspectionStatus.Load(); status != 0 {
				w.WriteHeader(int(status))
				return
			}
			client, secret, ok := r.BasicAuth()
			if !ok || client != "waypoint" || secret != "secret" {
				t.Error("introspection client authentication missing")
			}
			respond(w, map[string]any{"active": p.active.Load(), "sub": p.subject, "client_id": "waypoint", "iss": p.server.URL, "aud": []string{"waypoint"}})
		default:
			http.NotFound(w, r)
		}
	}))
	t.Cleanup(p.server.Close)
	return p
}

func newService(t *testing.T, p *testIDP, path string) *Service {
	t.Helper()
	s, err := New(context.Background(), Config{Provider: "casdoor", Issuer: p.server.URL, PublicURL: "http://localhost:8080", ClientID: "waypoint", ClientSecret: "secret", SessionDB: path, Lifetime: time.Hour,
		ResolveAccess: func(_ context.Context, subject string) (authorization.Scope, error) {
			permissions := []string{"plan:read", "plan:project"}
			if subject != "" {
				permissions = append(permissions, "plan:write")
			}
			return authorization.Scope{Resource: authorization.ResourceFor(p.server.URL, subject), Permissions: permissions}, nil
		},
	})
	if err != nil {
		t.Fatal(err)
	}
	t.Cleanup(func() { _ = s.Close() })
	return s
}

func testClient(t *testing.T) *http.Client {
	t.Helper()
	jar, _ := cookiejar.New(nil)
	return &http.Client{Jar: jar, CheckRedirect: func(_ *http.Request, _ []*http.Request) error { return http.ErrUseLastResponse }}
}

func signIn(t *testing.T, s *Service, p *testIDP, server *httptest.Server, client *http.Client, changeNonce bool) *http.Response {
	t.Helper()
	r, err := client.Get(server.URL + prefix + "login")
	if err != nil {
		t.Fatal(err)
	}
	r.Body.Close()
	authorize, err := url.Parse(r.Header.Get("Location"))
	if err != nil {
		t.Fatal(err)
	}
	if authorize.Query().Get("code_challenge_method") != "S256" || authorize.Query().Get("code_challenge") == "" {
		t.Fatal("PKCE missing")
	}
	p.nonce = authorize.Query().Get("nonce")
	if changeNonce {
		p.nonce = "wrong"
	}
	r, err = client.Get(server.URL + prefix + "callback?code=code&state=" + url.QueryEscape(authorize.Query().Get("state")))
	if err != nil {
		t.Fatal(err)
	}
	return r
}

func TestOIDCIdentityVerification(t *testing.T) {
	hash := sha256.Sum256([]byte("access"))
	validBinding := base64.RawURLEncoding.EncodeToString(hash[:len(hash)/2])
	for _, test := range []struct {
		name, subject, audience, issuer string
		accessTokenHash                 string
		badNonce, badSignature          bool
		want                            int
	}{
		{name: "valid", subject: "editor", audience: "waypoint", want: 302},
		{name: "wrong nonce", subject: "editor", audience: "waypoint", badNonce: true, want: 401},
		{name: "wrong audience", subject: "editor", audience: "other", want: 401},
		{name: "wrong issuer", subject: "editor", audience: "waypoint", issuer: "https://evil.test", want: 401},
		{name: "bad signature", subject: "editor", audience: "waypoint", badSignature: true, want: 401},
		{name: "valid access token binding", subject: "editor", audience: "waypoint", accessTokenHash: validBinding, want: 302},
		{name: "wrong access token binding", subject: "editor", audience: "waypoint", accessTokenHash: "wrong", want: 401},
	} {
		t.Run(test.name, func(t *testing.T) {
			p := newIDP(t)
			p.subject = test.subject
			p.audience = test.audience
			p.issuer = test.issuer
			p.badSignature = test.badSignature
			p.accessTokenHash = test.accessTokenHash
			s := newService(t, p, filepath.Join(t.TempDir(), "sessions.db"))
			server := httptest.NewServer(s.Wrap(http.HandlerFunc(func(w http.ResponseWriter, _ *http.Request) { w.WriteHeader(204) })))
			defer server.Close()
			r := signIn(t, s, p, server, testClient(t), test.badNonce)
			defer r.Body.Close()
			if r.StatusCode != test.want {
				b, _ := io.ReadAll(r.Body)
				t.Fatalf("status=%d body=%s", r.StatusCode, b)
			}
		})
	}
}

func TestAccountAccessSessionsAndCSRF(t *testing.T) {
	p := newIDP(t)
	s := newService(t, p, filepath.Join(t.TempDir(), "sessions.db"))
	server := httptest.NewServer(s.Wrap(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		if r.URL.Path == "/healthz" {
			w.WriteHeader(200)
			return
		}
		if _, ok := w.(http.Flusher); !ok {
			t.Error("SSE Flusher lost")
		}
		w.WriteHeader(204)
	})))
	defer server.Close()
	for _, subject := range []string{"editor", "reader", "uninvited"} {
		t.Run(subject, func(t *testing.T) {
			client := testClient(t)
			r, _ := client.Get(server.URL + "/v1/financial-model")
			r.Body.Close()
			if r.StatusCode != 204 {
				t.Fatalf("anonymous status=%d", r.StatusCode)
			}
			p.subject = subject
			r = signIn(t, s, p, server, client, false)
			r.Body.Close()
			for _, req := range []struct {
				method, path string
				want         int
			}{
				{"GET", "/v1/financial-model", 204}, {"POST", "/v1/projections/deterministic", 204}, {"POST", "/v1/new-write-route", 204}, {"PATCH", "/v1/accounts/a", 204},
			} {
				want := req.want
				rq, _ := http.NewRequest(req.method, server.URL+req.path, nil)
				r, err := client.Do(rq)
				if err != nil {
					t.Fatal(err)
				}
				r.Body.Close()
				if r.StatusCode != want {
					t.Fatalf("%s %s=%d want %d", req.method, req.path, r.StatusCode, want)
				}
			}
			rq, _ := http.NewRequest("POST", server.URL+prefix+"logout", nil)
			rq.Header.Set("Origin", "https://evil.test")
			r, _ = client.Do(rq)
			r.Body.Close()
			if r.StatusCode != 403 {
				t.Fatalf("cross-site logout=%d", r.StatusCode)
			}
			rq, _ = http.NewRequest("POST", server.URL+prefix+"logout", nil)
			r, _ = client.Do(rq)
			r.Body.Close()
			if r.StatusCode != 200 {
				t.Fatalf("logout=%d", r.StatusCode)
			}
			r, _ = client.Get(server.URL + "/v1/financial-model")
			r.Body.Close()
			if r.StatusCode != 204 {
				t.Fatalf("logged-out status=%d", r.StatusCode)
			}
		})
	}
}

func TestSessionStorePersistsHashesAndExpires(t *testing.T) {
	path := filepath.Join(t.TempDir(), "sessions.db")
	if err := os.WriteFile(path, nil, 0o644); err != nil {
		t.Fatal(err)
	}
	s, err := openSessions(path)
	if err != nil {
		t.Fatal(err)
	}
	info, err := os.Stat(path)
	if err != nil || info.Mode().Perm() != 0o600 {
		t.Fatalf("private session file permissions: %v %v", info, err)
	}
	if err := s.Commit("secret-cookie", []byte("state"), time.Now().Add(time.Hour)); err != nil {
		t.Fatal(err)
	}
	var token string
	if err := s.db.QueryRow(`SELECT token FROM sessions`).Scan(&token); err != nil {
		t.Fatal(err)
	}
	if token == "secret-cookie" {
		t.Fatal("raw token stored")
	}
	s.db.Close()
	s, err = openSessions(path)
	if err != nil {
		t.Fatal(err)
	}
	defer s.db.Close()
	b, found, err := s.Find("secret-cookie")
	if err != nil || !found || string(b) != "state" {
		t.Fatalf("restarted session=%q %v %v", b, found, err)
	}
	if err := s.Commit("expired", []byte("expired state"), time.Now().Add(-time.Second)); err != nil {
		t.Fatal(err)
	}
	_, found, err = s.Find("expired")
	if err != nil || found {
		t.Fatalf("expired=%v %v", found, err)
	}
}

func TestAnonymousDiscoveryBoundary(t *testing.T) {
	p := newIDP(t)
	s := newService(t, p, filepath.Join(t.TempDir(), "sessions.db"))
	server := httptest.NewServer(s.Wrap(http.HandlerFunc(func(w http.ResponseWriter, _ *http.Request) {
		w.WriteHeader(http.StatusNoContent)
	})))
	defer server.Close()
	client := testClient(t)
	for _, item := range []struct {
		path string
		want int
	}{{"/v1/status", 204}, {prefix + "session", 200}, {"/healthz", 204}} {
		response, err := client.Get(server.URL + item.path)
		if err != nil {
			t.Fatal(err)
		}
		response.Body.Close()
		if response.StatusCode != item.want {
			t.Fatalf("anonymous %s=%d want=%d", item.path, response.StatusCode, item.want)
		}
	}
}

func TestStateCannotBeReplayedAndSessionsFailClosed(t *testing.T) {
	p := newIDP(t)
	s := newService(t, p, filepath.Join(t.TempDir(), "sessions.db"))
	server := httptest.NewServer(s.Wrap(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		if !CanWrite(r.Context()) {
			t.Error("editor identity missing from request context")
		}
		w.WriteHeader(http.StatusNoContent)
	})))
	defer server.Close()
	client := testClient(t)
	r := signIn(t, s, p, server, client, false)
	r.Body.Close()
	u, _ := url.Parse(server.URL)
	oldCookies := client.Jar.Cookies(u)
	r, _ = client.Get(server.URL + prefix + "callback?code=replayed&state=replayed")
	r.Body.Close()
	if r.StatusCode != 400 {
		t.Fatalf("callback replay=%d", r.StatusCode)
	}
	// A provider switch cannot carry an old provider's grants or session across.
	issuer := s.config.Issuer
	s.config.Issuer = "https://other-provider.test"
	req, _ := http.NewRequest("POST", server.URL+"/v1/accounts", nil)
	r, _ = client.Do(req)
	r.Body.Close()
	if r.StatusCode != 401 {
		t.Fatalf("cross-provider session=%d", r.StatusCode)
	}
	s.config.Issuer = issuer
	req, _ = http.NewRequest("POST", server.URL+"/v1/accounts", nil)
	r, _ = client.Do(req)
	r.Body.Close()
	if r.StatusCode != 204 {
		t.Fatalf("restored provider session=%d", r.StatusCode)
	}
	req, _ = http.NewRequest("POST", server.URL+prefix+"logout", nil)
	r, _ = client.Do(req)
	r.Body.Close()
	// Browser logout destroys server state, not just the browser cookie.
	replay := testClient(t)
	replay.Jar.SetCookies(u, oldCookies)
	req, _ = http.NewRequest("POST", server.URL+"/v1/accounts", nil)
	r, _ = replay.Do(req)
	r.Body.Close()
	if r.StatusCode != 401 {
		t.Fatalf("captured logged-out cookie=%d", r.StatusCode)
	}
}
