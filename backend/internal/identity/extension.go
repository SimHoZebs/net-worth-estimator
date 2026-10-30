package identity

import (
	"net/http"
	"regexp"
)

var chromiumExtensionOrigin = regexp.MustCompile(`^chrome-extension://[a-p]{32}$`)

// extensionRequest handles POSTs from privileged Chromium extension fetches.
// Host permission bypasses browser CORS, but these POSTs still carry Origin.
// Device codes or explicit bearer credentials authorize them, never cookies.
func (s *Service) extensionRequest(w http.ResponseWriter, r *http.Request, next http.Handler) bool {
	if !chromiumExtensionOrigin.MatchString(r.Header.Get("Origin")) {
		return false
	}
	w.Header().Set("Cache-Control", "no-store")
	device := r.URL.Path == prefix+"device/start" || r.URL.Path == prefix+"device/poll" || r.URL.Path == prefix+"device/refresh"
	if _, ok := s.browserEndpoint(r); !ok || r.Method != http.MethodPost || (!device && r.URL.Path != "/v1/planned-purchases") {
		failure(w, http.StatusForbidden, "This extension route is not available.")
		return true
	}
	if _, ok := bearerToken(r); !device && !ok {
		failure(w, http.StatusUnauthorized, "Connect the extension before accessing your data.")
		return true
	}
	clone := r.Clone(r.Context())
	clone.Header = r.Header.Clone()
	clone.Header.Del("Cookie")
	clone.Header.Del("Origin")
	// Preserve Fetch Metadata so Go's CSRF protection still rejects cross-site.
	next.ServeHTTP(w, clone)
	return true
}
