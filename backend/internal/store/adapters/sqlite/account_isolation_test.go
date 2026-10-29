package sqlite

import (
	"testing"

	"github.com/simhozebs/net-worth-estimator/backend/internal/store"
	"github.com/simhozebs/net-worth-estimator/backend/internal/types"
)

// TestAccountScopeIsolationMatrix proves same-file isolation across account
// scopes: identical entity IDs, preset names, and upstream sync keys coexist
// without leaking, Clear on one account preserves the other, and the sample
// scope stays independent of owner writes.
func TestAccountScopeIsolationMatrix(t *testing.T) {
	d := openSharedTestDatabase(t)
	a, err := d.EnsurePrivateAccount("a", "https://issuer.test", "a")
	if err != nil {
		t.Fatal(err)
	}
	b, err := d.EnsurePrivateAccount("b", "https://issuer.test", "b")
	if err != nil {
		t.Fatal(err)
	}
	sample, err := d.EnsureSampleAccount()
	if err != nil {
		t.Fatal(err)
	}
	const postingID = "01900000-0000-7000-8000-000000000077"
	for name, s := range map[string]store.Store{"a": a, "b": b, "sample": sample} {
		if _, err := s.CreateAccount(types.Account{ID: "checking", Name: name, Kind: "cash", Enabled: true}); err != nil {
			t.Fatalf("create checking in %s: %v", name, err)
		}
		if _, err := s.CreatePosting(testPostingFixture(postingID)); err != nil {
			t.Fatalf("create posting in %s: %v", name, err)
		}
		if _, err := s.CreateAmountPreset(testPresetFixture("same-recipe")); err != nil {
			t.Fatalf("create preset in %s: %v", name, err)
		}
	}
	// Identical upstream sync identity maps to a distinct local posting per
	// account and applies independently.
	for _, s := range []store.Store{a, b} {
		summary, err := s.ApplySyncPlan(
			[]SyncCheckpoint{{AccountID: "checking", Date: "2026-08-05", Balance: 100}},
			[]BankDirective{syncPendingDirective(syncPendingPosting("same-transaction", "checking", "2026-08-02"))})
		if err != nil || summary.PendingInserted != 1 || summary.CheckpointsInserted != 1 {
			t.Fatalf("sync apply = %+v, err %v", summary, err)
		}
	}
	loadedA, err := a.LoadDocument()
	if err != nil || len(loadedA.Accounts) != 1 || loadedA.Accounts[0].Name != "a" {
		t.Fatalf("account a leaked: %+v, %v", loadedA, err)
	}
	loadedB, err := b.LoadDocument()
	if err != nil || len(loadedB.Accounts) != 1 || loadedB.Accounts[0].Name != "b" {
		t.Fatalf("account b leaked: %+v, %v", loadedB, err)
	}
	if len(loadedA.Postings) != 2 || len(loadedB.Postings) != 2 {
		t.Fatalf("postings a=%d b=%d, want owner plus one synced each", len(loadedA.Postings), len(loadedB.Postings))
	}
	if loadedA.Postings[1].ID == loadedB.Postings[1].ID {
		t.Fatal("synced postings share an identity across accounts")
	}
	if err := a.PutArtifact("matrix", "deterministic", "payload-a"); err != nil {
		t.Fatal(err)
	}
	if err := a.SetLastSyncTime("2026-10-18T14:30:00Z"); err != nil {
		t.Fatal(err)
	}
	if err := b.SetLastSyncTime("2026-10-18T14:30:00Z"); err != nil {
		t.Fatal(err)
	}
	beforeB := planSnapshot(t, b.(*sqliteStore))
	// Clear resets one account's model, sync state, and artifacts while
	// preserving amount presets, ownership, and every other account.
	if err := a.Clear(); err != nil {
		t.Fatal(err)
	}
	if exists, err := a.DocumentExists(); err != nil || exists {
		t.Fatalf("cleared presence = %v, %v", exists, err)
	}
	if got := planSnapshot(t, b.(*sqliteStore)); !equalSnapshots(got, beforeB) {
		t.Fatal("clear crossed the account boundary")
	}
	if _, found, err := b.GetArtifact("matrix"); err != nil || found {
		t.Fatalf("artifact crossed accounts: %v %v", found, err)
	}
	if got, err := b.GetLastSyncTime(); err != nil || got == "" {
		t.Fatalf("other sync time = %q, %v", got, err)
	}
	presets, err := a.ListAmountPresets()
	if err != nil || len(presets) == 0 {
		t.Fatalf("clear removed presets: %+v, %v", presets, err)
	}
	if exists, err := d.HasAccount("a"); err != nil || !exists {
		t.Fatalf("clear removed ownership: %v, %v", exists, err)
	}
	// The sample scope is an independent account: owner writes never leak in.
	sampleLoaded, err := sample.LoadDocument()
	if err != nil || sampleLoaded == nil || len(sampleLoaded.Accounts) != 1 || sampleLoaded.Accounts[0].Name != "sample" {
		t.Fatalf("sample leaked: %+v, %v", sampleLoaded, err)
	}
	if _, err := b.CreateAccount(types.Account{ID: "b-only", Name: "B only", Kind: "cash", Enabled: true}); err != nil {
		t.Fatal(err)
	}
	if again, err := sample.LoadDocument(); err != nil || again == nil || len(again.Accounts) != 1 {
		t.Fatalf("owner write leaked into sample: %+v, %v", again, err)
	}
}

func equalSnapshots(a, b map[string]string) bool {
	if len(a) != len(b) {
		return false
	}
	for table, rows := range a {
		if b[table] != rows {
			return false
		}
	}
	return true
}
