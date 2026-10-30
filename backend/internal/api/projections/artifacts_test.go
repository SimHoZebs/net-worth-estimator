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

func TestExactCutChangesArtifactIdentity(t *testing.T) {
	plain := projectionSettingsDescriptor(types.ProjectionRuntimeSettings{FallbackProjectionStartDate: "2026-03-10", HorizonYears: 1})
	instant := int64(1773133200)
	exact := projectionSettingsDescriptor(types.ProjectionRuntimeSettings{FallbackProjectionStartDate: "2026-03-10", HorizonYears: 1, AsOfInstant: &instant})
	if artifactKey("deterministic", plain) == artifactKey("deterministic", exact) {
		t.Fatal("exact cut must change the artifact identity")
	}
}

func TestArtifactIdentityPreservesStoredResultKeys(t *testing.T) {
	// Standalone purchases expose purchaseId instead of postingId. Pin the
	// new envelope so old payloads cannot survive the contract change.
	const want = "deterministic:9:596ee79a5b8b67317f3f55ea0b72244f416ddab28c8511774831daaceb5c3d6d"
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
