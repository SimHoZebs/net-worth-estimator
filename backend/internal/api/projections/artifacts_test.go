package projections

import (
	"testing"

	"github.com/simhozebs/net-worth-estimator/backend/internal/types"
)

func TestPurchaseEvaluationSettingsHaveSeparateArtifactIdentity(t *testing.T) {
	settings := types.ProjectionRuntimeSettings{FallbackProjectionStartDate: "2026-02-01", HorizonYears: 1}
	base := artifactKey("deterministic", projectionSettingsDescriptor(settings))
	settings.Evaluations.PlannedPurchases = []types.EvaluationInstance[types.JsonValue]{{InstanceID: "purchases", Enabled: true, Config: map[string]any{}}}
	evaluated := artifactKey("deterministic", projectionSettingsDescriptor(settings))
	if base == evaluated {
		t.Fatal("purchase analysis reused baseline artifact")
	}
	settings.Evaluations.PlannedPurchases[0].Enabled = false
	if artifactKey("deterministic", projectionSettingsDescriptor(settings)) != base {
		t.Fatal("disabled analysis changed computation identity")
	}
}

func TestArtifactIdentityPreservesStoredResultKeys(t *testing.T) {
	// Pin the existing envelope. The transaction rename intentionally
	// orphans pre-rename stored results, so this pins the post-rename key.
	const want = "deterministic:7:f13edc334395707851cf7215943794d5ad0db43737986cf2d7c0c1ebf2b23bdf"
	if got := artifactKey("deterministic", map[string]any{"example": "identity"}); got != want {
		t.Fatalf("result identity = %q, want %q", got, want)
	}
}

func TestProjectionArtifactsAreScopedToPlanResources(t *testing.T) {
	request := map[string]any{"document": "same input", "seed": 42}
	a := &handler{resourceID: "users/a"}
	b := &handler{resourceID: "users/b"}
	for _, kind := range []string{"deterministic", "stochastic"} {
		if a.resourceArtifactKey(kind, request) == b.resourceArtifactKey(kind, request) {
			t.Fatalf("%s projections share a cross-account result or in-flight key", kind)
		}
		if a.resourceArtifactKey(kind, request) != a.resourceArtifactKey(kind, request) {
			t.Fatalf("%s same-account key is not stable", kind)
		}
		if (&handler{}).resourceArtifactKey(kind, request) != artifactKey(kind, request) {
			t.Fatalf("%s legacy artifact identity changed", kind)
		}
	}
}
