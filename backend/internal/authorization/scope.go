// Package authorization obtains account permissions from Casdoor's built-in Casbin API.
// It never evaluates or caches authorization policies in the application process.
//
// Account scope: a verified identity owns one account resource. The resource ID
// derives from the exact OIDC issuer and immutable subject, not the display
// name, username, or browser input. Action strings stay plan:* so the Casdoor
// model (waypoint/plan-access) needs no migration; only permission resource
// values change from plans/* to accounts/*. The guest sample stays the global
// read-only plans/sample row until the feat/account-scope-store DB rekey moves
// it to account storage.
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
// Private accounts use accounts/<opaque-id>; the guest uses the global
// read-only sample. Callers must never decode Resource.Owner from browser
// input.
//
// Casdoor migration: permission resources must cover accounts/* (seed includes
// legacy plans/* until the feat/account-scope-store DB rekey lands and old
// rows migrate). Action strings are unchanged.
func ResourceFor(issuer, subject string) Resource {
	if subject == "" {
		return Resource{ID: "plans/sample", Kind: "sample"}
	}
	actor := ActorKey(issuer, subject)
	return Resource{ID: "accounts/" + strings.TrimPrefix(actor, "user:"), Kind: "private", Owner: actor}
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
	if err != nil || hex.EncodeToString(decoded) != hash {
		return false
	}
	// Legacy plans/<hash> stays valid until the store rekey migrates old
	// rows to accounts/<hash>. ResourceFor never returns the legacy form.
	return r.ID == "accounts/"+hash || r.ID == "plans/"+hash
}
