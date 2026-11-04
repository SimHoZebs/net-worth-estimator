package store

import "github.com/simhozebs/net-worth-estimator/backend/internal/types"

// CategoryStore owns per-posting category assignments. It never writes a
// financial row: category changes do not alter amounts, dates, accounts, or
// projections. Assignments are sidecar metadata and survive bank refreshes
// unless the owner replaced them.
type CategoryStore interface {
	// LoadPostingCategories returns assignments for the named postings. The
	// result is keyed by posting ID and omits uncategorized rows.
	LoadPostingCategories(postingIDs []string) (map[string]types.PostingCategory, error)
	// SetUserPostingCategory stores one owner choice. A nil category clears
	// the override: the last supported bank value is restored when present,
	// otherwise the assignment is removed so the classifier may run again.
	SetUserPostingCategory(postingID string, category *string) (types.PostingCategory, error)
	// SetInferredPostingCategory stores one classifier result. It never
	// replaces a bank or user assignment.
	SetInferredPostingCategory(postingID, category, producer string) error
	// ListPostingCategoryCandidates returns bank postings with no assignment,
	// newest first, so a classifier can fill them without blocking sync.
	ListPostingCategoryCandidates(limit int) ([]types.PostingCategoryCandidate, error)
}
