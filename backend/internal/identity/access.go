package identity

import (
	"context"
	"errors"
	"net/http"
	"strings"

	"github.com/simhozebs/net-worth-estimator/backend/internal/authorization"
)

const ResourceHeader = "Waypoint-Resource"

// WriteResourceChanged distinguishes a stale plan assertion from an operation conflict.
func WriteResourceChanged(w http.ResponseWriter) {
	failureWithCode(w, http.StatusConflict, "The active plan changed. Reload the session before this request.", "RESOURCE_CHANGED")
}

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

func Name(ctx context.Context) string {
	p, _ := ctx.Value(principalKey{}).(Principal)
	return p.Name
}

// PrincipalContext carries a verified principal. It is a test seam for
// handlers that read identity from context without a live session.
func PrincipalContext(ctx context.Context, p Principal) context.Context {
	return context.WithValue(ctx, principalKey{}, p)
}

func (s *Service) resolveAccess(ctx context.Context, p Principal) (authorization.Scope, error) {
	if s.config.ResolveAccess == nil {
		return authorization.Scope{}, errors.New("resource permissions are not configured")
	}
	return s.config.ResolveAccess(ctx, p.Subject)
}

// Every unknown state-changing route requires write permission by default.
func requestAction(r *http.Request) string {
	if r.Method == http.MethodPost && (r.URL.Path == "/v1/position" || r.URL.Path == "/v1/projections/deterministic" || r.URL.Path == "/v1/projections/stochastic") {
		return "plan:project"
	}
	if r.Method == http.MethodGet || r.Method == http.MethodHead || r.Method == http.MethodOptions {
		return "plan:read"
	}
	return "plan:write"
}

// IsGroupRoute reports social group routes, which need authentication
// only. Membership is enforced by the groups handler, not plan
// permissions. It matches exactly the routes the groups handler serves so
// no future plan route can hide inside the bypass.
func IsGroupRoute(path string) bool {
	return path == "/v1/groups" || strings.HasPrefix(path, "/v1/groups/") ||
		path == "/v1/invites/accept"
}

// isGroupRoute is the internal alias used by the request pipeline.
func isGroupRoute(path string) bool { return IsGroupRoute(path) }
