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
	huma.Register(api, huma.Operation{OperationID: "create-loan", Method: "POST", Path: "/loans", Summary: "Create one visible principal and interest loan atomically"}, s.createLoan)
	huma.Register(api, huma.Operation{OperationID: "update-loan", Method: "PUT", Path: "/loans/{id}", Summary: "Update a loan and its managed rules atomically"}, s.updateLoan)
	huma.Register(api, huma.Operation{OperationID: "delete-loan", Method: "DELETE", Path: "/loans/{id}", Summary: "Delete a loan and its managed rules atomically"}, s.deleteLoan)
	huma.Register(api, huma.Operation{OperationID: "get-safe-spending-settings", Method: "GET", Path: "/safe-spending-settings", Summary: "Load safe card spending settings"}, s.getSafeSpendingSettings)
	huma.Register(api, huma.Operation{OperationID: "set-safe-spending-settings", Method: "PUT", Path: "/safe-spending-settings", Summary: "Save safe card spending settings"}, s.setSafeSpendingSettings)
	huma.Register(api, huma.Operation{
		OperationID: "get-financial-model",
		Method:      "GET",
		Path:        "/financial-model",
		Summary:     "Load the canonical financial model with diagnostics",
	}, s.getModel)
	huma.Register(api, huma.Operation{OperationID: "list-account-balances", Method: "GET", Path: "/accounts/balances", Summary: "List accounts with balances as of a date"}, s.listAccountBalances)
	huma.Register(api, huma.Operation{OperationID: "list-balance-adjustments", Method: "GET", Path: "/accounts/{id}/balance-adjustments", Summary: "List dated balance adjustments without a forecast"}, s.listBalanceAdjustments)
	huma.Register(api, huma.Operation{OperationID: "create-account", Method: "POST", Path: "/accounts", Summary: "Create one account"}, s.createAccount)
	huma.Register(api, huma.Operation{OperationID: "update-account", Method: "PATCH", Path: "/accounts/{id}", Summary: "Replace one account"}, s.updateAccount)
	huma.Register(api, huma.Operation{OperationID: "delete-account", Method: "DELETE", Path: "/accounts/{id}", Summary: "Delete one account"}, s.deleteAccount)
	huma.Register(api, huma.Operation{OperationID: "move-account", Method: "POST", Path: "/accounts/reorder", Summary: "Move one account"}, s.moveAccount)
	huma.Register(api, huma.Operation{OperationID: "list-transactions", Method: "GET", Path: "/transactions", Summary: "List recorded transactions touching an account"}, s.listTransactions)
	huma.Register(api, huma.Operation{OperationID: "record-transaction", Method: "POST", Path: "/transactions", Summary: "Record one transaction"}, s.recordTransaction)
	huma.Register(api, huma.Operation{OperationID: "amend-transaction", Method: "POST", Path: "/transactions/{id}/amend", Summary: "Amend the terms of one transaction"}, s.amendTransaction)
	huma.Register(api, huma.Operation{OperationID: "claim-occurrence", Method: "POST", Path: "/transactions/{id}/claim", Summary: "Record which schedule occurrence a transaction fulfils"}, s.claimOccurrence)
	huma.Register(api, huma.Operation{OperationID: "release-occurrence", Method: "POST", Path: "/transactions/{id}/release", Summary: "Release a transaction from its schedule occurrence"}, s.releaseOccurrence)
	huma.Register(api, huma.Operation{OperationID: "schedule-from-transaction", Method: "POST", Path: "/transactions/{id}/schedule", Summary: "Start a schedule from a recorded transaction"}, s.startScheduleFromTransaction)
	huma.Register(api, huma.Operation{OperationID: "categorize-transaction", Method: "POST", Path: "/transactions/{id}/categorize", Summary: "Set or clear one transaction category"}, s.setTransactionCategory)
	huma.Register(api, huma.Operation{OperationID: "delete-transaction", Method: "DELETE", Path: "/transactions/{id}", Summary: "Delete one recorded transaction"}, s.deleteTransaction)
	huma.Register(api, huma.Operation{OperationID: "move-transaction", Method: "POST", Path: "/transactions/{id}/move", Summary: "Move one transaction in same-day execution order"}, s.moveTransaction)
	huma.Register(api, huma.Operation{OperationID: "import-model", Method: "POST", Path: "/model/import", Summary: "Replace the reviewed model"}, s.importModel)
	huma.Register(api, huma.Operation{OperationID: "list-schedules", Method: "GET", Path: "/schedules", Summary: "List schedules touching an account"}, s.listSchedules)
	huma.Register(api, huma.Operation{OperationID: "create-schedule", Method: "POST", Path: "/schedules", Summary: "Create one schedule"}, s.createSchedule)
	huma.Register(api, huma.Operation{OperationID: "amend-schedule", Method: "POST", Path: "/schedules/{id}/amend", Summary: "Amend the terms of one schedule"}, s.amendSchedule)
	huma.Register(api, huma.Operation{OperationID: "reschedule-schedule", Method: "POST", Path: "/schedules/{id}/reschedule", Summary: "Change the cadence or window of one schedule"}, s.rescheduleSchedule)
	huma.Register(api, huma.Operation{OperationID: "delete-schedule", Method: "DELETE", Path: "/schedules/{id}", Summary: "Delete one schedule"}, s.deleteSchedule)
	huma.Register(api, huma.Operation{OperationID: "move-schedule", Method: "POST", Path: "/schedules/{id}/move", Summary: "Move one schedule in same-day execution order"}, s.moveSchedule)
	huma.Register(api, huma.Operation{OperationID: "end-schedule-with-transaction", Method: "POST", Path: "/schedules/{id}/end-with-transaction", Summary: "Record one transaction and remove its schedule"}, s.endScheduleWithTransaction)
	huma.Register(api, huma.Operation{OperationID: "list-settle-candidates", Method: "GET", Path: "/transactions/{id}/settle-candidates", Summary: "List posted charges that could settle a vanished hold"}, s.listSettleCandidates)
	huma.Register(api, huma.Operation{OperationID: "list-transaction-catalog", Method: "GET", Path: "/transactions/catalog", Summary: "List transaction and schedule references"}, s.listTransactionCatalog)
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
