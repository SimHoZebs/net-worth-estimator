package identity

import (
	"encoding/json"
	"net/http"
	"net/http/httptest"
	"net/url"
	"path/filepath"
	"strings"
	"testing"
)

const lanApp = "https://app.lan.test"
const tailApp = "https://node.tail.test:18081"
const tailProvider = "https://node.tail.test:18083"

func multipleBrowsers(p *testIDP) func(*Config) {
	return func(c *Config) {
		c.PublicURL = lanApp
		c.AccountURL = p.server.URL + "/account"
		c.BrowserOrigins = map[string]string{tailApp: tailProvider}
	}
}

func browserRequest(h http.Handler, method, origin, path string, cookies []*http.Cookie, headers map[string]string) *httptest.ResponseRecorder {
	r := httptest.NewRequest(method, origin+path, nil)
	for _, cookie := range cookies {
		r.AddCookie(cookie)
	}
	for name, value := range headers {
		r.Header.Set(name, value)
	}
	w := httptest.NewRecorder()
	h.ServeHTTP(w, r)
	return w
}

func browserLogin(t *testing.T, h http.Handler, p *testIDP, app string) (*httptest.ResponseRecorder, []*http.Cookie, *url.URL) {
	t.Helper()
	w := browserRequest(h, "GET", app, prefix+"login", nil, nil)
	if w.Code != http.StatusFound {
		t.Fatalf("login=%d %s", w.Code, w.Body.String())
	}
	authorize, err := url.Parse(w.Header().Get("Location"))
	if err != nil {
		t.Fatal(err)
	}
	p.nonce = authorize.Query().Get("nonce")
	return w, w.Result().Cookies(), authorize
}

func TestBrowserEndpointsKeepIssuerAndReturnToStartingAddress(t *testing.T) {
	p := newIDP(t)
	s := newService(t, p, filepath.Join(t.TempDir(), "sessions.db"), multipleBrowsers(p))
	s.logoutEndpoint = p.server.URL + "/logout"
	h := s.Wrap(http.NotFoundHandler())
	for _, app := range []string{lanApp, tailApp, lanApp} {
		login, cookies, authorize := browserLogin(t, h, p, app)
		if authorize.Query().Get("redirect_uri") != app+prefix+"callback" {
			t.Fatalf("wrong callback: %s", authorize.Query().Get("redirect_uri"))
		}
		wantProvider := p.server.URL
		if app == tailApp {
			wantProvider = tailProvider
		}
		if authorize.Scheme+"://"+authorize.Host != wantProvider {
			t.Fatalf("wrong browser provider: %s", authorize)
		}
		if len(cookies) != 1 || !cookies[0].Secure || !cookies[0].HttpOnly || !strings.HasPrefix(cookies[0].Name, "__Host-waypoint_") || cookies[0].Domain != "" {
			t.Fatalf("unsafe app cookie: %s", login.Header().Get("Set-Cookie"))
		}
		callback := prefix + "callback?code=code&state=" + url.QueryEscape(authorize.Query().Get("state"))
		w := browserRequest(h, "GET", app, callback, cookies, nil)
		if w.Code != 302 || w.Header().Get("Location") != app+"/" {
			t.Fatalf("callback=%d location=%s body=%s", w.Code, w.Header().Get("Location"), w.Body.String())
		}
		cookies = w.Result().Cookies()
		w = browserRequest(h, "GET", app, prefix+"session", cookies, nil)
		var session struct {
			Authenticated bool
			AccountURL    string
			Resource      struct{ ID string }
		}
		if err := json.Unmarshal(w.Body.Bytes(), &session); err != nil || !session.Authenticated || session.AccountURL != wantProvider+"/account" {
			t.Fatalf("session=%s error=%v", w.Body.String(), err)
		}
		if g := currentGrant(t, s); g.Issuer != p.server.URL || g.Subject != p.subject {
			t.Fatal("browser alias changed the identity")
		}
		w = browserRequest(h, "POST", app, prefix+"logout", cookies, map[string]string{"Origin": app})
		var result struct{ LogoutURL string }
		_ = json.Unmarshal(w.Body.Bytes(), &result)
		logout, err := url.Parse(result.LogoutURL)
		if w.Code != 200 || err != nil || logout.Scheme+"://"+logout.Host != wantProvider || logout.Query().Get("post_logout_redirect_uri") != app+"/" {
			t.Fatalf("logout=%d %s", w.Code, w.Body.String())
		}
	}
}

func TestBrowserLoginRejectsUnconfiguredHostsAndCrossOriginCallbacks(t *testing.T) {
	p := newIDP(t)
	s := newService(t, p, filepath.Join(t.TempDir(), "sessions.db"), multipleBrowsers(p))
	h := s.Wrap(http.NotFoundHandler())
	w := browserRequest(h, "GET", "https://unconfigured.test", prefix+"login", nil, map[string]string{"X-Forwarded-Host": "node.tail.test:18081"})
	if w.Code != 403 || len(w.Result().Cookies()) != 0 {
		t.Fatalf("unknown host=%d", w.Code)
	}
	_, cookies, authorize := browserLogin(t, h, p, tailApp)
	callback := prefix + "callback?code=code&state=" + url.QueryEscape(authorize.Query().Get("state"))
	w = browserRequest(h, "GET", lanApp, callback, cookies, nil)
	if w.Code != 400 {
		t.Fatalf("cross-origin callback=%d", w.Code)
	}
	var count int
	if err := s.store.db.QueryRow("SELECT COUNT(*) FROM identity_grants").Scan(&count); err != nil || count != 0 {
		t.Fatal("cross-origin callback created a grant")
	}
}

func TestSiblingAppOriginCannotSubmitLogout(t *testing.T) {
	p := newIDP(t)
	s := newService(t, p, filepath.Join(t.TempDir(), "sessions.db"), multipleBrowsers(p))
	h := s.Wrap(http.NotFoundHandler())
	_, cookies, authorize := browserLogin(t, h, p, tailApp)
	w := browserRequest(h, "GET", tailApp, prefix+"callback?code=code&state="+url.QueryEscape(authorize.Query().Get("state")), cookies, nil)
	cookies = w.Result().Cookies()
	w = browserRequest(h, "POST", tailApp, prefix+"logout", cookies, map[string]string{"Origin": lanApp})
	if w.Code != 403 {
		t.Fatalf("cross-origin logout=%d", w.Code)
	}
	w = browserRequest(h, "GET", tailApp, prefix+"session", cookies, nil)
	if !strings.Contains(w.Body.String(), `"authenticated":true`) {
		t.Fatal("rejected logout destroyed the session")
	}
}

func TestProxyOriginsUseCanonicalAppsAndProviderAliases(t *testing.T) {
	c := Config{
		PublicURL: "https://APP.test:443/", Issuer: "https://identity.test",
		BrowserOrigins: map[string]string{"https://ALIAS.test:8443/": "https://LOGIN.test:443/"},
	}
	origins, err := c.ProxyOrigins()
	if err != nil {
		t.Fatal(err)
	}
	want := map[string]bool{"https://app.test": true, "https://alias.test:8443": true, "https://login.test": true}
	if len(origins) != len(want) {
		t.Fatalf("unexpected proxy origins: %v", origins)
	}
	for _, origin := range origins {
		if !want[origin] {
			t.Fatalf("unexpected proxy origin %q", origin)
		}
	}
	c.PublicURL = "https://app.test/invalid"
	if _, err := c.ProxyOrigins(); err == nil {
		t.Fatal("accepted an invalid application origin")
	}
}

func TestCanonicalBrowserOriginSingleCheckerParity(t *testing.T) {
	bare, err := canonicalBrowserOrigin("https://app.example.com", false)
	if err != nil {
		t.Fatalf("bare: %v", err)
	}
	slashed, err := canonicalBrowserOrigin("https://app.example.com/", false)
	if err != nil {
		t.Fatalf("slashed: %v", err)
	}
	if bare != "https://app.example.com" || slashed != bare {
		t.Fatalf("trailing slash did not normalize identically: %q vs %q", bare, slashed)
	}
	for _, raw := range []string{"https://app.test/v1", "https://user:pass@app.test", "https://app.test.", "https://app.test./"} {
		if _, err := canonicalBrowserOrigin(raw, false); err == nil {
			t.Fatalf("canonicalBrowserOrigin(%q) accepted", raw)
		}
		c := Config{PublicURL: raw, Issuer: "https://identity.test"}
		if _, err := c.ProxyOrigins(); err == nil {
			t.Fatalf("ProxyOrigins accepted %q", raw)
		}
	}
}
