package main

import (
	"path/filepath"
	"testing"
	"time"

	"github.com/simhozebs/net-worth-estimator/backend/internal/store"
	"github.com/simhozebs/net-worth-estimator/backend/internal/store/adapters/sqlite"
	"github.com/simhozebs/net-worth-estimator/backend/internal/types"
)

func at(day int) int64 {
	return time.Date(2026, time.August, day, 12, 0, 0, 0, time.UTC).Unix()
}

func seedPruneUser(t *testing.T, db *sqlite.Database, user string) store.Store {
	t.Helper()
	scoped, err := db.EnsureUser(user, "https://issuer.test", user)
	if err != nil {
		t.Fatal(err)
	}
	if _, err := scoped.CreateAccount(types.Account{ID: "checking", Name: "Checking", Kind: types.AccountKindCash, Enabled: true}); err != nil {
		t.Fatal(err)
	}
	return scoped
}

func applySync(t *testing.T, scoped store.Store, balance float64, available *float64, observedAt int64) {
	t.Helper()
	summary, err := scoped.ApplySync([]store.SyncCheckpoint{{
		AccountID: "checking", Balance: balance, AvailableBalance: available,
		Source: store.SourceBankSync, Provider: store.ProviderSimpleFIN, ObservedAt: observedAt,
	}}, nil)
	if err != nil || summary.CheckpointsInserted != 1 {
		t.Fatalf("apply %d: %+v %v", observedAt, summary, err)
	}
}

func checkpointBalances(t *testing.T, scoped store.Store) map[int64]float64 {
	t.Helper()
	model, err := scoped.LoadModel()
	if err != nil {
		t.Fatal(err)
	}
	seen := map[int64]float64{}
	for _, checkpoint := range model.Checkpoints {
		seen[checkpoint.ObservedAt] = checkpoint.Balance
	}
	return seen
}

func TestUpgradeDeletesForwardNoOps(t *testing.T) {
	path := filepath.Join(t.TempDir(), "app.db")
	db, err := sqlite.SetupDatabase(path)
	if err != nil {
		t.Fatal(err)
	}
	defer db.Close()
	scoped := seedPruneUser(t, db, "alice")

	applySync(t, scoped, 100, nil, at(1))
	applySync(t, scoped, 100, nil, at(2))
	applySync(t, scoped, 150, nil, at(3))
	applySync(t, scoped, 150, nil, at(4))
	if _, err := scoped.SaveCheckpoint(types.Checkpoint{AccountID: "checking", Balance: 150, ObservedAt: at(5)}); err != nil {
		t.Fatal(err)
	}
	available := func(value float64) *float64 { return &value }
	applySync(t, scoped, 150, available(60), at(6))
	applySync(t, scoped, 150, available(60), at(7))
	applySync(t, scoped, 150.4, nil, at(8))

	model, err := scoped.LoadModel()
	if err != nil {
		t.Fatal(err)
	}
	if len(model.Checkpoints) != 8 {
		t.Fatalf("seeded checkpoints = %d, want 8", len(model.Checkpoints))
	}

	result, err := upgrade(path, true)
	if err != nil {
		t.Fatal(err)
	}
	if result.Deleted != 3 {
		t.Fatalf("dry run deletable = %d, want 3 (days 2, 4, 7)", result.Deleted)
	}
	if got := checkpointBalances(t, scoped); len(got) != 8 {
		t.Fatalf("dry run must not delete: %d rows", len(got))
	}

	result, err = upgrade(path, false)
	if err != nil {
		t.Fatal(err)
	}
	if result.Deleted != 3 || result.Checked != 1 || result.Users != 1 {
		t.Fatalf("upgrade = %+v, want 3 deleted", result)
	}
	seen := checkpointBalances(t, scoped)
	if len(seen) != 5 {
		t.Fatalf("remaining = %+v, want 5 rows", seen)
	}
	for _, day := range []int{1, 3, 5, 6, 8} {
		if _, ok := seen[at(day)]; !ok {
			t.Fatalf("day %d must survive: %+v", day, seen)
		}
	}
	for _, day := range []int{2, 4, 7} {
		if _, ok := seen[at(day)]; ok {
			t.Fatalf("day %d must be pruned: %+v", day, seen)
		}
	}
	if seen[at(8)] != 150.4 {
		t.Fatalf("sub-dollar correction must survive: %+v", seen)
	}

	again, err := upgrade(path, false)
	if err != nil {
		t.Fatal(err)
	}
	if again.Deleted != 0 {
		t.Fatalf("repeat prune = %+v, want 0 deleted", again)
	}
}

func TestUpgradeKeepsFirstZeroObservation(t *testing.T) {
	path := filepath.Join(t.TempDir(), "app.db")
	db, err := sqlite.SetupDatabase(path)
	if err != nil {
		t.Fatal(err)
	}
	defer db.Close()
	scoped := seedPruneUser(t, db, "alice")
	applySync(t, scoped, 0, nil, at(1))

	result, err := upgrade(path, false)
	if err != nil {
		t.Fatal(err)
	}
	if result.Deleted != 0 {
		t.Fatalf("first zero establishes coverage: %+v", result)
	}
	if got := checkpointBalances(t, scoped); len(got) != 1 {
		t.Fatalf("first zero must survive: %+v", got)
	}
}

func TestUpgradeHandlesMultipleUsers(t *testing.T) {
	path := filepath.Join(t.TempDir(), "app.db")
	db, err := sqlite.SetupDatabase(path)
	if err != nil {
		t.Fatal(err)
	}
	defer db.Close()
	alice := seedPruneUser(t, db, "alice")
	applySync(t, alice, 100, nil, at(1))
	applySync(t, alice, 100, nil, at(2))
	bob := seedPruneUser(t, db, "bob")
	applySync(t, bob, 200, nil, at(1))

	result, err := upgrade(path, false)
	if err != nil {
		t.Fatal(err)
	}
	if result.Users != 2 || result.Deleted != 1 {
		t.Fatalf("upgrade = %+v, want 2 users and 1 deleted", result)
	}
	if got := checkpointBalances(t, alice); len(got) != 1 {
		t.Fatalf("alice = %+v, want 1 row", got)
	}
	if got := checkpointBalances(t, bob); len(got) != 1 {
		t.Fatalf("bob first observation must survive: %+v", got)
	}
}
