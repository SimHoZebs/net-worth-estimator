package api

import (
	"crypto/tls"
	"net/http"
	"net/http/httptest"
	"slices"
	"testing"
)

const allowedTestOrigin = "https://app.example.com"

func TestCORSMiddlewareAllowsConfiguredOrigin(t *testing.T) {
	called := false
	handler := corsMiddleware([]string{allowedTestOrigin})(http.HandlerFunc(func(w http.ResponseWriter, _ *http.Request) {
		called = true
		if _, ok := w.(http.Flusher); !ok {
			t.Fatal("CORS middleware removed http.Flusher support")
		}
		w.WriteHeader(http.StatusOK)
	}))
	request := httptest.NewRequest(http.MethodGet, "https://server.example.com/v1/financial-model", nil)
	request.Header.Set("Origin", allowedTestOrigin)
	response := httptest.NewRecorder()

	handler.ServeHTTP(response, request)

	if !called || response.Code != http.StatusOK {
		t.Fatalf("allowed request: called = %t, status = %d", called, response.Code)
	}
	if origin := response.Header().Get("Access-Control-Allow-Origin"); origin != allowedTestOrigin {
		t.Fatalf("Access-Control-Allow-Origin = %q", origin)
	}
	if exposed := response.Header().Get("Access-Control-Expose-Headers"); exposed != corsExposedHeaders {
		t.Fatalf("Access-Control-Expose-Headers = %q", exposed)
	}
	if vary := response.Header().Values("Vary"); !slices.Contains(vary, "Origin") {
		t.Fatalf("Vary = %v", vary)
	}
}

func TestCORSMiddlewareAllowsSameOrigin(t *testing.T) {
	for _, method := range []string{http.MethodGet, http.MethodPost} {
		t.Run(method, func(t *testing.T) {
			called := false
			handler := corsMiddleware(nil)(http.HandlerFunc(func(w http.ResponseWriter, _ *http.Request) {
				called = true
				w.WriteHeader(http.StatusOK)
			}))
			request := httptest.NewRequest(method, "https://app.example.com/v1/financial-model", nil)
			request.Header.Set("Origin", "https://app.example.com")
			response := httptest.NewRecorder()

			handler.ServeHTTP(response, request)

			if !called || response.Code != http.StatusOK {
				t.Fatalf("same-origin request: called = %t, status = %d", called, response.Code)
			}
			if origin := response.Header().Get("Access-Control-Allow-Origin"); origin != "https://app.example.com" {
				t.Fatalf("Access-Control-Allow-Origin = %q", origin)
			}
		})
	}
}

func TestCORSMiddlewareUsesTLSForSameOrigin(t *testing.T) {
	called := false
	handler := corsMiddleware(nil)(http.HandlerFunc(func(http.ResponseWriter, *http.Request) {
		called = true
	}))
	request := httptest.NewRequest(http.MethodGet, "/v1/financial-model", nil)
	request.Host = "app.example.com"
	request.URL.Scheme = ""
	request.TLS = &tls.ConnectionState{}
	request.Header.Set("Origin", "https://app.example.com")
	response := httptest.NewRecorder()

	handler.ServeHTTP(response, request)

	if !called || response.Code != http.StatusOK {
		t.Fatalf("same-origin TLS request: called = %t, status = %d", called, response.Code)
	}
}

func TestCORSMiddlewareNormalizesDefaultPortsForSameOrigin(t *testing.T) {
	for _, test := range []struct {
		name    string
		origin  string
		host    string
		allowed bool
	}{
		{name: "https origin port", origin: "https://app.example.com:443", host: "app.example.com", allowed: true},
		{name: "https request port", origin: "https://app.example.com", host: "app.example.com:443", allowed: true},
		{name: "http origin port", origin: "http://app.example.com:80", host: "app.example.com", allowed: true},
		{name: "http request port", origin: "http://app.example.com", host: "app.example.com:80", allowed: true},
		{name: "different port", origin: "https://app.example.com:8443", host: "app.example.com", allowed: false},
	} {
		t.Run(test.name, func(t *testing.T) {
			called := false
			handler := corsMiddleware(nil)(http.HandlerFunc(func(http.ResponseWriter, *http.Request) {
				called = true
			}))
			request := httptest.NewRequest(http.MethodGet, test.origin+"/v1/financial-model", nil)
			request.Host = test.host
			request.Header.Set("Origin", test.origin)
			response := httptest.NewRecorder()

			handler.ServeHTTP(response, request)

			if test.allowed {
				if !called || response.Code != http.StatusOK {
					t.Fatalf("allowed request: called = %t, status = %d", called, response.Code)
				}
				if origin := response.Header().Get("Access-Control-Allow-Origin"); origin != test.origin {
					t.Fatalf("Access-Control-Allow-Origin = %q", origin)
				}
				return
			}
			if called || response.Code != http.StatusForbidden {
				t.Fatalf("rejected request: called = %t, status = %d", called, response.Code)
			}
		})
	}
}

func TestCORSMiddlewareRejectsSameHostWithDifferentScheme(t *testing.T) {
	for _, test := range []struct {
		name   string
		target string
		origin string
	}{
		{name: "http request with https origin", target: "http://app.example.com/v1/financial-model", origin: "https://app.example.com"},
		{name: "https request with http origin", target: "https://app.example.com/v1/financial-model", origin: "http://app.example.com"},
	} {
		t.Run(test.name, func(t *testing.T) {
			called := false
			handler := corsMiddleware(nil)(http.HandlerFunc(func(http.ResponseWriter, *http.Request) {
				called = true
			}))
			request := httptest.NewRequest(http.MethodGet, test.target, nil)
			request.Host = "app.example.com"
			request.Header.Set("Origin", test.origin)
			response := httptest.NewRecorder()

			handler.ServeHTTP(response, request)

			if called || response.Code != http.StatusForbidden {
				t.Fatalf("rejected request: called = %t, status = %d", called, response.Code)
			}
		})
	}
}

func TestCORSMiddlewareUsesValidForwardedProtocolForSameOrigin(t *testing.T) {
	for _, test := range []struct {
		name               string
		forwardedProtocols []string
		origin             string
		allowed            bool
	}{
		{name: "https", forwardedProtocols: []string{"https"}, origin: "https://app.example.com", allowed: true},
		{name: "http", forwardedProtocols: []string{"http"}, origin: "http://app.example.com", allowed: true},
		{name: "multiple values", forwardedProtocols: []string{"https", "http"}, origin: "https://app.example.com", allowed: false},
		{name: "comma separated values", forwardedProtocols: []string{"https, http"}, origin: "https://app.example.com", allowed: false},
		{name: "invalid value", forwardedProtocols: []string{"ftp"}, origin: "https://app.example.com", allowed: false},
	} {
		t.Run(test.name, func(t *testing.T) {
			called := false
			handler := corsMiddleware(nil)(http.HandlerFunc(func(http.ResponseWriter, *http.Request) {
				called = true
			}))
			request := httptest.NewRequest(http.MethodGet, "/v1/financial-model", nil)
			request.Host = "app.example.com"
			request.URL.Scheme = ""
			request.TLS = nil
			for _, protocol := range test.forwardedProtocols {
				request.Header.Add("X-Forwarded-Proto", protocol)
			}
			request.Header.Set("Origin", test.origin)
			response := httptest.NewRecorder()

			handler.ServeHTTP(response, request)

			if test.allowed {
				if !called || response.Code != http.StatusOK {
					t.Fatalf("allowed request: called = %t, status = %d", called, response.Code)
				}
				return
			}
			if called || response.Code != http.StatusForbidden {
				t.Fatalf("rejected request: called = %t, status = %d", called, response.Code)
			}
		})
	}
}

func TestCORSMiddlewareUsesForwardedHostForSameOrigin(t *testing.T) {
	called := false
	handler := corsMiddleware(nil)(http.HandlerFunc(func(http.ResponseWriter, *http.Request) {
		called = true
	}))
	request := httptest.NewRequest(http.MethodGet, "/assets/app.css", nil)
	request.Host = "127.0.0.1:8787"
	request.URL.Scheme = ""
	request.TLS = nil
	request.Header.Set("X-Forwarded-Host", "app.example.com")
	request.Header.Set("X-Forwarded-Proto", "https")
	request.Header.Set("Origin", "https://app.example.com")
	response := httptest.NewRecorder()

	handler.ServeHTTP(response, request)

	if !called || response.Code != http.StatusOK {
		t.Fatalf("forwarded-host request: called = %t, status = %d", called, response.Code)
	}
}

func TestCORSMiddlewareRejectsAmbiguousForwardedHost(t *testing.T) {
	called := false
	handler := corsMiddleware(nil)(http.HandlerFunc(func(http.ResponseWriter, *http.Request) {
		called = true
	}))
	request := httptest.NewRequest(http.MethodGet, "/assets/app.css", nil)
	request.Host = "127.0.0.1:8787"
	request.Header.Add("X-Forwarded-Host", "app.example.com")
	request.Header.Add("X-Forwarded-Host", "other.example.com")
	request.Header.Set("X-Forwarded-Proto", "https")
	request.Header.Set("Origin", "https://app.example.com")
	response := httptest.NewRecorder()

	handler.ServeHTTP(response, request)

	if called || response.Code != http.StatusForbidden {
		t.Fatalf("ambiguous forwarded-host request: called = %t, status = %d", called, response.Code)
	}
}

func TestCORSMiddlewareHandlesPreflight(t *testing.T) {
	handler := corsMiddleware([]string{allowedTestOrigin})(http.HandlerFunc(func(http.ResponseWriter, *http.Request) {
		t.Fatal("preflight reached the application handler")
	}))
	request := httptest.NewRequest(http.MethodOptions, "/v1/financial-model", nil)
	request.Header.Set("Origin", allowedTestOrigin)
	request.Header.Set("Access-Control-Request-Method", http.MethodPut)
	request.Header.Set("Access-Control-Request-Headers", "content-type, authorization")
	response := httptest.NewRecorder()

	handler.ServeHTTP(response, request)

	if response.Code != http.StatusNoContent {
		t.Fatalf("preflight status = %d, body %s", response.Code, response.Body.String())
	}
	if methods := response.Header().Get("Access-Control-Allow-Methods"); methods != corsAllowedMethods {
		t.Fatalf("Access-Control-Allow-Methods = %q", methods)
	}
	if headers := response.Header().Get("Access-Control-Allow-Headers"); headers != corsAllowedHeaders {
		t.Fatalf("Access-Control-Allow-Headers = %q", headers)
	}
	for _, expected := range []string{"Origin", "Access-Control-Request-Method", "Access-Control-Request-Headers"} {
		if vary := response.Header().Values("Vary"); !slices.Contains(vary, expected) {
			t.Fatalf("Vary = %v, missing %q", vary, expected)
		}
	}
}

func TestCORSMiddlewareRejectsUnconfiguredOrigin(t *testing.T) {
	called := false
	handler := corsMiddleware(nil)(http.HandlerFunc(func(http.ResponseWriter, *http.Request) {
		called = true
	}))
	request := httptest.NewRequest(http.MethodPost, "https://app.example.com/v1/financial-model", nil)
	request.Header.Set("Origin", "https://attacker.example.com")
	response := httptest.NewRecorder()

	handler.ServeHTTP(response, request)

	if called || response.Code != http.StatusForbidden {
		t.Fatalf("rejected request: called = %t, status = %d", called, response.Code)
	}
}

func TestCORSMiddlewareRejectsUnsupportedPreflight(t *testing.T) {
	for _, test := range []struct {
		name    string
		method  string
		headers string
	}{
		{name: "method", method: http.MethodDelete},
		{name: "header", method: http.MethodPost, headers: "X-Custom-Header"},
	} {
		t.Run(test.name, func(t *testing.T) {
			handler := corsMiddleware([]string{allowedTestOrigin})(http.HandlerFunc(func(http.ResponseWriter, *http.Request) {
				t.Fatal("rejected preflight reached the application handler")
			}))
			request := httptest.NewRequest(http.MethodOptions, "/v1/financial-model", nil)
			request.Header.Set("Origin", allowedTestOrigin)
			request.Header.Set("Access-Control-Request-Method", test.method)
			request.Header.Set("Access-Control-Request-Headers", test.headers)
			response := httptest.NewRecorder()

			handler.ServeHTTP(response, request)

			if response.Code != http.StatusForbidden {
				t.Fatalf("preflight status = %d, body %s", response.Code, response.Body.String())
			}
		})
	}
}

func TestCORSMiddlewareAllowsRequestsWithoutOrigin(t *testing.T) {
	called := false
	handler := corsMiddleware(nil)(http.HandlerFunc(func(w http.ResponseWriter, _ *http.Request) {
		called = true
		w.WriteHeader(http.StatusOK)
	}))
	response := httptest.NewRecorder()

	handler.ServeHTTP(response, httptest.NewRequest(http.MethodGet, "/healthz", nil))

	if !called || response.Code != http.StatusOK {
		t.Fatalf("request without Origin: called = %t, status = %d", called, response.Code)
	}
	if vary := response.Header().Values("Vary"); !slices.Contains(vary, "Origin") {
		t.Fatalf("Vary = %v", vary)
	}
}
