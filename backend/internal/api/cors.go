package api

import (
	"net/http"
	"strings"
)

const (
	corsAllowedHeaders = "Content-Type"
	corsAllowedMethods = "GET, POST, PUT, OPTIONS"
)

var allowedCORSMethods = map[string]struct{}{
	http.MethodGet:     {},
	http.MethodPost:    {},
	http.MethodPut:     {},
	http.MethodOptions: {},
}

func corsMiddleware(allowedOrigins []string) func(http.Handler) http.Handler {
	origins := make(map[string]struct{}, len(allowedOrigins))
	for _, origin := range allowedOrigins {
		origins[origin] = struct{}{}
	}

	return func(next http.Handler) http.Handler {
		return http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
			w.Header().Add("Vary", "Origin")
			origin := r.Header.Get("Origin")
			if origin == "" {
				next.ServeHTTP(w, r)
				return
			}

			if _, allowed := origins[origin]; !allowed {
				http.Error(w, "origin is not allowed", http.StatusForbidden)
				return
			}
			w.Header().Set("Access-Control-Allow-Origin", origin)

			requestedMethod := r.Header.Get("Access-Control-Request-Method")
			if r.Method != http.MethodOptions || requestedMethod == "" {
				next.ServeHTTP(w, r)
				return
			}

			w.Header().Add("Vary", "Access-Control-Request-Method")
			w.Header().Add("Vary", "Access-Control-Request-Headers")
			if _, allowed := allowedCORSMethods[strings.ToUpper(requestedMethod)]; !allowed {
				http.Error(w, "CORS method is not allowed", http.StatusForbidden)
				return
			}
			if !corsHeadersAllowed(r.Header.Get("Access-Control-Request-Headers")) {
				http.Error(w, "CORS header is not allowed", http.StatusForbidden)
				return
			}

			w.Header().Set("Access-Control-Allow-Methods", corsAllowedMethods)
			w.Header().Set("Access-Control-Allow-Headers", corsAllowedHeaders)
			w.Header().Set("Access-Control-Max-Age", "600")
			w.WriteHeader(http.StatusNoContent)
		})
	}
}

func corsHeadersAllowed(value string) bool {
	for header := range strings.SplitSeq(value, ",") {
		if trimmed := strings.TrimSpace(header); trimmed != "" && !strings.EqualFold(trimmed, "Content-Type") {
			return false
		}
	}
	return true
}
