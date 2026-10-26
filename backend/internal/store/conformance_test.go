package store

import (
	"testing"
)

// RunConformance proves any Store implementation honors the persistence
// contract using only the public interface: no SQL, no file paths, no
// implementation types. A replacement backend (Turso, Postgres, …) earns
// the Store name by calling this with its own factory:
//
//	func TestTursoConformance(t *testing.T) {
//		store.RunConformance(t, openTursoTestStore)
//	}
//
// SQLite-only concerns (schema shape, raw scripts, file layout) stay
// in TestOpen* and TestPurge* alongside this file.
func RunConformance(t *testing.T, newStore func(*testing.T) Store) {
	t.Helper()
	t.Run("InitializeDocument", func(t *testing.T) {
		testInitializeDocument(t, newStore)
	})
	t.Run("RoundTripsCanonicalDocumentMetadataAndOrder", func(t *testing.T) {
		testStoreRoundTripsCanonicalDocumentMetadataAndOrder(t, newStore)
	})
	t.Run("RowWritesUseStoredSyncOwnership", func(t *testing.T) {
		testRowWritesUseStoredSyncOwnership(t, newStore)
	})
	t.Run("OwnerCheckpointWinsKeyCollision", func(t *testing.T) {
		testOwnerCheckpointWinsKeyCollision(t, newStore)
	})
	t.Run("RowRoundTripsPreserveOrder", func(t *testing.T) {
		testRowRoundTripsPreserveOrder(t, newStore)
	})
	t.Run("ApplySyncPlanCheckpointLifecycle", func(t *testing.T) {
		testApplySyncPlanCheckpointLifecycle(t, newStore)
	})
	t.Run("ApplySyncPlanSkipsUserCheckpoint", func(t *testing.T) {
		testApplySyncPlanSkipsUserCheckpoint(t, newStore)
	})
	t.Run("ApplySyncPlanRefreshesPendingSnapshot", func(t *testing.T) {
		testApplySyncPlanRefreshesPendingSnapshot(t, newStore)
	})
	// PendingDeleteSparesUserRows stays SQLite-only: its fixture (a
	// model-source row with a sync-prefix ID) is legacy data the public API
	// refuses to create, so only raw SQL can set it up.
	t.Run("ArtifactsRoundTripAndKeepFirstWrite", func(t *testing.T) {
		testArtifactsRoundTripAndKeepFirstWrite(t, newStore)
	})
	t.Run("SyncStateDefaultsEmptyAndRoundTrips", func(t *testing.T) {
		testSyncStateDefaultsEmptyAndRoundTrips(t, newStore)
	})
	t.Run("SyncCredentialRoundTripAndClear", func(t *testing.T) {
		testSyncCredentialConformance(t, newStore)
	})
	t.Run("AmountPresetsRoundTripAndReorder", func(t *testing.T) {
		testAmountPresetConformanceRoundTrip(t, newStore)
	})
}

// TestStoreConformance runs the suite against the embedded SQLite backend.
func TestStoreConformance(t *testing.T) {
	RunConformance(t, openTestStore)
}

func testSyncCredentialConformance(t *testing.T, newStore func(*testing.T) Store) {
	t.Helper()
	database := newStore(t)
	credential, err := database.GetSyncCredential()
	if err != nil || credential.Configured() {
		t.Fatalf("default credential = %+v, err %v", credential, err)
	}
	if _, err := database.SetSyncCards([]string{"prime_card"}); err != nil {
		t.Fatalf("set cards: %v", err)
	}
	if _, err := database.SetSyncCredential("https://user:pass@bridge.example/simplefin", "bridge.example"); err != nil {
		t.Fatalf("set credential: %v", err)
	}
	loaded, err := database.GetSyncCredential()
	if err != nil || !loaded.Configured() || loaded.BridgeHost != "bridge.example" {
		t.Fatalf("loaded = %+v, err %v", loaded, err)
	}
	if len(loaded.CardAccounts) != 1 || loaded.CardAccounts[0] != "prime_card" {
		t.Fatalf("cards after credential set = %+v", loaded.CardAccounts)
	}
	if err := database.ClearSyncCredential(); err != nil {
		t.Fatalf("clear credential: %v", err)
	}
	cleared, err := database.GetSyncCredential()
	if err != nil || cleared.Configured() {
		t.Fatalf("cleared = %+v, err %v", cleared, err)
	}
	if cards, err := database.GetSyncCards(); err != nil || len(cards) != 1 || cards[0] != "prime_card" {
		t.Fatalf("cards after disconnect = %+v, err %v, want [prime_card]", cards, err)
	}
	if err := database.Clear(); err != nil {
		t.Fatalf("clear: %v", err)
	}
	after, err := database.GetSyncCredential()
	if err != nil || after.Configured() {
		t.Fatalf("credential after Clear = %+v, err %v", after, err)
	}
	if cards, err := database.GetSyncCards(); err != nil || len(cards) != 0 {
		t.Fatalf("cards after Clear = %+v, err %v, want forgotten", cards, err)
	}
}

func testArtifactsRoundTripAndKeepFirstWrite(t *testing.T, newStore func(*testing.T) Store) {
	t.Helper()
	store := newStore(t)
	if _, found, err := store.GetArtifact("missing"); err != nil || found {
		t.Fatalf("missing artifact = found %v, err %v", found, err)
	}
	if err := store.PutArtifact("key-1", "stochastic", "payload-v1"); err != nil {
		t.Fatalf("put artifact: %v", err)
	}
	payload, found, err := store.GetArtifact("key-1")
	if err != nil || !found || payload != "payload-v1" {
		t.Fatalf("artifact = %q found %v err %v", payload, found, err)
	}
	// Cache identities are write-once: a repeated computation must not
	// clobber the stored result.
	if err := store.PutArtifact("key-1", "stochastic", "payload-v2"); err != nil {
		t.Fatalf("repeat put artifact: %v", err)
	}
	payload, found, err = store.GetArtifact("key-1")
	if err != nil || !found || payload != "payload-v1" {
		t.Fatalf("artifact after repeat put = %q found %v err %v", payload, found, err)
	}
}
