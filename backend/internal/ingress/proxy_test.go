package ingress

import (
	"net/http"
	"net/http/httptest"
	"strings"
	"testing"
)

const testSecret = "0123456789abcdef0123456789abcdef"

func TestProxyAuthenticatesAndNormalizesPublicOrigin(t *testing.T) {
	wrap, err := New(testSecret, []string{"https://app.test", "https://alias.test:8443"})
	if err != nil {
		t.Fatal(err)
	}
	for _, origin := range []string{"https://app.test", "https://alias.test:8443"} {
		t.Run(origin, func(t *testing.T) {
			r := httptest.NewRequest("POST", "http://internal.test/v1/accounts?keep=yes", strings.NewReader("payload"))
			r.Header.Set(SecretHeader, testSecret)
			r.Header.Set(OriginHeader, origin)
			r.Header.Set("Origin", origin)
			r.Header.Set("Forwarded", "host=attacker.test;proto=http")
			r.Header.Set("X-Forwarded-Host", "attacker.test, internal.test")
			r.Header.Set("X-Forwarded-Proto", "http, https")
			called := false
			wrap(http.HandlerFunc(func(w http.ResponseWriter, got *http.Request) {
				called = true
				if got.URL.Scheme+"://"+got.Host != origin || got.URL.Host != got.Host || got.URL.RequestURI() != "/v1/accounts?keep=yes" {
					t.Fatalf("wrong public request: host=%s url=%s", got.Host, got.URL)
				}
				if got.Header.Get("Origin") != origin || got.Header.Get("X-Forwarded-Host") != got.Host || got.Header.Get("X-Forwarded-Proto") != "https" {
					t.Fatal("browser origin changed or forwarded headers remained untrusted")
				}
				for _, header := range []string{SecretHeader, OriginHeader, "Forwarded"} {
					if got.Header.Get(header) != "" {
						t.Errorf("ingress header %s reached the application", header)
					}
				}
				w.WriteHeader(http.StatusNoContent)
			})).ServeHTTP(httptest.NewRecorder(), r)
			if !called || r.Host != "internal.test" || r.Header.Get(SecretHeader) != testSecret {
				t.Fatal("request was rejected or the original request was mutated")
			}
		})
	}
}

func TestProxyRejectsBypassAndAmbiguousHeaders(t *testing.T) {
	wrap, err := New(testSecret, []string{"https://app.test"})
	if err != nil {
		t.Fatal(err)
	}
	for _, test := range []struct {
		name    string
		secrets []string
		origins []string
	}{
		{name: "direct backend"},
		{name: "wrong secret", secrets: []string{strings.Repeat("x", 32)}, origins: []string{"https://app.test"}},
		{name: "duplicate secret", secrets: []string{testSecret, testSecret}, origins: []string{"https://app.test"}},
		{name: "missing origin", secrets: []string{testSecret}},
		{name: "duplicate origin", secrets: []string{testSecret}, origins: []string{"https://app.test", "https://app.test"}},
		{name: "origin list", secrets: []string{testSecret}, origins: []string{"https://app.test, https://attacker.test"}},
		{name: "unknown origin", secrets: []string{testSecret}, origins: []string{"https://attacker.test"}},
		{name: "wrong scheme", secrets: []string{testSecret}, origins: []string{"http://app.test"}},
		{name: "origin path", secrets: []string{testSecret}, origins: []string{"https://app.test/v1"}},
	} {
		t.Run(test.name, func(t *testing.T) {
			r := httptest.NewRequest("GET", "https://app.test/v1/auth/login", nil)
			r.Header[SecretHeader] = test.secrets
			r.Header[OriginHeader] = test.origins
			r.Header.Set("X-Forwarded-Host", "app.test")
			w := httptest.NewRecorder()
			wrap(http.HandlerFunc(func(http.ResponseWriter, *http.Request) {
				t.Fatal("untrusted request reached the application")
			})).ServeHTTP(w, r)
			if w.Code != http.StatusForbidden || w.Header().Get("Cache-Control") != "no-store" || len(w.Result().Cookies()) != 0 {
				t.Fatalf("bypass response=%d %s", w.Code, w.Body.String())
			}
		})
	}
}

func TestDirectDeploymentDoesNotTrustIngressHeaders(t *testing.T) {
	wrap, err := New("", nil)
	if err != nil {
		t.Fatal(err)
	}
	r := httptest.NewRequest("GET", "http://internal.test/v1/auth/login", nil)
	r.Header.Set(SecretHeader, testSecret)
	r.Header.Set(OriginHeader, "https://app.test")
	wrap(http.HandlerFunc(func(_ http.ResponseWriter, got *http.Request) {
		if got != r || got.Host != "internal.test" {
			t.Fatal("disabled ingress changed the request")
		}
	})).ServeHTTP(httptest.NewRecorder(), r)
}

func TestProxyConfiguration(t *testing.T) {
	for _, secret := range []string{"short", strings.Repeat("x", 257), strings.Repeat("x", 32) + "\n", strings.Repeat(" ", 32)} {
		if _, err := New(secret, []string{"https://app.test"}); err == nil {
			t.Fatal("accepted an unsafe proxy secret")
		}
	}
	for _, origin := range []string{"", "/relative", "ftp://app.test", "https://app.test/path", "https://user:pass@app.test", "https://app.test?x=1", "https://app.test#fragment"} {
		if _, err := New(testSecret, []string{origin}); err == nil {
			t.Errorf("accepted noncanonical origin %q", origin)
		}
	}
	if _, err := New(testSecret, nil); err == nil {
		t.Fatal("accepted an empty public-origin allowlist")
	}
}
