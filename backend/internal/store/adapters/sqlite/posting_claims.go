package sqlite

import (
	"fmt"

	"github.com/simhozebs/net-worth-estimator/backend/internal/store"
	"github.com/simhozebs/net-worth-estimator/backend/internal/types"
)

// SetPostingClaims replaces occurrence claims for the named postings in one
// transaction. It touches only posting_claims (plus pending clearing when a
// pending bank row becomes a claimed occurrence) so concurrent name or
// amount edits never lose data.
func (s *sqliteStore) SetPostingClaims(claims []types.PostingClaimUpdate) ([]types.Posting, error) {
	if len(claims) == 0 {
		return []types.Posting{}, nil
	}
	updated := make([]types.Posting, 0, len(claims))
	err := withRowTx(s.db, func(tx *userTx) error {
		for _, item := range claims {
			if item.PostingID == "" {
				return store.InvalidID(item.PostingID)
			}
			if item.Claim.RuleID == "" || item.Claim.OccurrenceDate == "" {
				return fmt.Errorf("%w: posting claim requires a rule and date", store.ErrPatternToExistingRuleInvalid)
			}
			lifecycle, err := postingLifecycleOf(tx, item.PostingID)
			if err != nil {
				return err
			}
			if !lifecycle.ownerEditable() {
				return SyncOwned(item.PostingID)
			}
			var storedClaim int
			_ = tx.QueryRow(`SELECT 1 FROM posting_claims WHERE posting_id = ? AND user_id = :user_id`, item.PostingID).Scan(&storedClaim)
			claiming := lifecycle.source != SourceUser && lifecycle.pending && storedClaim == 0
			if claiming {
				if _, err := tx.Exec(`UPDATE postings SET pending = 0 WHERE id = ? AND user_id = :user_id`, item.PostingID); err != nil {
					return fmt.Errorf("clear pending for claim %s: %w", item.PostingID, err)
				}
				// A claimed pending charge now records its occurrence, so it
				// must participate in projections.
				if _, err := tx.Exec(`UPDATE posting_sim SET enabled = 1 WHERE posting_id = ? AND user_id = :user_id`, item.PostingID); err != nil {
					return fmt.Errorf("enable claim %s: %w", item.PostingID, err)
				}
			}
			if _, err := tx.Exec(`INSERT INTO posting_claims (posting_id, fulfills_rule_id, fulfills_occurrence_date, user_id) VALUES (?, ?, ?, :user_id)
				ON CONFLICT(user_id, posting_id) DO UPDATE SET fulfills_rule_id = excluded.fulfills_rule_id, fulfills_occurrence_date = excluded.fulfills_occurrence_date`,
				item.PostingID, item.Claim.RuleID, item.Claim.OccurrenceDate); err != nil {
				return fmt.Errorf("set posting claim %s: %w", item.PostingID, err)
			}
			if err := refreshVisibilityForPostingTx(tx, item.PostingID); err != nil {
				return err
			}
		}
		return nil
	})
	if err != nil {
		return nil, err
	}
	model, err := s.LoadModel()
	if err != nil {
		return nil, err
	}
	byID := make(map[string]types.Posting, len(model.Postings))
	for _, posting := range model.Postings {
		byID[posting.ID] = posting
	}
	for _, item := range claims {
		posting, ok := byID[item.PostingID]
		if !ok {
			return nil, NotFound(item.PostingID)
		}
		updated = append(updated, posting)
	}
	return updated, nil
}
