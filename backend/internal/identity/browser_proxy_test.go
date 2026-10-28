package identity

import (
	"context"
	"github.com/simhozebs/net-worth-estimator/backend/internal/store/adapters/sqlite"
	"io"
	"net/http"
	"net/http/httptest"
	"net/url"
	"path/filepath"
	"strings"
	"testing"
	"time"
)

func TestProviderAliasIsolatesCookiesAndPreservesIssuerTransport(t *testing.T) {
	p := newIDP(t)
	var calls int
	provider := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		calls++
		issuer, _ := url.Parse(p.server.URL)
		if r.Host != issuer.Host || r.URL.Path != "/api/login" || r.URL.Query().Get("probe") != "1" || r.Header.Get("Origin") != p.server.URL {
			t.Errorf("unexpected provider request: host=%s path=%s origin=%s", r.Host, r.URL.String(), r.Header.Get("Origin"))
		}
		if cookie := r.Header.Get("Cookie"); cookie != "casdoor_session_id=production" {
			t.Errorf("unexpected provider cookies (%d bytes)", len(cookie))
		}
		if r.Header.Get("Authorization") != "" {
			t.Error("browser authorization header reached Casdoor")
		}
		http.SetCookie(w, &http.Cookie{Name: "casdoor_session_id", Value: "new-production", HttpOnly: true, Path: "/", SameSite: http.SameSiteLaxMode})
		http.SetCookie(w, &http.Cookie{Name: "language", Value: "en", Path: "/"})
		// Casdoor copies inline SVG logo URLs into optional theme-cache cookies.
		// These reproduce the production response's roughly 10 KiB headers.
		for _, name := range []string{"organizationLogo", "organizationLogoDark"} {
			http.SetCookie(w, &http.Cookie{Name: name, Value: strings.Repeat("x", 4792), Path: "/"})
		}
		w.Header().Set("Location", p.server.URL+"/account")
		w.WriteHeader(302)
	}))
	defer provider.Close()
	s := newService(t, p, filepath.Join(t.TempDir(), "sessions.db"), multipleBrowsers(p))
	s.client.Transport = &issuerTransport{base: http.DefaultTransport, issuer: mustURL(t, p.server.URL), internal: mustURL(t, provider.URL)}
	s.browserProviders = s.browserProviderHandlers()
	h := s.Wrap(http.NotFoundHandler())
	namespace := browserCookieNamespace(s.config) + "provider_"
	cookies := []*http.Cookie{
		{Name: "casdoor_session_id", Value: "dev-session"},
		{Name: "__Host-waypoint_session", Value: "dev-app"},
		{Name: namespace + "casdoor_session_id", Value: "production"},
		{Name: namespace + "organizationLogo", Value: strings.Repeat("x", 4792)},
		{Name: namespace + "organizationLogoDark", Value: strings.Repeat("x", 4792)},
	}
	w := browserRequest(h, "POST", tailProvider, prefix+"provider/api/login?probe=1", cookies,
		map[string]string{"Origin": tailProvider, "Authorization": "Bearer untrusted"})
	if w.Code != 302 || w.Header().Get("Location") != tailProvider+"/account" || calls != 1 {
		t.Fatalf("proxy=%d location=%s calls=%d body=%s", w.Code, w.Header().Get("Location"), calls, w.Body.String())
	}
	for _, cookie := range w.Result().Cookies() {
		if !strings.HasPrefix(cookie.Name, namespace) || !cookie.Secure || cookie.Domain != "" || cookie.Path != "/" {
			t.Fatalf("unsafe provider cookie: %s", cookie)
		}
	}
	if len(w.Result().Cookies()) != 2 {
		t.Fatal("provider session/language cookies were lost or branding caches escaped")
	}
	var headerBytes int
	for name, values := range w.Header() {
		for _, value := range values {
			headerBytes += len(name) + len(value) + 4
		}
	}
	if headerBytes > 1024 {
		t.Fatalf("provider headers still contain presentation payloads: %d bytes", headerBytes)
	}
	w = browserRequest(h, "POST", tailProvider, prefix+"provider/api/login", cookies, map[string]string{"Origin": "https://node.tail.test:8000"})
	if w.Code != 403 || calls != 1 {
		t.Fatal("sibling-port origin reached the provider")
	}
	w = browserRequest(h, "GET", lanApp, prefix+"provider/api/login", nil, nil)
	if w.Code != 404 || calls != 1 {
		t.Fatal("app host exposed the provider proxy")
	}
}

func mustURL(t *testing.T, raw string) *url.URL {
	t.Helper()
	u, err := url.Parse(raw)
	if err != nil {
		t.Fatal(err)
	}
	return u
}

func TestProviderProxyDoesNotFollowUpstreamRedirects(t *testing.T) {
	// Redirects belong to the browser. The server must not fetch arbitrary
	// destinations from an upstream Location header.
	var redirected bool
	sink := httptest.NewServer(http.HandlerFunc(func(http.ResponseWriter, *http.Request) { redirected = true }))
	defer sink.Close()
	upstream := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) { http.Redirect(w, r, sink.URL, 302) }))
	defer upstream.Close()
	s := &Service{config: Config{Issuer: upstream.URL, ClientID: "waypoint"}, client: &http.Client{Transport: http.DefaultTransport}, browsers: map[string]browserEndpoint{"app.test": {app: lanApp, provider: tailProvider}}}
	s.browserProviders = s.browserProviderHandlers()
	w := browserRequest(http.HandlerFunc(s.serveBrowserProvider), "GET", tailProvider, prefix+"provider/test", nil, nil)
	if w.Code != 302 || redirected {
		t.Fatal("proxy followed a redirect")
	}
}

func TestBrowserProviderProxyHasNoApplicationSession(t *testing.T) {
	p := newIDP(t)
	s := newService(t, p, filepath.Join(t.TempDir(), "sessions.db"), multipleBrowsers(p))
	h := s.Wrap(http.NotFoundHandler())
	w := browserRequest(h, "GET", tailProvider, prefix+"provider/.well-known/openid-configuration", nil, nil)
	if w.Code != 200 || !strings.Contains(w.Body.String(), p.server.URL) || len(w.Result().Cookies()) != 0 {
		t.Fatalf("discovery proxy=%d %s", w.Code, w.Body.String())
	}
	var count int
	if err := s.store.(*sqlite.Database).SQL().QueryRowContext(context.Background(), "SELECT COUNT(*) FROM sessions").Scan(&count); err != nil || count != 0 {
		t.Fatal("provider proxy created an application session")
	}
	_, _ = io.Copy(io.Discard, w.Result().Body)
}

type providerTransportFunc func(*http.Request) (*http.Response, error)

func (f providerTransportFunc) RoundTrip(r *http.Request) (*http.Response, error) { return f(r) }

func TestProviderProxyBoundsRequestsAndCancelsHangingUpstreams(t *testing.T) {
	p := newIDP(t)
	s := newService(t, p, filepath.Join(t.TempDir(), "sessions.db"), multipleBrowsers(p))
	s.client.Transport = providerTransportFunc(func(r *http.Request) (*http.Response, error) {
		deadline, ok := r.Context().Deadline()
		if !ok || time.Until(deadline) > time.Minute {
			t.Error("provider request has no bounded deadline")
		}
		return nil, context.DeadlineExceeded
	})
	s.browserProviders = s.browserProviderHandlers()
	w := browserRequest(http.HandlerFunc(s.serveBrowserProvider), "GET", tailProvider, prefix+"provider/test", nil, nil)
	if w.Code != 502 {
		t.Fatalf("provider deadline=%d", w.Code)
	}
	s.client.Transport = providerTransportFunc(func(r *http.Request) (*http.Response, error) {
		<-r.Context().Done()
		return nil, r.Context().Err()
	})
	s.browserProviders = s.browserProviderHandlers()
	ctx, cancel := context.WithTimeout(context.Background(), 20*time.Millisecond)
	defer cancel()
	r := httptest.NewRequest("GET", tailProvider+prefix+"provider/test", nil).WithContext(ctx)
	w = httptest.NewRecorder()
	start := time.Now()
	s.serveBrowserProvider(w, r)
	if w.Code != 502 || time.Since(start) > time.Second {
		t.Fatal("hanging provider did not observe the request deadline")
	}
}
