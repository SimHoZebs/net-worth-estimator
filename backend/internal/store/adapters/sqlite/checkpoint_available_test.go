package sqlite

import (
	"testing"

	"github.com/simhozebs/net-worth-estimator/backend/internal/store"
	"github.com/simhozebs/net-worth-estimator/backend/internal/types"
)

func TestSyncCheckpointAvailableBalanceRoundTrip(t *testing.T) {
	database := openTestStore(t)
	seedAccount(t, database, "checking")
	instant := int64(1785628799)
	available := 123.45
	summary, err := database.ApplySync([]store.SyncCheckpoint{{
		AccountID: "checking", Balance: 100, AvailableBalance: &available,
		Source: store.SourceBankSync, Provider: store.ProviderSimpleFIN, ObservedAt: instant,
	}}, nil)
	if err != nil || summary.CheckpointsInserted != 1 {
		t.Fatalf("apply = %+v, err %v", summary, err)
	}
	model, err := database.LoadModel()
	if err != nil {
		t.Fatal(err)
	}
	if len(model.Checkpoints) != 1 {
		t.Fatalf("checkpoints = %+v", model.Checkpoints)
	}
	checkpoint := model.Checkpoints[0]
	if checkpoint.Balance != 100 || checkpoint.AvailableBalance == nil || *checkpoint.AvailableBalance != available {
		t.Fatalf("checkpoint = %+v, want posted 100 and available 123.45", checkpoint)
	}

	// A later report without the optional field clears the sidecar rather
	// than leaving stale evidence behind.
	if _, err := database.ApplySync([]store.SyncCheckpoint{{
		AccountID: "checking", Balance: 100,
		Source: store.SourceBankSync, Provider: store.ProviderSimpleFIN, ObservedAt: instant,
	}}, nil); err != nil {
		t.Fatal(err)
	}
	model, err = database.LoadModel()
	if err != nil {
		t.Fatal(err)
	}
	if model.Checkpoints[0].AvailableBalance != nil {
		t.Fatalf("available balance survived an absent report: %+v", model.Checkpoints[0].AvailableBalance)
	}
}

func TestOwnerCheckpointReplacesAvailableBalanceAtSameInstant(t *testing.T) {
	database := openTestStore(t)
	seedAccount(t, database, "checking")
	instant := int64(1785628799)
	available := 50.0
	if _, err := database.ApplySync([]store.SyncCheckpoint{{
		AccountID: "checking", Balance: 100, AvailableBalance: &available,
		Source: store.SourceBankSync, Provider: store.ProviderSimpleFIN, ObservedAt: instant,
	}}, nil); err != nil {
		t.Fatal(err)
	}
	if _, err := database.SaveCheckpoint(types.Checkpoint{AccountID: "checking", Balance: 90, ObservedAt: instant}); err != nil {
		t.Fatal(err)
	}
	model, err := database.LoadModel()
	if err != nil {
		t.Fatal(err)
	}
	if len(model.Checkpoints) != 1 {
		t.Fatalf("checkpoints = %+v", model.Checkpoints)
	}
	checkpoint := model.Checkpoints[0]
	if checkpoint.Source != store.SourceUser || checkpoint.Balance != 90 {
		t.Fatalf("owner replace = %+v", checkpoint)
	}
	if checkpoint.AvailableBalance != nil {
		t.Fatalf("bank available balance survived owner replacement: %+v", checkpoint.AvailableBalance)
	}
}
