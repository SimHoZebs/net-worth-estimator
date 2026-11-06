package store

import "github.com/simhozebs/net-worth-estimator/backend/internal/types"

// CategoryStore owns per-transaction category assignments. It never writes a
// financial row: category changes do not alter amounts, dates, accounts, or
// projections. Assignments are sidecar metadata and survive bank refreshes
// unless the owner replaced them.
type CategoryStore interface {
	// LoadTransactionCategories returns assignments for the named transactions. The
	// result is keyed by transaction ID and omits uncategorized rows.
	LoadTransactionCategories(transactionIDs []string) (map[string]types.TransactionCategory, error)
	// SetUserTransactionCategory stores one owner choice. A nil category clears
	// the override: the last supported bank value is restored when present,
	// otherwise the assignment is removed so the classifier may run again.
	SetUserTransactionCategory(transactionID string, category *string) (types.TransactionCategory, error)
	// SetInferredTransactionCategory stores one classifier result. It never
	// replaces a bank or user assignment.
	SetInferredTransactionCategory(transactionID, category, producer string) error
	// ListTransactionCategoryCandidates returns bank transactions with no assignment,
	// newest first, so a classifier can fill them without blocking sync.
	ListTransactionCategoryCandidates(limit int) ([]types.TransactionCategoryCandidate, error)
}
