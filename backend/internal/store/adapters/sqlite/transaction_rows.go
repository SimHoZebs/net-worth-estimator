package sqlite

import (
	"database/sql"
	"encoding/json"
	"fmt"
	"time"

	"github.com/google/uuid"
	"github.com/simhozebs/net-worth-estimator/backend/internal/types"
)

type transactionLifecycle struct {
	source        string
	pending, void bool
}

// ownerEditable reports whether an owner write may touch the row. Owner
// rows are always editable. Bank rows are owner-editable, including while
// pending; only live void rows stay sync-owned so the sync never fights
// the owner.
func (l transactionLifecycle) ownerEditable() bool {
	return l.source == SourceUser || !l.void
}

func transactionLifecycleOf(tx *userTx, id string) (transactionLifecycle, error) {
	var out transactionLifecycle
	var source sql.NullString
	var pending, voided int64
	if err := tx.QueryRow(`SELECT source, pending, void FROM transactions WHERE id = ? AND user_id = :user_id`, id).Scan(&source, &pending, &voided); err != nil {
		if err == sql.ErrNoRows {
			return out, NotFound(id)
		}
		return out, fmt.Errorf("read transaction %s: %w", id, err)
	}
	if !source.Valid {
		return transactionLifecycle{source: SourceUser}, nil
	}
	out.source, out.pending, out.void = source.String, pending != 0, voided != 0
	return out, nil
}

// CreateTransaction inserts one owner transaction. Empty IDs get a UUIDv7.
func (s *sqliteStore) CreateTransaction(transaction types.Transaction) (types.Transaction, error) {
	if transaction.ID == "" {
		id, err := newRowID()
		if err != nil {
			return types.Transaction{}, err
		}
		transaction.ID = id
	}
	parsed, err := uuid.Parse(transaction.ID)
	if err != nil || parsed.String() != transaction.ID {
		return types.Transaction{}, InvalidID(transaction.ID)
	}
	transaction.Source, transaction.Pending, transaction.ExecutionOrder = SourceUser, false, 0
	transaction.Void = false
	err = withRowTx(s.db, func(tx *userTx) error {
		if err := claimRowID(tx, transaction.ID, "transaction"); err != nil {
			return err
		}
		position, err := nextTablePosition(tx, "transactions")
		if err != nil {
			return err
		}
		return insertTransaction(tx, position, &transaction, SourceUser)
	})
	if err != nil {
		return types.Transaction{}, err
	}
	if err := s.markDirty(dirtyTransaction(transaction.PostedTime, transaction.TransactionTime)); err != nil {
		return types.Transaction{}, err
	}
	return transaction, nil
}

// UpdateTransaction preserves the parent row, its order, and dependent evidence.
func (s *sqliteStore) UpdateTransaction(transaction types.Transaction) (types.Transaction, error) {
	err := withRowTx(s.db, func(tx *userTx) error {
		lifecycle, err := transactionLifecycleOf(tx, transaction.ID)
		if err != nil {
			return err
		}
		if !lifecycle.ownerEditable() {
			return SyncOwned(transaction.ID)
		}
		// Detect a pending bank charge being claimed as an occurrence: the
		// claim converts it from a pending seed into a recorded occurrence.
		var storedClaim int
		_ = tx.QueryRow(`SELECT 1 FROM transaction_claims WHERE transaction_id = ? AND user_id = :user_id`, transaction.ID).Scan(&storedClaim)
		claiming := lifecycle.source != SourceUser && lifecycle.pending && transaction.Claim != nil && storedClaim == 0
		// Owner writes change values only. Source and void stay as stored so
		// bank rows keep their provenance and lifecycle. Pending is preserved
		// for ordinary edits and cleared only when claiming. A claimed
		// pending charge now records its occurrence, so it must participate
		// in projections: claiming enables it.
		transaction.Source, transaction.Void = lifecycle.source, lifecycle.void
		if lifecycle.source == SourceUser {
			transaction.Pending = false
		} else if claiming {
			transaction.Pending, transaction.Enabled = false, true
			// Pending seeds carry no posted time. A recorded occurrence
			// needs one, so the promotion takes the bank's transaction
			// instant, matching the subscription claim body.
			if transaction.PostedTime <= 0 {
				transaction.PostedTime = transaction.TransactionTime
			}
		} else {
			transaction.Pending = lifecycle.pending
		}
		if err := tx.QueryRow(`SELECT execution_order FROM transaction_sim WHERE transaction_id = ? AND user_id = :user_id`, transaction.ID).Scan(&transaction.ExecutionOrder); err != nil {
			return err
		}
		destinations, err := json.Marshal(transaction.Destinations)
		if err != nil {
			return err
		}
		amount, err := json.Marshal(transaction.Amount)
		if err != nil {
			return err
		}
		if _, err := tx.Exec(`UPDATE transactions SET name = ?, source_account_id = ?, destination_account_ids = ?, amount_resolution_json = ?, posted_time = ?, transaction_time = ?, pending = ? WHERE id = ? AND user_id = :user_id`,
			transaction.Name, nullable(transaction.SourceAccountID), string(destinations), string(amount), transaction.PostedTime, transaction.TransactionTime, boolToInt(transaction.Pending), transaction.ID); err != nil {
			return err
		}
		if _, err := tx.Exec(`UPDATE transaction_sim SET enabled = ? WHERE transaction_id = ? AND user_id = :user_id`,
			boolToInt(transaction.Enabled), transaction.ID); err != nil {
			return err
		}
		if transaction.Claim != nil {
			if _, err := tx.Exec(`INSERT INTO transaction_claims (transaction_id, fulfills_rule_id, fulfills_occurrence_date, user_id) VALUES (?, ?, ?, :user_id)
				ON CONFLICT(user_id, transaction_id) DO UPDATE SET fulfills_rule_id = excluded.fulfills_rule_id, fulfills_occurrence_date = excluded.fulfills_occurrence_date`,
				transaction.ID, transaction.Claim.ScheduleID, transaction.Claim.OccurrenceDate); err != nil {
				return err
			}
		} else if _, err := tx.Exec(`DELETE FROM transaction_claims WHERE transaction_id = ? AND user_id = :user_id`, transaction.ID); err != nil {
			return err
		}
		// Owner edits reshape automatic visibility in the same write:
		// moving or re-dating a row updates its index slice on commit,
		// and an independent manual grant is never touched by this.
		return refreshVisibilityForTransactionTx(tx, transaction.ID)
	})
	if err != nil {
		return types.Transaction{}, err
	}
	// Updates dirty from projection start: an edit can re-date the row in
	// either direction, and only a stored read would reveal the old date.
	if err := s.markDirtyStart(); err != nil {
		return types.Transaction{}, err
	}
	return transaction, nil
}

func (s *sqliteStore) DeleteTransaction(id string) error {
	err := withRowTx(s.db, func(tx *userTx) error {
		lifecycle, err := transactionLifecycleOf(tx, id)
		if err != nil {
			return err
		}
		// Owner rows are always removable. A void bank-owned row is removable
		// too: it moves nothing in the replay, and its bridge key is already
		// gone from the feed (vanished rows are reconciled from absence), so
		// there is nothing for a later sync to rejoin. Settled and pending
		// rows are removable as well: their bank ids move to the do-not-import
		// list first, so later feeds skip them.
		voidBankRow := lifecycle.source != SourceUser && lifecycle.source != "" && !lifecycle.pending && lifecycle.void
		if !lifecycle.ownerEditable() && !voidBankRow {
			return SyncOwned(id)
		}
		// Copy the row's bank ids onto the do-not-import list before the
		// cascade drops them: a removed charge stays removed on later feeds.
		// Void holds suppress nothing: their keys already left the feed, and
		// keeping the auth key usable preserves same-key settlement.
		if !lifecycle.void {
			if err := suppressTransactionKeys(tx, id, time.Now().Unix()); err != nil {
				return fmt.Errorf("suppress transaction %s: %w", id, err)
			}
		}
		// Sync keys cascade with the row: transaction_sync_keys references
		// transactions ON DELETE CASCADE.
		if _, err := tx.Exec(`DELETE FROM transactions WHERE id = ? AND user_id = :user_id`, id); err != nil {
			return err
		}
		// A deleted transaction authorizes nothing afterwards: explicit
		// consent rows for it go in the same transaction.
		if err := deleteSharingForTransaction(tx, id); err != nil {
			return err
		}
		return releaseRowID(tx, id)
	})
	if err != nil {
		return err
	}
	return s.markDirtyStart()
}

func (s *sqliteStore) MoveTransaction(id, beforeID string) error {
	if err := withRowTx(s.db, func(tx *userTx) error {
		return moveRow(tx, RowTransaction, "", id, beforeID)
	}); err != nil {
		return err
	}
	return s.markDirtyStart()
}
