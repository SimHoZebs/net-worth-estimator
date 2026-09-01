package api

import (
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
	request := httptest.NewRequest(http.MethodGet, "/v1/financial-model", nil)
	request.Header.Set("Origin", allowedTestOrigin)
	response := httptest.NewRecorder()

	handler.ServeHTTP(response, request)

	if !called || response.Code != http.StatusOK {
		t.Fatalf("allowed request: called = %t, status = %d", called, response.Code)
	}
	if origin := response.Header().Get("Access-Control-Allow-Origin"); origin != allowedTestOrigin {
		t.Fatalf("Access-Control-Allow-Origin = %q", origin)
	}
	if vary := response.Header().Values("Vary"); !slices.Contains(vary, "Origin") {
		t.Fatalf("Vary = %v", vary)
	}
}

func TestCORSMiddlewareHandlesPreflight(t *testing.T) {
	handler := corsMiddleware([]string{allowedTestOrigin})(http.HandlerFunc(func(http.ResponseWriter, *http.Request) {
		t.Fatal("preflight reached the application handler")
	}))
	request := httptest.NewRequest(http.MethodOptions, "/v1/financial-model", nil)
	request.Header.Set("Origin", allowedTestOrigin)
	request.Header.Set("Access-Control-Request-Method", http.MethodPut)
	request.Header.Set("Access-Control-Request-Headers", "content-type")
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
	request := httptest.NewRequest(http.MethodPost, "/v1/financial-model/reset", nil)
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
		{name: "header", method: http.MethodPost, headers: "Authorization"},
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
