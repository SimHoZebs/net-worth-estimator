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
	} {
		actor := ActorKey(pair[0], pair[1])
		hash := sha256.Sum256([]byte(pair[0] + "\x00" + pair[1]))
		if actor != "user:"+hex.EncodeToString(hash[:]) || seen[actor] {
			t.Fatalf("identity alias or unexpected actor: %s", actor)
		}
		seen[actor] = true
		resource := ResourceFor(pair[0], pair[1])
		if !resource.valid() || resource.Owner != actor || strings.Count(resource.ID, "/") != 1 || resource.ID == "users/sample" {
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
	if ActorKey("https://id.example", "") != "guest" || !ResourceFor("https://id.example", "").valid() {
		t.Fatal("guest canonicalization failed")
	}
}

func TestLegacyPlanResourceIsRejected(t *testing.T) {
	const issuer = "https://id.example"
	current := ResourceFor(issuer, "alice")
	hash := strings.TrimPrefix(current.Owner, "user:")
	legacy := Resource{ID: "plans/" + hash, Kind: "private", Owner: current.Owner}
	if legacy.valid() {
		t.Fatalf("legacy plan resource accepted after cutover: %+v", legacy)
	}
	if ResourceFor(issuer, "alice").ID == legacy.ID {
		t.Fatal("ResourceFor must return the user namespace, not the legacy plan form")
	}
}
