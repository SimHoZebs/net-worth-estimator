package api

import (
	"crypto/subtle"
	"encoding/json"
	"net/http"
)

// writeAuthMiddleware guards canonical model writes. Precedence: read-only
// rejects everything with 403 first; otherwise a missing or wrong bearer
// token is 401. When no token is configured (dev default) writes stay open.
// Reads and compute endpoints always pass through.
func writeAuthMiddleware(readOnly bool, token string) func(http.Handler) http.Handler {
	return func(next http.Handler) http.Handler {
		return http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
			if r.Method != http.MethodPut || r.URL.Path != "/v1/financial-model" {
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
