package projections

import (
	"testing"

	"github.com/simhozebs/net-worth-estimator/backend/internal/api/apitest"
	"github.com/simhozebs/net-worth-estimator/backend/internal/types"
)

func TestUnifiedEngineVersionBumpsExistingState(t *testing.T) {
	store := apitest.OpenStore(t)
	handler := &handler{store: store, resourceID: t.Name()}
	state, err := store.GetProjectionState()
	if err != nil {
		t.Fatal(err)
	}
	state.EngineVersion = "v1"
	state.ProjectionStart = "2026-01-01"
	state.HorizonEnd = "2027-01-01"
	state.Revision = 7
	state.DirtyFrom = 0
	if _, err := store.SaveProjectionState(state); err != nil {
		t.Fatal(err)
	}
	state, canonical, err := handler.ensureCanonicalState(&types.ProjectionRuntimeSettings{
		FallbackProjectionStartDate: "2026-01-01",
	})
	if err != nil {
		t.Fatal(err)
	}
	if canonical {
		t.Fatal("state migration must dirty the canonical projection")
	}
	if state.EngineVersion != unifiedEngineVersion {
		t.Fatalf("engine version = %q, want %q", state.EngineVersion, unifiedEngineVersion)
	}
	if state.Revision != 8 {
		t.Fatalf("revision = %d, want 8", state.Revision)
	}
	if state.DirtyFrom == 0 {
		t.Fatal("version migration must set a dirty date")
	}
}
