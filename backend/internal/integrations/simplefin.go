package integrations

import (
	"context"

	"github.com/simhozebs/net-worth-estimator/backend/internal/simplefin"
	"github.com/simhozebs/net-worth-estimator/backend/internal/store"
)

// SimpleFIN adapts the existing SimpleFIN Bridge sync to the Provider
// contract. It reports the same user-scoped connection state as the
// credential endpoint and the same sync readiness as server status, without
// exposing the stored Access URL.
type SimpleFIN struct {
	store  store.Store
	runner *simplefin.Runner
}

// NewSimpleFIN builds the SimpleFIN provider adapter. The runner may be nil
// (non-owner scopes, tests); sync then reports unconfigured, matching
// server status behavior.
func NewSimpleFIN(st store.Store, runner *simplefin.Runner) *SimpleFIN {
	return &SimpleFIN{store: st, runner: runner}
}

// ID returns the stable SimpleFIN provider identifier.
func (p *SimpleFIN) ID() string { return SimpleFINID }

// Status snapshots the calling user's SimpleFIN connection and sync state.
// Only display metadata (Bridge host, timestamps) is returned; the Access
// URL secret never leaves the server.
func (p *SimpleFIN) Status(_ context.Context) (Status, error) {
	credential, err := p.store.GetSyncCredential()
	if err != nil {
		return Status{}, err
	}
	lastSync, err := p.store.GetLastSyncTime()
	if err != nil {
		return Status{}, err
	}
	status := Status{Connected: credential.Configured()}
	if status.Connected {
		status.Detail = credential.BridgeHost
		status.ConnectedAt = credential.UpdatedAt
	}
	if p.runner != nil {
		status.SyncConfigured = p.runner.IsConfigured()
	}
	status.LastSyncAt = lastSync
	return status, nil
}
