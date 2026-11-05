package sqlite

import (
	"testing"

	"github.com/simhozebs/net-worth-estimator/backend/internal/types"
)

func newProjectionSlice(fromAt, toAt string, builtRevision int64) types.ProjectionSlice {
	return types.ProjectionSlice{ProjectionStateID: "default", FromAt: dirtyDay(fromAt), ToAt: dirtyDay(toAt), BuiltRevision: builtRevision, Status: "ready"}
}

func TestProjectionStateIsolation(t *testing.T) {
	d := openSharedTestDatabase(t)
	a := privateTestPlan(t, d, "alpha")
	b := privateTestPlan(t, d, "beta")

	if _, err := a.MarkProjectionDirty(dirtyDay("2026-05-01")); err != nil {
		t.Fatalf("mark dirty alpha: %v", err)
	}
	bState, err := b.GetProjectionState()
	if err != nil {
		t.Fatalf("read beta state: %v", err)
	}
	if bState.DirtyFrom != 0 {
		t.Fatalf("dirty mark leaked across users: %d", bState.DirtyFrom)
	}

	aSlice, err := a.SaveProjectionSlice(newProjectionSlice("2026-01-01", "2026-07-01", 1))
	if err != nil {
		t.Fatalf("save alpha slice: %v", err)
	}
	if _, err := b.SaveProjectionSlice(newProjectionSlice("2026-01-01", "2026-07-01", 1)); err != nil {
		t.Fatalf("save beta slice: %v", err)
	}
	if err := a.DeleteProjectionSlicesFrom(dirtyDay("2026-05-01")); err != nil {
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

	first, err := s.MarkProjectionDirty(dirtyDay("2026-05-01"))
	if err != nil {
		t.Fatalf("mark dirty: %v", err)
	}
	second, err := s.MarkProjectionDirty(dirtyDay("2026-03-01"))
	if err != nil {
		t.Fatalf("mark earlier dirty: %v", err)
	}
	if second.DirtyFrom != dirtyDay("2026-03-01") {
		t.Fatalf("dirty should keep earliest date, got %d", second.DirtyFrom)
	}
	if second.Revision != first.Revision+1 {
		t.Fatalf("revision should increment, got %d then %d", first.Revision, second.Revision)
	}
	published, err := s.PublishProjection(second.Revision)
	if err != nil {
		t.Fatalf("publish: %v", err)
	}
	if published.DirtyFrom != 0 || published.PublishedRevision != second.Revision {
		t.Fatalf("publish should clear dirty and advance, got %+v", published)
	}
}

func TestRowWritesMarkDirty(t *testing.T) {
	d := openSharedTestDatabase(t)
	s := privateTestPlan(t, d, "dirty")
	if _, err := s.SaveProjectionState(types.ProjectionState{ID: "default", ScopeID: "dirty", ProjectionStart: "2026-01-01", HorizonEnd: "2056-01-01"}); err != nil {
		t.Fatalf("seed state: %v", err)
	}
	mustClean := func() {
		t.Helper()
		state, err := s.GetProjectionState()
		if err != nil {
			t.Fatal(err)
		}
		if _, err := s.PublishProjection(state.Revision); err != nil {
			t.Fatal(err)
		}
	}
	dirty := func() int64 {
		t.Helper()
		state, err := s.GetProjectionState()
		if err != nil {
			t.Fatal(err)
		}
		return state.DirtyFrom
	}

	account, err := s.CreateAccount(types.Account{ID: "checking", Name: "Checking"})
	if err != nil {
		t.Fatalf("create account: %v", err)
	}
	if got := dirty(); got != 0 {
		t.Fatalf("empty create must not dirty, got %d", got)
	}
	renamed := account
	renamed.Name = "Renamed"
	if _, err := s.UpdateAccount(renamed); err != nil {
		t.Fatalf("rename: %v", err)
	}
	if got := dirty(); got != dirtyDay("2026-01-01") {
		t.Fatalf("account edits dirty from projection start, got %d", got)
	}
	bounded := renamed
	floor := 100.0
	bounded.MinBalance = &floor
	if _, err := s.UpdateAccount(bounded); err != nil {
		t.Fatalf("bound edit: %v", err)
	}
	if got := dirty(); got != dirtyDay("2026-01-01") {
		t.Fatalf("bound edit must dirty from start, got %d", got)
	}
	mustClean()

	if _, err := s.SaveCheckpoint(types.Checkpoint{AccountID: "checking", Balance: 50, ObservedAt: 1785974399}); err != nil {
		t.Fatalf("checkpoint: %v", err)
	}
	if got := dirty(); got != 1785974399 {
		t.Fatalf("checkpoint must dirty its instant, got %d", got)
	}
	mustClean()

	posting, err := s.CreatePosting(types.Posting{
		Name: "Groceries", SourceAccountID: &account.ID,
		Amount:          types.PostingAmountResolution{Resolver: "expression", Config: map[string]any{"expression": "25"}, Inputs: map[string]types.AmountInputBinding{}},
		PostedTime:      1785811200,
		TransactionTime: 1785811200,
		Enabled:         true,
	})
	if err != nil {
		t.Fatalf("create posting: %v", err)
	}
	if got := dirty(); got != 1785811200 {
		t.Fatalf("posting must dirty its day, got %d", got)
	}
	mustClean()
	if err := s.DeletePosting(posting.ID); err != nil {
		t.Fatalf("delete posting: %v", err)
	}
	if got := dirty(); got != dirtyDay("2026-01-01") {
		t.Fatalf("delete must dirty from projection start, got %d", got)
	}
	mustClean()

	rule, err := s.CreateSchedule(types.Schedule{
		Name: "Pay", SourceAccountID: &account.ID,
		Amount:    types.PostingAmountResolution{Resolver: "expression", Config: map[string]any{"expression": "10"}, Inputs: map[string]types.AmountInputBinding{}},
		Frequency: "monthly", StartDate: "2026-09-01", Priority: 1, Enabled: true,
	})
	if err != nil {
		t.Fatalf("create rule: %v", err)
	}
	if got := dirty(); got != dirtyDay("2026-09-01") {
		t.Fatalf("rule must dirty its start, got %d", got)
	}
	mustClean()
	if err := s.DeleteSchedule(rule.ID); err != nil {
		t.Fatalf("delete rule: %v", err)
	}
	if got := dirty(); got != dirtyDay("2026-01-01") {
		t.Fatalf("rule delete must dirty from projection start, got %d", got)
	}
	mustClean()
}
