// Package authorization obtains user permissions from Casdoor's built-in Casbin API.
// It never evaluates or caches authorization policies in the application process.
//
// User scope: a verified identity owns one user resource. The resource ID
// derives from the exact OIDC issuer and immutable subject, not the display
// name, username, or browser input. Action strings are user:* under the
// Casdoor model waypoint/user-access; permission resource values are
// users/*, including the global read-only users/sample row.
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
	Kind  string `json:"kind"`
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
// display name or a Casdoor username. An empty subject identifies the guest.
func ActorKey(issuer, subject string) string {
	if subject == "" {
		return "guest"
	}
	hash := sha256.Sum256([]byte(issuer + "\x00" + subject))
	return "user:" + hex.EncodeToString(hash[:])
}

// ResourceFor derives routing metadata exclusively from a verified identity.
// Private users use users/<opaque-id>; the guest uses the global
// read-only sample. Callers must never decode Resource.Owner from browser
// input.
func ResourceFor(issuer, subject string) Resource {
	if subject == "" {
		return Resource{ID: "users/sample", Kind: "sample"}
	}
	actor := ActorKey(issuer, subject)
	return Resource{ID: "users/" + strings.TrimPrefix(actor, "user:"), Kind: "private", Owner: actor}
}

func (r Resource) valid() bool {
	if r.Kind == "sample" {
		return r.ID == "users/sample" && r.Owner == ""
	}
	if r.Kind != "private" || len(r.Owner) != len("user:")+64 || !strings.HasPrefix(r.Owner, "user:") {
		return false
	}
	hash := strings.TrimPrefix(r.Owner, "user:")
	decoded, err := hex.DecodeString(hash)
	if err != nil || hex.EncodeToString(decoded) != hash {
		return false
	}
	return r.ID == "users/"+hash
}
