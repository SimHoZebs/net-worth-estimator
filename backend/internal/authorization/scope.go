// Package authorization obtains plan permissions from Casdoor's built-in Casbin API.
// It never evaluates or caches authorization policies in the application process.
package authorization

import (
	"crypto/sha256"
	"encoding/hex"
	"strings"
)

const (
	Read    = "plan:read"
	Project = "plan:project"
	Write   = "plan:write"
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
// Callers must never decode Resource.Owner from browser input.
func ResourceFor(issuer, subject string) Resource {
	if subject == "" {
		return Resource{ID: "plans/sample", Kind: "sample"}
	}
	actor := ActorKey(issuer, subject)
	return Resource{ID: "plans/" + strings.TrimPrefix(actor, "user:"), Kind: "private", Owner: actor}
}

func (r Resource) valid() bool {
	if r.Kind == "sample" {
		return r.ID == "plans/sample" && r.Owner == ""
	}
	if r.Kind != "private" || len(r.Owner) != len("user:")+64 || !strings.HasPrefix(r.Owner, "user:") {
		return false
	}
	hash := strings.TrimPrefix(r.Owner, "user:")
	decoded, err := hex.DecodeString(hash)
	return err == nil && hex.EncodeToString(decoded) == hash && r.ID == "plans/"+hash
}
