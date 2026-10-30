package model

import (
	"github.com/danielgtaylor/huma/v2"
	"github.com/simhozebs/net-worth-estimator/backend/internal/receipts"
	"github.com/simhozebs/net-worth-estimator/backend/internal/store"
)

type handler struct {
	store    store.Store
	receipts *receipts.Service
	readOnly bool
}

// Register adds canonical model reads and writes to the shared Huma API.
func Register(api huma.API, st store.Store, receiptService *receipts.Service, readOnly bool) {
	s := &handler{store: st, receipts: receiptService, readOnly: readOnly}
	api = huma.NewGroup(api, "/v1")
	s.registerPlannedPurchaseRoutes(api)
	huma.Register(api, huma.Operation{OperationID: "get-safe-spending-settings", Method: "GET", Path: "/safe-spending-settings", Summary: "Load safe card spending settings"}, s.getSafeSpendingSettings)
	huma.Register(api, huma.Operation{OperationID: "set-safe-spending-settings", Method: "PUT", Path: "/safe-spending-settings", Summary: "Save safe card spending settings"}, s.setSafeSpendingSettings)
	huma.Register(api, huma.Operation{
		OperationID: "get-financial-model",
		Method:      "GET",
		Path:        "/financial-model",
		Summary:     "Load the canonical financial model with diagnostics",
	}, s.getModel)
	huma.Register(api, huma.Operation{OperationID: "list-account-balances", Method: "GET", Path: "/accounts/balances", Summary: "List accounts with balances as of a date"}, s.listAccountBalances)
	huma.Register(api, huma.Operation{OperationID: "create-account", Method: "POST", Path: "/accounts", Summary: "Create one account"}, s.createAccount)
	huma.Register(api, huma.Operation{OperationID: "update-account", Method: "PATCH", Path: "/accounts/{id}", Summary: "Replace one account"}, s.updateAccount)
	huma.Register(api, huma.Operation{OperationID: "delete-account", Method: "DELETE", Path: "/accounts/{id}", Summary: "Delete one account"}, s.deleteAccount)
	huma.Register(api, huma.Operation{OperationID: "move-account", Method: "POST", Path: "/accounts/reorder", Summary: "Move one account"}, s.moveAccount)
	huma.Register(api, huma.Operation{OperationID: "list-transactions", Method: "GET", Path: "/transactions", Summary: "List transactions touching an account"}, s.listTransactions)
	huma.Register(api, huma.Operation{OperationID: "list-transaction-catalog", Method: "GET", Path: "/transactions/catalog", Summary: "List transaction reference triples"}, s.listTransactionCatalog)
	huma.Register(api, huma.Operation{OperationID: "create-posting", Method: "POST", Path: "/postings", Summary: "Create one posting"}, s.createPosting)
	huma.Register(api, huma.Operation{OperationID: "update-posting", Method: "PATCH", Path: "/postings/{id}", Summary: "Replace one posting"}, s.updatePosting)
	huma.Register(api, huma.Operation{OperationID: "delete-posting", Method: "DELETE", Path: "/postings/{id}", Summary: "Delete one posting"}, s.deletePosting)
	huma.Register(api, huma.Operation{OperationID: "move-posting", Method: "POST", Path: "/postings/reorder", Summary: "Move one posting"}, s.movePosting)
	huma.Register(api, huma.Operation{OperationID: "create-rule", Method: "POST", Path: "/recurrence-rules", Summary: "Create one recurrence rule"}, s.createRule)
	huma.Register(api, huma.Operation{OperationID: "update-rule", Method: "PATCH", Path: "/recurrence-rules/{id}", Summary: "Replace one recurrence rule"}, s.updateRule)
	huma.Register(api, huma.Operation{OperationID: "delete-rule", Method: "DELETE", Path: "/recurrence-rules/{id}", Summary: "Delete one recurrence rule"}, s.deleteRule)
	huma.Register(api, huma.Operation{OperationID: "move-rule", Method: "POST", Path: "/recurrence-rules/reorder", Summary: "Move one recurrence rule"}, s.moveRule)
	huma.Register(api, huma.Operation{OperationID: "convert-transaction", Method: "POST", Path: "/transactions/{id}/convert", Summary: "Move one transaction across the posting/rule tables"}, s.convertTransaction)
	huma.Register(api, huma.Operation{OperationID: "list-checkpoints", Method: "GET", Path: "/checkpoints", Summary: "List balance checkpoints for an account and window"}, s.listCheckpoints)
	huma.Register(api, huma.Operation{OperationID: "save-checkpoint", Method: "POST", Path: "/checkpoints", Summary: "Upsert one balance checkpoint"}, s.saveCheckpoint)
	huma.Register(api, huma.Operation{OperationID: "delete-checkpoint", Method: "DELETE", Path: "/checkpoints", Summary: "Delete one balance checkpoint"}, s.deleteCheckpoint)
	huma.Register(api, huma.Operation{OperationID: "list-evaluation-summary", Method: "GET", Path: "/evaluations/summary", Summary: "List evaluation identity and configs"}, s.listEvaluationSummary)
	huma.Register(api, huma.Operation{OperationID: "create-evaluation", Method: "POST", Path: "/evaluations", Summary: "Create one evaluation"}, s.createEvaluation)
	huma.Register(api, huma.Operation{OperationID: "update-evaluation", Method: "PATCH", Path: "/evaluations/{instanceId}", Summary: "Replace one evaluation"}, s.updateEvaluation)
	huma.Register(api, huma.Operation{OperationID: "delete-evaluation", Method: "DELETE", Path: "/evaluations/{instanceId}", Summary: "Delete one evaluation"}, s.deleteEvaluation)
	huma.Register(api, huma.Operation{OperationID: "move-evaluation", Method: "POST", Path: "/evaluations/reorder", Summary: "Move one evaluation"}, s.moveEvaluation)
	huma.Register(api, huma.Operation{OperationID: "list-amount-presets", Method: "GET", Path: "/amount-presets", Summary: "List saved amount recipes"}, s.listPresets)
	huma.Register(api, huma.Operation{OperationID: "create-amount-preset", Method: "POST", Path: "/amount-presets", Summary: "Create one amount recipe"}, s.createPreset)
	huma.Register(api, huma.Operation{OperationID: "update-amount-preset", Method: "PATCH", Path: "/amount-presets/{id}", Summary: "Replace one amount recipe"}, s.updatePreset)
	huma.Register(api, huma.Operation{OperationID: "delete-amount-preset", Method: "DELETE", Path: "/amount-presets/{id}", Summary: "Delete one amount recipe"}, s.deletePreset)
	huma.Register(api, huma.Operation{OperationID: "move-amount-preset", Method: "POST", Path: "/amount-presets/reorder", Summary: "Move one amount recipe"}, s.movePreset)
	huma.Register(api, huma.Operation{OperationID: "save-payment-terms", Method: "POST", Path: "/payment-terms", Summary: "Upsert payment terms for one account"}, s.savePaymentTerms)
	huma.Register(api, huma.Operation{OperationID: "delete-payment-terms", Method: "DELETE", Path: "/payment-terms/{accountId}", Summary: "Delete payment terms for one account"}, s.deletePaymentTerms)
	huma.Register(api, huma.Operation{OperationID: "get-pinned-evaluations", Method: "GET", Path: "/pinned-evaluations", Summary: "List pinned evaluation instance IDs"}, s.getPinnedEvaluations)
	huma.Register(api, huma.Operation{OperationID: "set-pinned-evaluations", Method: "PUT", Path: "/pinned-evaluations", Summary: "Replace pinned evaluation instance IDs"}, s.setPinnedEvaluations)
	huma.Register(api, huma.Operation{
		OperationID: "get-amount-resolvers",
		Method:      "GET",
		Path:        "/amount-resolvers",
		Summary:     "List registered amount resolvers and providers",
	}, s.getAmountResolvers)
}
