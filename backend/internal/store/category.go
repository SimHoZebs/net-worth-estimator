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
	// ListTransactionCategoryCandidates returns eligible bank transactions in
	// keyset order from the durable per-user cursor, wrapping to the head once
	// when the scan reaches the end. Terminal evaluations and deferred evaluations
	// before their next attempt are excluded.
	ListTransactionCategoryCandidates(limit int) ([]types.TransactionCategoryCandidate, error)
	// RecordTransactionCategoryBatch publishes classifications and advances the
	// scan cursor atomically. The store re-reads evidence and skips stale results.
	RecordTransactionCategoryBatch(batch types.TransactionCategoryBatch) error
	// ListCategoryFeedback returns journal rows in sequence order with stable
	// zero-padded string IDs. after names the last delivered item ID
	// (empty for the head); rows at or below it are excluded. The source,
	// not the store, applies quarantine and latest-per-transaction-wins.
	ListCategoryFeedback(after string, limit int) ([]types.CategoryFeedback, error)
}
