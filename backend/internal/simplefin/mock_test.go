package simplefin

import (
	"context"
	"encoding/json"
	"os"
	"path/filepath"
	"testing"
	"time"
)

func mockTestConfig(dryRun bool) Config {
	return Config{
		AccountMap:   map[string]string{"mock-checking": "checking", "mock-prime": "prime_card"},
		CardAccounts: map[string]struct{}{"prime_card": {}},
		DryRun:       dryRun,
	}
}

func TestParseMockModeStrict(t *testing.T) {
	if !ParseMockMode("1") {
		t.Fatal("mock mode must accept 1")
	}
	for _, value := range []string{"", "true", "0", "yes"} {
		if ParseMockMode(value) {
			t.Fatalf("mock mode accepted %q, want only 1", value)
		}
	}
}

func TestMockAccountSetMapsLikeBridge(t *testing.T) {
	now := time.Unix(1785628800, 0).UTC()
	plan, err := Map(MockAccountSet(now), mockTestConfig(false), now)
	if err != nil {
		t.Fatalf("map mock set: %v", err)
	}
	if len(plan.Checkpoints) != 2 {
		t.Fatalf("checkpoints = %+v, want checking + prime_card", plan.Checkpoints)
	}
	if len(plan.Pending) != 1 {
		t.Fatalf("pending = %+v, want the one mock charge", plan.Pending)
	}
	pending := plan.Pending[0]
	if pending.ID != "sfin-pending-prime_card-mock-pend1" {
		t.Fatalf("pending id = %q, want sync namespace", pending.ID)
	}
	if pending.Enabled {
		t.Fatal("pending seed must be disabled")
	}
	expression, ok := pending.Amount.Config["expression"].(string)
	if !ok || expression != "42.10" {
		t.Fatalf("pending amount = %+v", pending.Amount)
	}
	if plan.Skipped[SkipPosted] != 2 || plan.Skipped[SkipNonCharge] != 1 {
		t.Fatalf("skipped = %+v, want 2 posted + 1 pending refund", plan.Skipped)
	}
}

func TestMockRunnerSyncPersistsAcrossRuns(t *testing.T) {
	database := openRunnerStore(t)
	runner := NewMockRunner(database, mockTestConfig(false))
	first, err := runner.Sync(context.Background())
	if err != nil {
		t.Fatalf("mock sync: %v", err)
	}
	if first.CheckpointsInserted != 2 || first.PendingInserted != 1 {
		t.Fatalf("first summary = %+v", first)
	}
	// Deterministic mock payload on the same day: rerun must update the
	// stored checkpoints and refresh the pending snapshot, proving the
	// first run persisted sync-owned rows.
	second, err := runner.Sync(context.Background())
	if err != nil {
		t.Fatalf("mock rerun: %v", err)
	}
	if second.CheckpointsUpdated != 2 || second.PendingDeleted != 1 || second.PendingInserted != 1 {
		t.Fatalf("rerun summary = %+v, want updates + pending refresh", second)
	}
}

func TestMockRunnerDryRunWritesNothing(t *testing.T) {
	database := openRunnerStore(t)
	runner := NewMockRunner(database, mockTestConfig(true))
	summary, err := runner.Sync(context.Background())
	if err != nil {
		t.Fatalf("mock dry run: %v", err)
	}
	if !summary.DryRun || summary.CheckpointsInserted != 2 || summary.PendingInserted != 1 {
		t.Fatalf("summary = %+v", summary)
	}
}

func TestLoadMockAccountSetRoundTrip(t *testing.T) {
	now := time.Unix(1785628800, 0).UTC()
	raw, err := json.Marshal(MockAccountSet(now))
	if err != nil {
		t.Fatalf("marshal mock set: %v", err)
	}
	path := filepath.Join(t.TempDir(), "mock-accounts.json")
	if err := os.WriteFile(path, raw, 0o600); err != nil {
		t.Fatalf("write mock file: %v", err)
	}
	loaded, err := LoadMockAccountSet(path)
	if err != nil {
		t.Fatalf("load mock file: %v", err)
	}
	if len(loaded.Accounts) != 2 || loaded.Accounts[0].ID != "mock-checking" {
		t.Fatalf("loaded = %+v", loaded.Accounts)
	}
	if _, err := LoadMockAccountSet(filepath.Join(t.TempDir(), "missing.json")); err == nil {
		t.Fatal("expected error for missing mock file")
	}
}
