// Package integrations defines the provider contract for external
// integrations (bank sync today, additional providers later). Each provider
// exposes a replaceable adapter behind the Provider interface; the registry
// snapshots provider-neutral connection and sync state for the management
// page. Snapshots carry display-only metadata. Secrets stay server-side and
// never enter a snapshot.
package integrations

import "context"

// SimpleFINID identifies the bank-sync provider backed by the SimpleFIN
// Bridge. It is the only registered provider; later providers register
// their own IDs without changing this contract.
const SimpleFINID = "simplefin"

// Status is the provider-neutral connection and sync snapshot rendered by
// the integrations management page.
type Status struct {
	// Connected reports whether the user has a stored credential for the
	// provider.
	Connected bool
	// SyncConfigured reports whether the server can run the provider's
	// sync for this user.
	SyncConfigured bool
	// ConnectedAt is the RFC3339 connection time, empty when disconnected.
	ConnectedAt string
	// LastSyncAt is the last successful sync completion time (RFC3339 UTC),
	// empty when no sync has completed yet.
	LastSyncAt string
	// Detail carries display-only connection metadata such as the Bridge
	// host. It must never contain a secret.
	Detail string
}

// Provider is the replaceable adapter contract. Implementations read only
// user-scoped display state; credential secrets never leave the server.
type Provider interface {
	// ID is the stable provider identifier (for example SimpleFINID).
	ID() string
	// Status snapshots the calling user's connection and sync state.
	Status(ctx context.Context) (Status, error)
}

// Entry pairs a provider ID with its user-scoped status snapshot.
type Entry struct {
	ID string
	Status
}

// Registry holds the registered provider adapters in list order.
type Registry struct {
	providers []Provider
}

// NewRegistry builds a registry from the given adapters. A nil registry
// lists no providers.
func NewRegistry(providers ...Provider) *Registry {
	return &Registry{providers: providers}
}

// IDs returns the registered provider IDs in list order.
func (r *Registry) IDs() []string {
	if r == nil {
		return nil
	}
	ids := make([]string, 0, len(r.providers))
	for _, provider := range r.providers {
		ids = append(ids, provider.ID())
	}
	return ids
}

// Snapshot returns one status entry per registered provider, in list order.
func (r *Registry) Snapshot(ctx context.Context) ([]Entry, error) {
	if r == nil {
		return nil, nil
	}
	entries := make([]Entry, 0, len(r.providers))
	for _, provider := range r.providers {
		status, err := provider.Status(ctx)
		if err != nil {
			return nil, err
		}
		entries = append(entries, Entry{ID: provider.ID(), Status: status})
	}
	return entries, nil
}
