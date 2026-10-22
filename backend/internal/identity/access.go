package identity

import (
	"context"
	"errors"
	"net/http"
	"slices"

	"github.com/simhozebs/net-worth-estimator/backend/internal/authorization"
)

const ResourceHeader = "X-Waypoint-Resource"

type scopeKey struct{}

// Scope is set only after identity verification and Casdoor authorization.
func Scope(ctx context.Context) (authorization.Scope, bool) {
	scope, ok := ctx.Value(scopeKey{}).(authorization.Scope)
	return scope, ok
}

func Subject(ctx context.Context) string {
	p, _ := ctx.Value(principalKey{}).(Principal)
	return p.Subject
}

func (s *Service) resolveAccess(ctx context.Context, p Principal) (authorization.Scope, Principal, error) {
	if s.config.ResolveAccess == nil {
		return authorization.Scope{}, p, errors.New("resource permissions are not configured")
	}
	scope, err := s.config.ResolveAccess(ctx, p.Subject)
	if err != nil {
		return authorization.Scope{}, p, err
	}
	p.Role = "viewer"
	if slices.Contains(scope.Permissions, "plan:write") {
		p.Role = "editor"
	}
	return scope, p, nil
}

// Every unknown state-changing route requires write permission by default.
func requestAction(r *http.Request) string {
	if r.Method == http.MethodPost && (r.URL.Path == "/v1/projections/deterministic" || r.URL.Path == "/v1/projections/stochastic") {
		return "plan:project"
	}
	if r.Method == http.MethodGet || r.Method == http.MethodHead || r.Method == http.MethodOptions {
		return "plan:read"
	}
	return "plan:write"
}
