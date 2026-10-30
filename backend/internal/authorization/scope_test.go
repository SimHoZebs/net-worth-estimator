package authorization

import (
	"crypto/sha256"
	"encoding/hex"
	"encoding/json"
	"strings"
	"testing"
)

func TestActorAndResourceCanonicalization(t *testing.T) {
	seen := map[string]bool{}
	for _, pair := range [][2]string{
		{"https://id.example", "alice"},
		{"https://id.example/", "alice"},
		{"https://other.example", "alice"},
		{"https://id.example", "Alice"},
		{"https://id.example", "guest"},
		{"https://id.example", "sample"},
		{"https://id.example", "../sample"},
		{"https://id.example", "waypoint/user-owner"},
		{"https://id.example/a", "bc"},
		{"https://id.example/ab", "c"},
		{"https://id.example", "11111111-1111-1111-1111-111111111111"},
	} {
		actor := ActorKey(pair[0], pair[1])
		if actor == "" {
			t.Fatalf("empty actor for %q", pair[1])
		}
		hash := sha256.Sum256([]byte(pair[0] + "\x00" + pair[1]))
		if actor != "user:"+hex.EncodeToString(hash[:]) || seen[actor] {
			t.Fatalf("identity alias or unexpected actor: %s", actor)
		}
		seen[actor] = true
		resource := ResourceFor(pair[0], pair[1])
		if !resource.valid() || resource.Owner != actor || strings.Count(resource.ID, "/") != 1 {
			t.Fatalf("unsafe resource: %+v", resource)
		}
		if !strings.HasPrefix(resource.ID, "users/") {
			t.Fatalf("private resource must use the user namespace: %+v", resource)
		}
		data, err := json.Marshal(resource)
		if err != nil || strings.Contains(string(data), "owner") || strings.Contains(string(data), "user:") {
			t.Fatalf("internal owner leaked: %s, %v", data, err)
		}
	}
	if ActorKey("https://id.example", "") != "" || ResourceFor("https://id.example", "").valid() {
		t.Fatal("empty subject must fail closed, not derive a literal guest")
	}
}
