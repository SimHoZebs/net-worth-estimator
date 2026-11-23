package sync

import (
	"github.com/danielgtaylor/huma/v2"
	"github.com/simhozebs/net-worth-estimator/backend/internal/simplefin"
	"github.com/simhozebs/net-worth-estimator/backend/internal/store"
)

type handler struct {
	store  store.Store
	runner *simplefin.Runner
}

// Register adds SimpleFIN configuration, account links, and sync operations.
func Register(api huma.API, st store.Store, runner *simplefin.Runner) {
	s := &handler{store: st, runner: runner}
	api = huma.NewGroup(api, "/v1/sync/simplefin")
	huma.Register(api, huma.Operation{
		OperationID: "trigger-simplefin-sync",
		Method:      "POST",
		Path:        "",
		Summary:     "Run the SimpleFIN sync (balances and pending seed)",
	}, s.triggerSync)
	huma.Register(api, huma.Operation{
		OperationID: "get-sync-credential",
		Method:      "GET",
		Path:        "/credential",
		Summary:     "Report SimpleFIN connection state (never the secret)",
	}, s.getSyncCredential)
	huma.Register(api, huma.Operation{
		OperationID: "connect-sync-credential",
		Method:      "POST",
		Path:        "/credential",
		Summary:     "Connect a SimpleFIN key from a setup token or access URL",
	}, s.connectSyncCredential)
	huma.Register(api, huma.Operation{
		OperationID: "disconnect-sync-credential",
		Method:      "DELETE",
		Path:        "/credential",
		Summary:     "Disconnect the SimpleFIN key",
	}, s.disconnectSyncCredential)
	huma.Register(api, huma.Operation{OperationID: "list-account-links", Method: "GET", Path: "/accounts", Summary: "List bridge-to-model account links"}, s.listAccountLinks)
	huma.Register(api, huma.Operation{OperationID: "supersede-simplefin-account", Method: "POST", Path: "/accounts/{bridgeAccountId}/supersede", Summary: "Replace a manual account with a linked synced account"}, s.supersedeAccount)
}
