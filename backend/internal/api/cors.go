package api

import (
	"errors"
	"fmt"
	"net"
	"net/http"
	"net/url"
	"strconv"
	"strings"
)

const (
	corsAllowedHeaders = "Content-Type, Authorization"
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
		trimmed := strings.TrimSpace(header)
		if trimmed == "" {
			continue
		}
		if strings.EqualFold(trimmed, "Content-Type") || strings.EqualFold(trimmed, "Authorization") {
			continue
		}
		return false
	}
	return true
}

// ParseAllowedOrigins validates and normalizes a comma-separated origin
// allow-list. Kept with CORS enforcement: this is the validation half, the
// middleware above is the enforcement half.
func ParseAllowedOrigins(value string) ([]string, error) {
	if strings.TrimSpace(value) == "" {
		return nil, nil
	}

	origins := make([]string, 0)
	seen := make(map[string]struct{})
	for _, candidate := range strings.Split(value, ",") {
		candidate = strings.TrimSpace(candidate)
		if candidate == "" {
			return nil, errors.New("origin entries cannot be empty")
		}
		parsed, err := url.Parse(candidate)
		if err != nil {
			return nil, fmt.Errorf("parse origin %q: %w", candidate, err)
		}
		scheme := strings.ToLower(parsed.Scheme)
		if (scheme != "http" && scheme != "https") || parsed.Host == "" || parsed.User != nil || parsed.Opaque != "" {
			return nil, fmt.Errorf("origin %q must contain only an HTTP/S scheme and host", candidate)
		}
		if (parsed.Path != "" && parsed.Path != "/") || parsed.RawQuery != "" || parsed.ForceQuery || parsed.Fragment != "" {
			return nil, fmt.Errorf("origin %q cannot contain a path, query, or fragment", candidate)
		}

		host := strings.ToLower(parsed.Hostname())
		if host == "" {
			return nil, fmt.Errorf("origin %q must contain a host", candidate)
		}
		port := parsed.Port()
		if port != "" {
			parsedPort, err := strconv.Atoi(port)
			if err != nil || parsedPort < 1 || parsedPort > 65535 {
				return nil, fmt.Errorf("origin %q contains an invalid port", candidate)
			}
			port = strconv.Itoa(parsedPort)
		}
		if (scheme == "http" && port == "80") || (scheme == "https" && port == "443") {
			port = ""
		}
		if port != "" {
			host = net.JoinHostPort(host, port)
		} else if strings.Contains(host, ":") {
			host = "[" + host + "]"
		}
		origin := scheme + "://" + host
		if _, exists := seen[origin]; exists {
			continue
		}
		seen[origin] = struct{}{}
		origins = append(origins, origin)
	}
	return origins, nil
}
