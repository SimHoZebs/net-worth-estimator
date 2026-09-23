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
// SQLite-only concerns (schema migrations, raw scripts, file layout) stay
// in TestOpen* and TestPurge* alongside this file.
func RunConformance(t *testing.T, newStore func(*testing.T) Store) {
	t.Helper()
	t.Run("RoundTripsCanonicalDocumentMetadataAndOrder", func(t *testing.T) {
		testStoreRoundTripsCanonicalDocumentMetadataAndOrder(t, newStore)
	})
	t.Run("PersistsEffectiveDatedIncomeRowsWithSharedID", func(t *testing.T) {
		testStorePersistsEffectiveDatedIncomeRowsWithSharedID(t, newStore)
	})
	t.Run("ImportCSVRollsBackModelWhenIncomeReplacementFails", func(t *testing.T) {
		testImportCSVRollsBackModelWhenIncomeReplacementFails(t, newStore)
	})
	t.Run("SaveDropsForgedSyncRowsAndMergesStored", func(t *testing.T) {
		testSaveDropsForgedSyncRowsAndMergesStored(t, newStore)
	})
	t.Run("OwnerCheckpointWinsKeyCollision", func(t *testing.T) {
		testOwnerCheckpointWinsKeyCollision(t, newStore)
	})
	t.Run("RoundTripPreservesSyncRows", func(t *testing.T) {
		testRoundTripPreservesSyncRows(t, newStore)
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
	t.Run("ApplySyncPlanDryRunWritesNothing", func(t *testing.T) {
		testApplySyncPlanDryRunWritesNothing(t, newStore)
	})
	t.Run("ArtifactsRoundTripAndKeepFirstWrite", func(t *testing.T) {
		testArtifactsRoundTripAndKeepFirstWrite(t, newStore)
	})
}

// TestStoreConformance runs the suite against the embedded SQLite backend.
func TestStoreConformance(t *testing.T) {
	RunConformance(t, openTestStore)
}

func testArtifactsRoundTripAndKeepFirstWrite(t *testing.T, newStore func(*testing.T) Store) {
	t.Helper()
	store := newStore(t)
	if _, found, err := store.GetArtifact("missing"); err != nil || found {
		t.Fatalf("missing artifact = found %v, err %v", found, err)
	}
	if err := store.PutArtifact("key-1", "stochastic", `{"runs":1000}`); err != nil {
		t.Fatalf("put artifact: %v", err)
	}
	payload, found, err := store.GetArtifact("key-1")
	if err != nil || !found || payload != `{"runs":1000}` {
		t.Fatalf("artifact = %q found %v err %v", payload, found, err)
	}
	// Cache identities are write-once: a repeated computation must not
	// clobber the stored result.
	if err := store.PutArtifact("key-1", "stochastic", `{"runs":1}`); err != nil {
		t.Fatalf("repeat put artifact: %v", err)
	}
	payload, found, err = store.GetArtifact("key-1")
	if err != nil || !found || payload != `{"runs":1000}` {
		t.Fatalf("artifact after repeat put = %q found %v err %v", payload, found, err)
	}
}
