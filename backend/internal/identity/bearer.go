package identity

import (
	"context"
	"errors"
	"net/http"
	"strings"
)

// bearerToken extracts a presented Bearer credential. Empty, malformed, or
// non-Bearer headers fall through to the session path so unknown schemes
// keep existing guest behavior.
func bearerToken(r *http.Request) (string, bool) {
	header := r.Header.Get("Authorization")
	if header == "" {
		return "", false
	}
	scheme, token, _ := strings.Cut(header, " ")
	if !strings.EqualFold(strings.TrimSpace(scheme), "bearer") {
		return "", false
	}
	token = strings.TrimSpace(token)
	if token == "" || strings.Contains(token, " ") {
		return "", false
	}
	return token, true
}

// bearerPrincipal validates a presented access token directly with the
// provider and returns its subject without creating a session. Inactive,
// revoked, or foreign tokens yield an empty principal (guest) so callers
// keep existing 401/403/409 behavior; provider outages are errors (503
// downstream). No grant is persisted: each request revalidates.
func (s *Service) bearerPrincipal(ctx context.Context, token string) (Principal, error) {
	result, err := s.postIntrospection(ctx, token)
	if err != nil {
		if errors.Is(err, errGrantRevoked) {
			return Principal{}, nil
		}
		return Principal{}, err
	}
	if result.Subject == "" || result.ClientID != s.config.ClientID || result.Issuer != s.config.Issuer || !audienceMatches(result.Audience, s.config.ClientID) {
		return Principal{}, nil
	}
	return Principal{Subject: result.Subject}, nil
}
