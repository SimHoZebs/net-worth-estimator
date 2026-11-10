package sqlite

import (
	"fmt"

	"github.com/simhozebs/net-worth-estimator/backend/internal/store"
	"github.com/simhozebs/net-worth-estimator/backend/internal/types"
)

// SetTransactionClaims replaces occurrence claims for the named transactions in one
// transaction. It touches only transaction_claims (plus pending clearing when a
// pending bank row becomes a claimed occurrence) so concurrent name or
// amount edits never lose data.
func (s *sqliteStore) SetTransactionClaims(claims []types.TransactionClaimUpdate) ([]types.Transaction, error) {
	return s.setTransactionClaims(claims, nil)
}

func (s *sqliteStore) SetPatternTransactionClaims(findingID, actor string, claims []types.TransactionClaimUpdate) ([]types.Transaction, error) {
	return s.setTransactionClaims(claims, func(tx *userTx) error { return acceptRecurringPattern(tx, findingID, actor) })
}

func (s *sqliteStore) setTransactionClaims(claims []types.TransactionClaimUpdate, accept func(*userTx) error) ([]types.Transaction, error) {
	if len(claims) == 0 {
		return []types.Transaction{}, nil
	}
	updated := make([]types.Transaction, 0, len(claims))
	err := withRowTx(s.db, func(tx *userTx) error {
		if accept != nil {
			if err := accept(tx); err != nil {
				return err
			}
		}
		for _, item := range claims {
			if item.TransactionID == "" {
				return store.InvalidID(item.TransactionID)
			}
			if item.Claim.ScheduleID == "" || item.Claim.OccurrenceDate == "" {
				return fmt.Errorf("%w: transaction claim requires a rule and date", store.ErrPatternToExistingScheduleInvalid)
			}
			lifecycle, err := transactionLifecycleOf(tx, item.TransactionID)
			if err != nil {
				return err
			}
			if !lifecycle.ownerEditable() {
				return SyncOwned(item.TransactionID)
			}
			var storedClaim int
			_ = tx.QueryRow(`SELECT 1 FROM transaction_claims WHERE transaction_id = ? AND user_id = :user_id`, item.TransactionID).Scan(&storedClaim)
			claiming := lifecycle.source != SourceUser && lifecycle.pending && storedClaim == 0
			if claiming {
				if _, err := tx.Exec(`UPDATE transactions SET pending = 0 WHERE id = ? AND user_id = :user_id`, item.TransactionID); err != nil {
					return fmt.Errorf("clear pending for claim %s: %w", item.TransactionID, err)
				}
				// A claimed pending charge now records its occurrence, so it
				// must participate in projections.
				if _, err := tx.Exec(`UPDATE transaction_sim SET enabled = 1 WHERE transaction_id = ? AND user_id = :user_id`, item.TransactionID); err != nil {
					return fmt.Errorf("enable claim %s: %w", item.TransactionID, err)
				}
			}
			if _, err := tx.Exec(`INSERT INTO transaction_claims (transaction_id, fulfills_rule_id, fulfills_occurrence_date, user_id) VALUES (?, ?, ?, :user_id)
				ON CONFLICT(user_id, transaction_id) DO UPDATE SET fulfills_rule_id = excluded.fulfills_rule_id, fulfills_occurrence_date = excluded.fulfills_occurrence_date`,
				item.TransactionID, item.Claim.ScheduleID, item.Claim.OccurrenceDate); err != nil {
				return fmt.Errorf("set transaction claim %s: %w", item.TransactionID, err)
			}
			if err := refreshVisibilityForTransactionTx(tx, item.TransactionID); err != nil {
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
	byID := make(map[string]types.Transaction, len(model.Transactions))
	for _, transaction := range model.Transactions {
		byID[transaction.ID] = transaction
	}
	for _, item := range claims {
		transaction, ok := byID[item.TransactionID]
		if !ok {
			return nil, NotFound(item.TransactionID)
		}
		updated = append(updated, transaction)
	}
	// Claims dirty from projection start: a claim can clear a pending row
	// whose own dates predate the occurrence, and only a stored read would
	// reveal that. The uniform rule needs no reads.
	if err := s.markDirtyStart(); err != nil {
		return nil, err
	}
	return updated, nil
}
