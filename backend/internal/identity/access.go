package identity

import (
	"context"
	"errors"
	"net/http"

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

func (s *Service) resolveAccess(ctx context.Context, p Principal) (authorization.Scope, error) {
	if s.config.ResolveAccess == nil {
		return authorization.Scope{}, errors.New("resource permissions are not configured")
	}
	return s.config.ResolveAccess(ctx, p.Subject)
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
