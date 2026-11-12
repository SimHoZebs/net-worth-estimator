package ingest

import (
	"context"
	"fmt"
	"sort"
	"time"

	"github.com/simhozebs/net-worth-estimator/backend/internal/domain"
	"github.com/simhozebs/net-worth-estimator/backend/internal/store"
	"github.com/simhozebs/net-worth-estimator/backend/internal/types"
)

// Notice is one provider condition worth reporting without failing the run.
// Connection and account scopes are provider spellings; callers must not
// treat them as local row identities.
type Notice struct {
	Code         string `json:"code"`
	Message      string `json:"message"`
	Scope        string `json:"scope"`
	ConnectionID string `json:"connectionId,omitempty"`
	AccountID    string `json:"accountId,omitempty"`
}

// Notifier is an optional adapter capability. Adapters that can report
// non-fatal provider conditions implement it; the orchestrator copies the
// notices into the run result.
type Notifier interface {
	Notices(native any) []Notice
}

// Adapter is one bank provider behind the TransactionProvider interface.
// Native snapshots stay opaque to the orchestrator: only the adapter
// interprets them. The orchestrator owns provisioning, apply, last-sync
// stamping, and dirty marking identically for every provider.
type Adapter interface {
	// Key identifies the provider in sync keys and checkpoint rows.
	Key() string
	// Fetch returns the provider-native snapshot for the window.
	Fetch(ctx context.Context, start, end time.Time) (any, error)
	// Provisions lists bridge accounts from the snapshot for linking.
	Provisions(native any) []store.SyncProvision
	// WithoutStale returns the snapshot minus stale bridge accounts.
	WithoutStale(native any, stale []string) any
	// Translate maps the snapshot plus resolved model links to sync
	// checkpoints and bank directives. Skip counts stay provider-spelled.
	Translate(ctx context.Context, st store.Store, native any, resolved map[string]string, now time.Time) ([]store.SyncCheckpoint, []store.BankDirective, map[string]int, error)
}

// Result is one provider-neutral sync run.
type Result struct {
	Applied     store.SyncApplySummary
	Provisioned int
	Skipped     map[string]int
	Notices     []Notice
}

// Sync runs fetch, link resolution, provisioning, translation, and apply
// for one adapter. Stale links never reach translation.
func Sync(ctx context.Context, st store.Store, adapter Adapter, now time.Time) (Result, error) {
	var out Result
	lastSync, err := st.GetLastSyncTime()
	if err != nil {
		return out, fmt.Errorf("read last sync time: %w", err)
	}
	lookback := 90 * 24 * time.Hour
	if lastSync != "" {
		lookback = 30 * 24 * time.Hour
	}
	// Keep the full request within the Bridge's 90-day range limit.
	end := now
	start := now.Add(-lookback)
	native, err := adapter.Fetch(ctx, start, end)
	if err != nil {
		return out, err
	}
	if notifier, ok := adapter.(Notifier); ok {
		out.Notices = notifier.Notices(native)
	}
	resolved, provisioned, stale, err := st.ProvisionSyncAccounts(adapter.Provisions(native))
	if err != nil {
		return out, err
	}
	out.Provisioned = provisioned
	if len(stale) > 0 {
		native = adapter.WithoutStale(native, stale)
	}
	checkpoints, directives, skipped, err := adapter.Translate(ctx, st, native, resolved, now)
	if err != nil {
		return out, err
	}
	if len(stale) > 0 {
		skipped["linked-account-missing"] += len(stale)
	}
	out.Skipped = skipped
	before, err := st.LoadModel()
	if err != nil {
		return out, fmt.Errorf("load model before sync: %w", err)
	}
	applied, err := st.ApplySync(checkpoints, directives)
	if err != nil {
		return out, err
	}
	out.Applied = applied
	deleted, err := pruneNoOpCheckpoints(st, before, checkpoints)
	if err != nil {
		return out, err
	}
	if deleted > 0 {
		out.Applied.CheckpointsInserted = max(0, out.Applied.CheckpointsInserted-deleted)
		out.Applied.CheckpointsSkipped += deleted
	}
	return out, nil
}

// pruneNoOpCheckpoints removes forward bank observations whose posted balance
// matches the modeled balance at their instant. Such a checkpoint sets the
// balance to the value it already has, so it reconciles nothing and need not
// occupy a row. First observations, same-instant refreshes, and backdated
// observations are kept: they establish coverage or anchor history. A forward
// observation that carries a changed available balance is also kept because
// that figure is separate evidence.
func pruneNoOpCheckpoints(st store.Store, before *types.FinancialModel, checkpoints []store.SyncCheckpoint) (int, error) {
	if before == nil || len(checkpoints) == 0 {
		return 0, nil
	}
	after, err := st.LoadModel()
	if err != nil {
		return 0, fmt.Errorf("load model after sync: %w", err)
	}
	if after == nil {
		return 0, nil
	}
	latest := int64(0)
	for _, checkpoint := range checkpoints {
		if checkpoint.ObservedAt > latest {
			latest = checkpoint.ObservedAt
		}
	}
	if latest <= 0 {
		return 0, nil
	}
	zero, err := domain.ZeroDeltaObservations(after, time.Unix(latest, 0).UTC().Format(time.RFC3339))
	if err != nil {
		// A model that cannot be replayed must not block sync. Keep the
		// checkpoint rather than risk dropping evidence.
		return 0, nil
	}
	latestByAccount := make(map[string]types.Checkpoint, len(before.Checkpoints))
	for _, checkpoint := range before.Checkpoints {
		existing, ok := latestByAccount[checkpoint.AccountID]
		if !ok || checkpoint.ObservedAt > existing.ObservedAt {
			latestByAccount[checkpoint.AccountID] = checkpoint
		}
	}
	afterByKey := make(map[domain.ObservationKey]types.Checkpoint, len(after.Checkpoints))
	for _, checkpoint := range after.Checkpoints {
		afterByKey[domain.ObservationKey{AccountID: checkpoint.AccountID, ObservedAt: checkpoint.ObservedAt}] = checkpoint
	}
	ordered := append([]store.SyncCheckpoint(nil), checkpoints...)
	sort.SliceStable(ordered, func(i, j int) bool {
		if ordered[i].AccountID != ordered[j].AccountID {
			return ordered[i].AccountID < ordered[j].AccountID
		}
		return ordered[i].ObservedAt < ordered[j].ObservedAt
	})
	keys := make([]store.SyncCheckpointKey, 0, len(ordered))
	for _, checkpoint := range ordered {
		key := domain.ObservationKey{AccountID: checkpoint.AccountID, ObservedAt: checkpoint.ObservedAt}
		stored, present := afterByKey[key]
		existing, observed := latestByAccount[checkpoint.AccountID]
		if !observed {
			if present {
				latestByAccount[checkpoint.AccountID] = stored
			}
			continue
		}
		if checkpoint.ObservedAt < existing.ObservedAt {
			continue
		}
		if checkpoint.ObservedAt == existing.ObservedAt {
			if present {
				latestByAccount[checkpoint.AccountID] = stored
			}
			continue
		}
		if _, isZero := zero[key]; !isZero {
			if present {
				latestByAccount[checkpoint.AccountID] = stored
			}
			continue
		}
		if !present || stored.Source == store.SourceUser {
			continue
		}
		if stored.AvailableBalance != nil && (existing.AvailableBalance == nil || *stored.AvailableBalance != *existing.AvailableBalance) {
			latestByAccount[checkpoint.AccountID] = stored
			continue
		}
		keys = append(keys, store.SyncCheckpointKey{AccountID: checkpoint.AccountID, ObservedAt: checkpoint.ObservedAt, Provider: checkpoint.Provider})
	}
	if len(keys) == 0 {
		return 0, nil
	}
	return st.DeleteSyncCheckpoints(keys)
}
