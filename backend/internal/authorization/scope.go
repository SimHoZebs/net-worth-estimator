// Package authorization evaluates application-owned policies with Go Casbin.
// Each decision reads persisted policy without a positive decision cache.
//
// User scope: a verified identity owns one user resource. The resource ID
// derives from the exact OIDC issuer and immutable subject, not the display
// name, username, or browser input. Action strings are user:*; resource values are
// users/<64hex>. Every identity, including the preprovisioned guest, uses
// the same users/<64hex> data path. Persistent assignments are enforced at request time.
package authorization

import (
	"crypto/sha256"
	"encoding/hex"
	"strings"
)

const (
	Read    = "user:read"
	Project = "user:project"
	Write   = "user:write"
)

type Resource struct {
	ID    string `json:"id"`
	Owner string `json:"-"`
}

type Scope struct {
	Resource    Resource `json:"resource"`
	Permissions []string `json:"permissions"`
}

func (s Scope) Allows(action string) bool {
	for _, permission := range s.Permissions {
		if permission == action {
			return true
		}
	}
	return false
}

// ActorKey uses the exact verified OIDC issuer and immutable subject, not a
// display name or a mutable username. An empty subject fails closed with an
// empty key; callers must supply the configured guest subject for anonymous
// requests instead of relying on a literal fallback.
func ActorKey(issuer, subject string) string {
	if subject == "" {
		return ""
	}
	hash := sha256.Sum256([]byte(issuer + "\x00" + subject))
	return "user:" + hex.EncodeToString(hash[:])
}

// ResourceFor derives routing metadata exclusively from a verified identity.
// Every identity uses users/<opaque-id>. An empty subject fails closed with
// an invalid resource. Callers must never decode Resource.Owner from browser
// input.
func ResourceFor(issuer, subject string) Resource {
	if subject == "" {
		return Resource{}
	}
	actor := ActorKey(issuer, subject)
	if actor == "" {
		return Resource{}
	}
	return Resource{ID: "users/" + strings.TrimPrefix(actor, "user:"), Owner: actor}
}

func (r Resource) valid() bool {
	if len(r.Owner) != len("user:")+64 || !strings.HasPrefix(r.Owner, "user:") {
		return false
	}
	hash := strings.TrimPrefix(r.Owner, "user:")
	decoded, err := hex.DecodeString(hash)
	if err != nil || hex.EncodeToString(decoded) != hash {
		return false
	}
	return r.ID == "users/"+hash
}
