package api

import (
	"context"

	"github.com/danielgtaylor/huma/v2"
	"github.com/simhozebs/net-worth-estimator/backend/internal/store"
)

type statusOutput struct {
	Body struct {
		ReadOnly       bool   `json:"readOnly"`
		SyncConfigured bool   `json:"syncConfigured"`
		SyncHost       string `json:"syncHost,omitempty"`
		// LastSyncAt is the last successful sync completion time (RFC3339
		// UTC), omitted when no sync has completed yet.
		LastSyncAt string `json:"lastSyncAt,omitempty"`
		// SyncQuotaUsed counts Bridge hits in the trailing 24 hours.
		// SyncQuotaLimit is the Bridge daily allowance.
		SyncQuotaUsed  int `json:"syncQuotaUsed"`
		SyncQuotaLimit int `json:"syncQuotaLimit"`
	}
}

func registerStatus(api huma.API, st store.Store, config Config) {
	huma.Register(api, huma.Operation{
		OperationID: "get-server-status",
		Method:      "GET",
		Path:        "/v1/status",
		Summary:     "Report server write availability and auth state",
	}, func(ctx context.Context, _ *struct{}) (*statusOutput, error) {
		output := &statusOutput{}
		output.Body.ReadOnly = config.ReadOnly
		if config.CanWrite != nil && !config.CanWrite(ctx) {
			output.Body.ReadOnly = true
		}
		output.Body.SyncConfigured = config.SyncRunner.IsConfigured()
		if output.Body.SyncConfigured {
			if host := config.SyncRunner.BridgeHost(); host != "" {
				output.Body.SyncHost = host
			} else if credential, err := st.GetSyncCredential(); err == nil && credential.BridgeHost != "" {
				output.Body.SyncHost = credential.BridgeHost
			}
		}
		lastSync, err := st.GetLastSyncTime()
		if err != nil {
			return nil, huma.Error500InternalServerError(err.Error())
		}
		output.Body.LastSyncAt = lastSync
		if config.SyncRunner != nil {
			used, limit := config.SyncRunner.QuotaUsage()
			output.Body.SyncQuotaUsed = used
			output.Body.SyncQuotaLimit = limit
		}
		return output, nil
	})
}
