package integrations

import (
	"context"

	"github.com/danielgtaylor/huma/v2"
	providers "github.com/simhozebs/net-worth-estimator/backend/internal/integrations"
)

type providerEntry struct {
	ID             string `json:"id"`
	Connected      bool   `json:"connected"`
	SyncConfigured bool   `json:"syncConfigured"`
	// ConnectedAt is the RFC3339 connection time, omitted when disconnected.
	ConnectedAt string `json:"connectedAt,omitempty"`
	// LastSyncAt is the last successful sync completion time (RFC3339 UTC),
	// omitted when no sync has completed yet.
	LastSyncAt string `json:"lastSyncAt,omitempty"`
	// Detail carries display-only connection metadata such as the Bridge
	// host. Never a secret.
	Detail string `json:"detail,omitempty"`
}

type integrationListOutput struct {
	Body struct {
		Providers []providerEntry `json:"providers"`
	}
}

// Register adds the provider-neutral integrations listing. Provider
// connect, reconnect, and disconnect stay with each provider's own
// endpoints; this listing only snapshots display-safe status.
func Register(api huma.API, registry *providers.Registry) {
	huma.Register(api, huma.Operation{
		OperationID: "list-integrations",
		Method:      "GET",
		Path:        "/v1/integrations",
		Summary:     "List integration providers with connection and sync status",
	}, func(ctx context.Context, _ *struct{}) (*integrationListOutput, error) {
		entries, err := registry.Snapshot(ctx)
		if err != nil {
			return nil, huma.Error500InternalServerError(err.Error())
		}
		output := &integrationListOutput{}
		output.Body.Providers = make([]providerEntry, 0, len(entries))
		for _, entry := range entries {
			output.Body.Providers = append(output.Body.Providers, providerEntry{
				ID:             entry.ID,
				Connected:      entry.Connected,
				SyncConfigured: entry.SyncConfigured,
				ConnectedAt:    entry.ConnectedAt,
				LastSyncAt:     entry.LastSyncAt,
				Detail:         entry.Detail,
			})
		}
		return output, nil
	})
}
