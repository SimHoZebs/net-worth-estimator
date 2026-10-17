package api

import (
	"crypto/subtle"
	"encoding/json"
	"net/http"
	"strings"
)

// writeAuthMiddleware guards canonical model writes and the SimpleFIN sync
// trigger. Precedence: read-only rejects everything with 403 first;
// otherwise a missing or wrong bearer token is 401. When no token is
// configured (dev default) guarded routes stay open. Reads and compute
// endpoints always pass through.
// New write routes must add a prefix here: the guard is a string table,
// not derived from route registration, so an unlisted route stays open.
func writeAuthMiddleware(readOnly bool, token string) func(http.Handler) http.Handler {
	guardedPrefixes := []string{
		http.MethodPost + " /v1/accounts",
		http.MethodPatch + " /v1/accounts/",
		http.MethodDelete + " /v1/accounts/",
		http.MethodPost + " /v1/postings",
		http.MethodPatch + " /v1/postings/",
		http.MethodDelete + " /v1/postings/",
		http.MethodPost + " /v1/recurrence-rules",
		http.MethodPatch + " /v1/recurrence-rules/",
		http.MethodDelete + " /v1/recurrence-rules/",
		http.MethodPost + " /v1/checkpoints",
		http.MethodDelete + " /v1/checkpoints",
		http.MethodPost + " /v1/evaluations",
		http.MethodPatch + " /v1/evaluations/",
		http.MethodDelete + " /v1/evaluations/",
		http.MethodPost + " /v1/payment-terms",
		http.MethodDelete + " /v1/payment-terms/",
		http.MethodPost + " /v1/sync/simplefin",
		http.MethodPut + " /v1/sync/simplefin/accounts/",
		http.MethodDelete + " /v1/sync/simplefin/accounts/",
	}
	isGuarded := func(method, requestPath string) bool {
		key := method + " " + requestPath
		for _, prefix := range guardedPrefixes {
			if key == prefix || strings.HasPrefix(key, prefix) {
				return true
			}
		}
		return false
	}
	return func(next http.Handler) http.Handler {
		return http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
			if !isGuarded(r.Method, r.URL.Path) {
				next.ServeHTTP(w, r)
				return
			}
			if readOnly {
				writeAPIError(w, http.StatusForbidden, "Forbidden", "server is read-only")
				return
			}
			if token == "" {
				next.ServeHTTP(w, r)
				return
			}
			if !validBearer(r.Header.Get("Authorization"), token) {
				writeAPIError(w, http.StatusUnauthorized, "Unauthorized", "valid bearer token required")
				return
			}
			next.ServeHTTP(w, r)
		})
	}
}

func validBearer(header, token string) bool {
	const scheme = "Bearer "
	if len(header) <= len(scheme) {
		return false
	}
	given, expected := []byte(header), []byte(scheme+token)
	if len(given) != len(expected) {
		return false
	}
	return subtle.ConstantTimeCompare(given, expected) == 1
}

// writeAPIError mirrors the huma error envelope so middleware rejections
// look like handler rejections.
func writeAPIError(w http.ResponseWriter, status int, title, detail string) {
	w.Header().Set("Content-Type", "application/problem+json")
	w.WriteHeader(status)
	_ = json.NewEncoder(w).Encode(map[string]any{
		"title":  title,
		"status": status,
		"detail": detail,
	})
}
