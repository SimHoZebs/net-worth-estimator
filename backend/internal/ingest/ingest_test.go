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
	fetchStart   time.Time
	fetchEnd     time.Time
}

func (a *fakeAdapter) Key() string { return a.key }

func (a *fakeAdapter) Fetch(_ context.Context, start, end time.Time) (any, error) {
	a.fetchStart, a.fetchEnd = start, end
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
	if _, err := st.CreateAccount(types.Account{ID: modelID, Name: modelID, Kind: types.AccountKindCash}); err != nil {
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

func TestSyncSkipsForwardNoOpCheckpoints(t *testing.T) {
	st := openIngestStore(t)
	seedIngestLink(t, st, "bridge-checking", "checking")
	checkpoints := []store.SyncCheckpoint{}
	adapter := &fakeAdapter{
		key:        "fake",
		snapshot:   fakeSnapshot{bridges: []string{"bridge-checking"}},
		provisions: []store.SyncProvision{{BridgeID: "bridge-checking", Name: "Checking", Currency: "USD"}},
		checkpoints: func(map[string]string) []store.SyncCheckpoint {
			return checkpoints
		},
		skipped: map[string]int{},
	}
	now := time.Date(2026, time.August, 4, 0, 0, 0, 0, time.UTC)
	at := func(day int) int64 {
		return time.Date(2026, time.August, day, 12, 0, 0, 0, time.UTC).Unix()
	}
	syncAt := func(balance float64, observedAt int64) Result {
		t.Helper()
		checkpoints = []store.SyncCheckpoint{{
			AccountID: "checking", Balance: balance,
			Source: store.SourceBankSync, Provider: "fake", ObservedAt: observedAt,
		}}
		out, err := Sync(context.Background(), st, adapter, now)
		if err != nil {
			t.Fatalf("sync: %v", err)
		}
		return out
	}

	first := syncAt(100, at(1))
	if first.Applied.CheckpointsInserted != 1 {
		t.Fatalf("first observation must be stored: %+v", first.Applied)
	}
	noop := syncAt(100, at(2))
	if noop.Applied.CheckpointsInserted != 0 || noop.Applied.CheckpointsSkipped != 1 {
		t.Fatalf("forward no-op must not be stored: %+v", noop.Applied)
	}
	model, err := st.LoadModel()
	if err != nil {
		t.Fatal(err)
	}
	if len(model.Checkpoints) != 1 || model.Checkpoints[0].ObservedAt != at(1) {
		t.Fatalf("forward no-op left a row: %+v", model.Checkpoints)
	}

	backdated := syncAt(0, at(0))
	if backdated.Applied.CheckpointsInserted != 1 {
		t.Fatalf("backdated observation must be kept: %+v", backdated.Applied)
	}
	changed := syncAt(150, at(3))
	if changed.Applied.CheckpointsInserted != 1 {
		t.Fatalf("changed balance must be stored: %+v", changed.Applied)
	}
	again := syncAt(150, at(4))
	if again.Applied.CheckpointsInserted != 0 || again.Applied.CheckpointsSkipped != 1 {
		t.Fatalf("forward no-op after a change must not be stored: %+v", again.Applied)
	}
	model, err = st.LoadModel()
	if err != nil {
		t.Fatal(err)
	}
	seen := map[int64]float64{}
	for _, checkpoint := range model.Checkpoints {
		seen[checkpoint.ObservedAt] = checkpoint.Balance
	}
	if len(seen) != 3 || seen[at(0)] != 0 || seen[at(1)] != 100 || seen[at(3)] != 150 {
		t.Fatalf("unexpected checkpoint history: %+v", model.Checkpoints)
	}
}

func TestSyncKeepsFirstZeroObservation(t *testing.T) {
	st := openIngestStore(t)
	seedIngestLink(t, st, "bridge-empty", "empty")
	checkpointAt := time.Date(2026, time.August, 2, 12, 0, 0, 0, time.UTC).Unix()
	adapter := &fakeAdapter{
		key:        "fake",
		snapshot:   fakeSnapshot{bridges: []string{"bridge-empty"}},
		provisions: []store.SyncProvision{{BridgeID: "bridge-empty", Name: "Empty", Currency: "USD"}},
		checkpoints: func(resolved map[string]string) []store.SyncCheckpoint {
			return []store.SyncCheckpoint{{
				AccountID: resolved["bridge-empty"], Balance: 0,
				Source: store.SourceBankSync, Provider: "fake", ObservedAt: checkpointAt,
			}}
		},
		skipped: map[string]int{},
	}
	out, err := Sync(context.Background(), st, adapter, time.Date(2026, time.August, 3, 0, 0, 0, 0, time.UTC))
	if err != nil {
		t.Fatalf("sync: %v", err)
	}
	if out.Applied.CheckpointsInserted != 1 {
		t.Fatalf("first observation establishes coverage even at zero: %+v", out.Applied)
	}
}

func TestSyncKeepsChangedAvailableBalance(t *testing.T) {
	st := openIngestStore(t)
	seedIngestLink(t, st, "bridge-checking", "checking")
	checkpoints := []store.SyncCheckpoint{}
	adapter := &fakeAdapter{
		key:        "fake",
		snapshot:   fakeSnapshot{bridges: []string{"bridge-checking"}},
		provisions: []store.SyncProvision{{BridgeID: "bridge-checking", Name: "Checking", Currency: "USD"}},
		checkpoints: func(map[string]string) []store.SyncCheckpoint {
			return checkpoints
		},
		skipped: map[string]int{},
	}
	now := time.Date(2026, time.August, 4, 0, 0, 0, 0, time.UTC)
	at := func(day int) int64 {
		return time.Date(2026, time.August, day, 12, 0, 0, 0, time.UTC).Unix()
	}
	available := func(value float64) *float64 { return &value }
	syncAt := func(observedAt int64, availableBalance *float64) Result {
		t.Helper()
		checkpoints = []store.SyncCheckpoint{{
			AccountID: "checking", Balance: 100, AvailableBalance: availableBalance,
			Source: store.SourceBankSync, Provider: "fake", ObservedAt: observedAt,
		}}
		out, err := Sync(context.Background(), st, adapter, now)
		if err != nil {
			t.Fatalf("sync: %v", err)
		}
		return out
	}

	if out := syncAt(at(1), available(50)); out.Applied.CheckpointsInserted != 1 {
		t.Fatalf("first observation = %+v", out.Applied)
	}
	if out := syncAt(at(2), available(60)); out.Applied.CheckpointsInserted != 1 {
		t.Fatalf("changed available balance must be stored: %+v", out.Applied)
	}
	if out := syncAt(at(3), available(60)); out.Applied.CheckpointsInserted != 0 || out.Applied.CheckpointsSkipped != 1 {
		t.Fatalf("identical observation must not be stored: %+v", out.Applied)
	}
	model, err := st.LoadModel()
	if err != nil {
		t.Fatal(err)
	}
	if len(model.Checkpoints) != 2 {
		t.Fatalf("checkpoints = %+v", model.Checkpoints)
	}
	latest := model.Checkpoints[len(model.Checkpoints)-1]
	if latest.ObservedAt != at(2) || latest.AvailableBalance == nil || *latest.AvailableBalance != 60 {
		t.Fatalf("latest checkpoint = %+v", latest)
	}
}

func TestSyncRequestWindow(t *testing.T) {
	now := time.Date(2026, time.November, 6, 17, 30, 0, 0, time.UTC)
	for _, tc := range []struct {
		name     string
		lastSync string
		days     int
	}{
		{name: "initial", days: 90},
		{name: "subsequent", lastSync: now.Add(-6 * time.Hour).Format(time.RFC3339), days: 30},
		{name: "long gap", lastSync: now.Add(-60 * 24 * time.Hour).Format(time.RFC3339), days: 30},
	} {
		t.Run(tc.name, func(t *testing.T) {
			st := openIngestStore(t)
			if tc.lastSync != "" {
				if err := st.SetLastSyncTime(tc.lastSync); err != nil {
					t.Fatal(err)
				}
			}
			adapter := &fakeAdapter{
				key:         "fake",
				checkpoints: func(map[string]string) []store.SyncCheckpoint { return nil },
				skipped:     map[string]int{},
			}
			if _, err := Sync(context.Background(), st, adapter, now); err != nil {
				t.Fatal(err)
			}
			if !adapter.fetchEnd.Equal(now) {
				t.Fatalf("fetch end = %v, want %v", adapter.fetchEnd, now)
			}
			lookback := time.Duration(tc.days) * 24 * time.Hour
			if want := now.Add(-lookback); !adapter.fetchStart.Equal(want) {
				t.Fatalf("fetch start = %v, want %v", adapter.fetchStart, want)
			}
			if span := adapter.fetchEnd.Sub(adapter.fetchStart); span != lookback {
				t.Fatalf("fetch window = %v, want %v", span, lookback)
			}
		})
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
