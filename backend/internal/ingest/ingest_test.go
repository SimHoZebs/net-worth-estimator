package ingest

import (
	"context"
	"path/filepath"
	"testing"
	"time"

	"github.com/simhozebs/net-worth-estimator/backend/internal/store"
	"github.com/simhozebs/net-worth-estimator/backend/internal/store/adapters/sqlite"
	"github.com/simhozebs/net-worth-estimator/backend/internal/types"
)

type fakeSnapshot struct {
	bridges []string
}

type fakeAdapter struct {
	key          string
	provisions   []store.SyncProvision
	snapshot     fakeSnapshot
	checkpoints  func(resolved map[string]string) []store.SyncCheckpoint
	directives   []store.BankDirective
	skipped      map[string]int
	withoutStale []string
	fetchErr     error
}

func (a *fakeAdapter) Key() string { return a.key }

func (a *fakeAdapter) Fetch(_ context.Context, _, _ time.Time) (any, error) {
	return a.snapshot, a.fetchErr
}

func (a *fakeAdapter) Provisions(_ any) []store.SyncProvision {
	return a.provisions
}

func (a *fakeAdapter) WithoutStale(native any, stale []string) any {
	a.withoutStale = stale
	snap, ok := native.(fakeSnapshot)
	if !ok {
		return native
	}
	dropped := map[string]struct{}{}
	for _, id := range stale {
		dropped[id] = struct{}{}
	}
	kept := fakeSnapshot{}
	for _, id := range snap.bridges {
		if _, ok := dropped[id]; !ok {
			kept.bridges = append(kept.bridges, id)
		}
	}
	return kept
}

func (a *fakeAdapter) Translate(_ context.Context, _ store.Store, _ any, resolved map[string]string, _ time.Time) ([]store.SyncCheckpoint, []store.BankDirective, map[string]int, error) {
	return a.checkpoints(resolved), a.directives, a.skipped, nil
}

func openIngestStore(t *testing.T) store.Store {
	t.Helper()
	database, err := sqlite.SetupDatabase(filepath.Join(t.TempDir(), "ingest.db"))
	if err != nil {
		t.Fatal(err)
	}
	t.Cleanup(func() { _ = database.Close() })
	st, err := database.EnsureUser("ingest-user", "https://issuer.test", "ingest-user")
	if err != nil {
		t.Fatal(err)
	}
	return st
}

func seedIngestLink(t *testing.T, st store.Store, bridgeID, modelID string) {
	t.Helper()
	if _, err := st.CreateAccount(types.Account{ID: modelID, Name: modelID}); err != nil {
		t.Fatal(err)
	}
	if _, err := st.SaveAccountLink(store.AccountLink{BridgeAccountID: bridgeID, ModelAccountID: modelID, Origin: store.LinkOriginManual}); err != nil {
		t.Fatal(err)
	}
}

func TestSyncAppliesAndMarksDirty(t *testing.T) {
	st := openIngestStore(t)
	seedIngestLink(t, st, "bridge-checking", "checking")
	checkpointAt := time.Date(2026, time.August, 2, 23, 59, 59, 0, time.UTC).Unix()
	transactionAt := time.Date(2026, time.August, 3, 12, 0, 0, 0, time.UTC).Unix()
	adapter := &fakeAdapter{
		key:        "fake",
		snapshot:   fakeSnapshot{bridges: []string{"bridge-checking"}},
		provisions: []store.SyncProvision{{BridgeID: "bridge-checking", Name: "Checking", Currency: "USD"}},
		checkpoints: func(resolved map[string]string) []store.SyncCheckpoint {
			return []store.SyncCheckpoint{{
				AccountID: resolved["bridge-checking"], Balance: 100,
				Source: store.SourceBankSync, Provider: "fake", ObservedAt: checkpointAt,
			}}
		},
		directives: []store.BankDirective{{Upsert: &store.BankUpsert{
			Transaction: types.Transaction{
				Name: "Groceries", Source: store.SourceBankSync,
				SourceAccountID: strptr("checking"),
				Amount:          types.TransactionAmountResolution{Resolver: "expression", Config: map[string]any{"expression": "25"}, Inputs: map[string]types.AmountInputBinding{}},
				PostedTime:      transactionAt, TransactionTime: transactionAt, Enabled: true,
			},
			Keys: []store.BankKey{{Provider: "fake", AccountID: "bridge-checking", TransactionID: "tx1"}},
		}}},
		skipped: map[string]int{},
	}
	out, err := Sync(context.Background(), st, adapter, time.Date(2026, time.August, 4, 0, 0, 0, 0, time.UTC))
	if err != nil {
		t.Fatalf("sync: %v", err)
	}
	if out.Applied.CheckpointsInserted != 1 || out.Applied.SettledInserted != 1 {
		t.Fatalf("summary = %+v", out.Applied)
	}
	state, err := st.GetProjectionState()
	if err != nil {
		t.Fatalf("state: %v", err)
	}
	if state.Revision != 1 || state.DirtyFrom != checkpointAt {
		t.Fatalf("run with writes must mark the earliest instant: %+v", state)
	}
}

func TestSyncEmptyRunMarksNothing(t *testing.T) {
	st := openIngestStore(t)
	adapter := &fakeAdapter{
		key:         "fake",
		checkpoints: func(map[string]string) []store.SyncCheckpoint { return nil },
		skipped:     map[string]int{},
	}
	_, err := Sync(context.Background(), st, adapter, time.Now().UTC())
	if err != nil {
		t.Fatalf("sync: %v", err)
	}
	state, err := st.GetProjectionState()
	if err != nil {
		t.Fatalf("state: %v", err)
	}
	if state.Revision != 0 || state.DirtyFrom != 0 {
		t.Fatalf("empty run must not bump revision, got %+v", state)
	}
}

func TestSyncDropsStaleBridges(t *testing.T) {
	st := openIngestStore(t)
	seedIngestLink(t, st, "bridge-old", "checking")
	if err := st.DeleteAccount("checking"); err != nil {
		t.Fatalf("delete account: %v", err)
	}
	adapter := &fakeAdapter{
		key:         "fake",
		snapshot:    fakeSnapshot{bridges: []string{"bridge-old"}},
		provisions:  []store.SyncProvision{{BridgeID: "bridge-old", Name: "Old", Currency: "USD"}},
		checkpoints: func(map[string]string) []store.SyncCheckpoint { return nil },
		skipped:     map[string]int{},
	}
	if _, err := Sync(context.Background(), st, adapter, time.Now().UTC()); err != nil {
		t.Fatalf("sync: %v", err)
	}
	if len(adapter.withoutStale) != 1 || adapter.withoutStale[0] != "bridge-old" {
		t.Fatalf("stale bridges bypassed translation: %v", adapter.withoutStale)
	}
}

func strptr(s string) *string { return &s }
