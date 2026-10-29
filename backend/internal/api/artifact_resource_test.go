package api

import "testing"

func TestArtifactIdentityPreservesStoredResultKeys(t *testing.T) {
	// Pin the existing envelope so terminology changes do not orphan results.
	const want = "deterministic:6:5902232bedcf093519ff8ee025f87328f72f73c073ed8c3607da63745199e36e"
	if got := artifactKey("deterministic", map[string]any{"example": "identity"}); got != want {
		t.Fatalf("result identity = %q, want %q", got, want)
	}
}

func TestProjectionArtifactsAreScopedToPlanResources(t *testing.T) {
	request := map[string]any{"document": "same input", "seed": 42}
	a := &Server{ResourceID: "users/a"}
	b := &Server{ResourceID: "users/b"}
	for _, kind := range []string{"deterministic", "stochastic"} {
		if a.resourceArtifactKey(kind, request) == b.resourceArtifactKey(kind, request) {
			t.Fatalf("%s projections share a cross-account result or in-flight key", kind)
		}
		if a.resourceArtifactKey(kind, request) != a.resourceArtifactKey(kind, request) {
			t.Fatalf("%s same-account key is not stable", kind)
		}
		if (&Server{}).resourceArtifactKey(kind, request) != artifactKey(kind, request) {
			t.Fatalf("%s legacy artifact identity changed", kind)
		}
	}
}
