// Package ingress adapts authenticated reverse-proxy requests before identity,
// CSRF, and API origin checks. It has no hosting-provider dependencies.
package ingress

import (
	"crypto/sha256"
	"crypto/subtle"
	"fmt"
	"net/http"
	"net/url"
	"regexp"

	"github.com/simhozebs/net-worth-estimator/backend/internal/api"
)

const (
	SecretHeader = "Waypoint-Proxy-Secret"
	OriginHeader = "Waypoint-Public-Origin"
)

var validSecret = regexp.MustCompile(`^[A-Za-z0-9_-]{32,256}$`)

// New returns an optional ingress boundary. With no secret, existing direct and
// Host-preserving deployments keep their current behavior. With a secret, every
// request must come through a proxy that replaces both ingress headers.
// Public origins come from the identity configuration, never forwarded headers.
// Origins are validated through the shared api.CanonicalOrigin checker so a
// trailing "/" normalizes identically and paths, userinfo, and trailing-dot
// hosts are rejected at every boundary.
func New(secret string, publicOrigins []string) (func(http.Handler) http.Handler, error) {
	if secret == "" {
		return func(next http.Handler) http.Handler { return next }, nil
	}
	if !validSecret.MatchString(secret) {
		return nil, fmt.Errorf("PROXY_SECRET must contain 32–256 URL-safe characters")
	}
	origins := make(map[string]*url.URL, len(publicOrigins))
	for _, origin := range publicOrigins {
		canonical, err := api.CanonicalOrigin(origin)
		if err != nil {
			return nil, fmt.Errorf("proxy public origins must be canonical HTTP/S origins: %w", err)
		}
		u, _ := url.Parse(canonical)
		origins[canonical] = u
	}
	if len(origins) == 0 {
		return nil, fmt.Errorf("proxy requires at least one configured public origin")
	}
	want := sha256.Sum256([]byte(secret))
	return func(next http.Handler) http.Handler {
		return http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
			secrets, originsHeader := r.Header.Values(SecretHeader), r.Header.Values(OriginHeader)
			var received string
			if len(secrets) == 1 {
				received = secrets[0]
			}
			got := sha256.Sum256([]byte(received))
			if subtle.ConstantTimeCompare(want[:], got[:]) != 1 {
				reject(w)
				return
			}
			var origin *url.URL
			if len(originsHeader) == 1 {
				if canonical, err := api.CanonicalOrigin(originsHeader[0]); err == nil {
					origin = origins[canonical]
				}
			}
			if origin == nil {
				reject(w)
				return
			}
			request := r.Clone(r.Context())
			request.Host = origin.Host
			request.URL.Host, request.URL.Scheme = origin.Host, origin.Scheme
			request.Header.Del(SecretHeader)
			request.Header.Del(OriginHeader)
			request.Header.Del("Forwarded")
			request.Header.Set("X-Forwarded-Host", origin.Host)
			request.Header.Set("X-Forwarded-Proto", origin.Scheme)
			next.ServeHTTP(w, request)
		})
	}, nil
}

func reject(w http.ResponseWriter) {
	w.Header().Set("Cache-Control", "no-store")
	http.Error(w, "The request did not come through a configured application proxy.", http.StatusForbidden)
}
