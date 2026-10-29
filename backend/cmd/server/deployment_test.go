package main

import (
	"net/http"
	"net/http/httptest"
	"path/filepath"
	"strings"
	"testing"

	"github.com/simhozebs/net-worth-estimator/backend/internal/identity"
	"github.com/simhozebs/net-worth-estimator/backend/internal/ingress"
	"github.com/simhozebs/net-worth-estimator/backend/internal/store/adapters/sqlite"
)

func TestDeploymentProbesRemainPublicAndReadinessChecksDatabase(t *testing.T) {
	database, err := sqlite.SetupDatabase(filepath.Join(t.TempDir(), "app.db"))
	if err != nil {
		t.Fatal(err)
	}
	t.Cleanup(func() { _ = database.Close() })
	const secret = "0123456789abcdef0123456789abcdef"
	handler, err := deploymentHandler(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		if r.Host != "app.test" {
			t.Errorf("unexpected public host %s", r.Host)
		}
		w.WriteHeader(http.StatusNoContent)
	}), database.SQL(), identity.Config{PublicURL: "https://app.test", Issuer: "https://identity.test"}, secret)
	if err != nil {
		t.Fatal(err)
	}
	request := func(method, path string, proxied bool) *httptest.ResponseRecorder {
		r := httptest.NewRequest(method, "http://internal.test"+path, nil)
		if proxied {
			r.Header.Set(ingress.SecretHeader, secret)
			r.Header.Set(ingress.OriginHeader, "https://app.test")
		}
		w := httptest.NewRecorder()
		handler.ServeHTTP(w, r)
		return w
	}
	for _, path := range []string{"/healthz", "/readyz"} {
		for _, method := range []string{"GET", "HEAD"} {
			w := request(method, path, false)
			if w.Code != http.StatusOK || w.Header().Get("Cache-Control") != "no-store" || len(w.Result().Cookies()) != 0 {
				t.Fatalf("probe %s %s = %d %s", method, path, w.Code, w.Body.String())
			}
			if method == "HEAD" && w.Body.Len() != 0 {
				t.Fatal("HEAD probe wrote a body")
			}
		}
		if w := request("POST", path, false); w.Code != http.StatusMethodNotAllowed || w.Header().Get("Allow") != "GET, HEAD" {
			t.Fatalf("probe accepted a write: %d", w.Code)
		}
	}
	for _, path := range []string{"/v1/auth/session", "/healthz/extra", "/readyz/extra", "/v1/auth/backchannel-logout"} {
		if w := request("GET", path, false); w.Code != http.StatusForbidden {
			t.Fatalf("untrusted %s bypassed ingress: %d", path, w.Code)
		}
	}
	if w := request("GET", "/v1/auth/session", true); w.Code != http.StatusNoContent {
		t.Fatalf("trusted request rejected: %d", w.Code)
	}
	if err := database.Close(); err != nil {
		t.Fatal(err)
	}
	if w := request("GET", "/healthz", false); w.Code != http.StatusOK {
		t.Fatal("database outage failed liveness")
	}
	if w := request("GET", "/readyz", false); w.Code != http.StatusServiceUnavailable || strings.Contains(w.Body.String(), "sql:") {
		t.Fatalf("readiness did not fail safely: %d %s", w.Code, w.Body.String())
	}
}

func TestDeploymentRejectsUnsafeIngressConfiguration(t *testing.T) {
	config := identity.Config{PublicURL: "https://app.test", Issuer: "https://identity.test"}
	if _, err := deploymentHandler(http.NotFoundHandler(), nil, config, "short"); err == nil {
		t.Fatal("accepted weak ingress secret")
	}
}
