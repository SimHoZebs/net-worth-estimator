package authorization

import (
	"encoding/json"
	"strings"
	"testing"
)

func TestActorAndResourceCanonicalization(t *testing.T) {
	const issuer = "https://id.example"
	seen := map[string]bool{}
	for _, pair := range [][2]string{
		{issuer, "alice"},
		{issuer + "/", "alice"},
		{"https://other.example", "alice"},
		{issuer, "Alice"},
		{issuer, "guest"},
		{issuer, "sample"},
		{issuer, "../sample"},
		{issuer, "waypoint/user-owner"},
		{issuer + "/a", "bc"},
		{issuer + "/ab", "c"},
		{issuer, "11111111-1111-1111-1111-111111111111"},
	} {
		actor := ActorKey(pair[0], pair[1])
		if actor == "" {
			t.Fatalf("empty actor for %q", pair[1])
		}
		if again := ActorKey(pair[0], pair[1]); again != actor {
			t.Fatalf("actor for %q/%q is not stable", pair[0], pair[1])
		}
		if seen[actor] {
			t.Fatalf("identity collision on actor %q for %q/%q", actor, pair[0], pair[1])
		}
		seen[actor] = true

		resource := ResourceFor(pair[0], pair[1])
		if !resource.valid() || resource.Owner != actor || strings.Count(resource.ID, "/") != 1 {
			t.Fatalf("unsafe resource: %+v", resource)
		}
		if !strings.HasPrefix(resource.ID, "users/") {
			t.Fatalf("private resource must use the user namespace: %+v", resource)
		}
		if resource.ID != "users/"+strings.TrimPrefix(actor, "user:") {
			t.Fatalf("resource %q does not derive from actor %q", resource.ID, actor)
		}
		data, err := json.Marshal(resource)
		if err != nil || strings.Contains(string(data), "owner") || strings.Contains(string(data), "user:") {
			t.Fatalf("internal owner leaked: %s, %v", data, err)
		}
	}
	if ActorKey(issuer, "") != "" || ResourceFor(issuer, "").valid() {
		t.Fatal("empty subject must fail closed, not derive a literal guest")
	}
}
