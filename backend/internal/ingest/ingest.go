package ingest

import (
	"context"
	"time"

	"github.com/simhozebs/net-worth-estimator/backend/internal/store"
)

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
}

// Sync runs fetch, link resolution, provisioning, translation, and apply
// for one adapter. Stale links never reach translation.
func Sync(ctx context.Context, st store.Store, adapter Adapter, now time.Time) (Result, error) {
	var out Result
	end := now.Add(24 * time.Hour)
	start := now.Add(-90 * 24 * time.Hour)
	native, err := adapter.Fetch(ctx, start, end)
	if err != nil {
		return out, err
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
	applied, err := st.ApplySync(checkpoints, directives)
	if err != nil {
		return out, err
	}
	out.Applied = applied
	return out, nil
}
