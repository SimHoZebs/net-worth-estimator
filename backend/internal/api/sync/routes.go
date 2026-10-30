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
	huma.Register(api, huma.Operation{
		OperationID: "get-sync-cards",
		Method:      "GET",
		Path:        "/cards",
		Summary:     "List per-plan SimpleFIN card accounts",
	}, s.getSyncCards)
	huma.Register(api, huma.Operation{
		OperationID: "set-sync-cards",
		Method:      "PUT",
		Path:        "/cards",
		Summary:     "Replace per-plan SimpleFIN card accounts",
	}, s.setSyncCards)
	huma.Register(api, huma.Operation{OperationID: "list-account-links", Method: "GET", Path: "/accounts", Summary: "List bridge-to-model account links"}, s.listAccountLinks)
	huma.Register(api, huma.Operation{OperationID: "save-account-link", Method: "PUT", Path: "/accounts/{bridgeAccountId}", Summary: "Link one bridge account"}, s.saveAccountLink)
	huma.Register(api, huma.Operation{OperationID: "delete-account-link", Method: "DELETE", Path: "/accounts/{bridgeAccountId}", Summary: "Unlink one bridge account"}, s.deleteAccountLink)
}
