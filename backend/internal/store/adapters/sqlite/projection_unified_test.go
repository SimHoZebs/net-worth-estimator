package sqlite

import (
	"testing"

	"github.com/simhozebs/net-worth-estimator/backend/internal/types"
)

func newProjectionSlice(fromAt, toAt string, builtRevision int64) types.ProjectionSlice {
	return types.ProjectionSlice{ProjectionStateID: "default", FromAt: fromAt, ToAt: toAt, BuiltRevision: builtRevision, Status: "ready"}
}

func TestProjectionStateIsolation(t *testing.T) {
	d := openSharedTestDatabase(t)
	a := privateTestPlan(t, d, "alpha")
	b := privateTestPlan(t, d, "beta")

	if _, err := a.MarkProjectionDirty("2026-05-01"); err != nil {
		t.Fatalf("mark dirty alpha: %v", err)
	}
	bState, err := b.GetProjectionState()
	if err != nil {
		t.Fatalf("read beta state: %v", err)
	}
	if bState.DirtyFrom != "" {
		t.Fatalf("dirty mark leaked across users: %q", bState.DirtyFrom)
	}

	aSlice, err := a.SaveProjectionSlice(newProjectionSlice("2026-01-01", "2026-07-01", 1))
	if err != nil {
		t.Fatalf("save alpha slice: %v", err)
	}
	if _, err := b.SaveProjectionSlice(newProjectionSlice("2026-01-01", "2026-07-01", 1)); err != nil {
		t.Fatalf("save beta slice: %v", err)
	}
	if err := a.DeleteProjectionSlicesFrom("2026-05-01"); err != nil {
		t.Fatalf("delete alpha suffix: %v", err)
	}
	bSlices, err := b.ListProjectionSlices()
	if err != nil {
		t.Fatalf("list beta slices: %v", err)
	}
	if len(bSlices) != 1 {
		t.Fatalf("suffix delete leaked across users: %d slices", len(bSlices))
	}
	_ = aSlice
}

func TestProjectionDirtyAndPublish(t *testing.T) {
	d := openSharedTestDatabase(t)
	s := privateTestPlan(t, d, "gamma")

	first, err := s.MarkProjectionDirty("2026-05-01")
	if err != nil {
		t.Fatalf("mark dirty: %v", err)
	}
	second, err := s.MarkProjectionDirty("2026-03-01")
	if err != nil {
		t.Fatalf("mark earlier dirty: %v", err)
	}
	if second.DirtyFrom != "2026-03-01" {
		t.Fatalf("dirty should keep earliest date, got %q", second.DirtyFrom)
	}
	if second.Revision != first.Revision+1 {
		t.Fatalf("revision should increment, got %d then %d", first.Revision, second.Revision)
	}
	published, err := s.PublishProjection(second.Revision)
	if err != nil {
		t.Fatalf("publish: %v", err)
	}
	if published.DirtyFrom != "" || published.PublishedRevision != second.Revision {
		t.Fatalf("publish should clear dirty and advance, got %+v", published)
	}
}
