package sqlite

import (
	"database/sql"
	"errors"
	"fmt"

	"github.com/simhozebs/net-worth-estimator/backend/internal/store"
	"github.com/simhozebs/net-worth-estimator/backend/internal/types"
)

// CreateScheduleClaimingTransaction creates a schedule and records an existing
// transaction as its first occurrence in one transaction. The transaction is
// not modified.
func (s *sqliteStore) CreateScheduleClaimingTransaction(schedule types.Schedule, transactionID, occurrenceDate string) (types.Schedule, error) {
	if schedule.ID == "" {
		id, err := newRowID()
		if err != nil {
			return types.Schedule{}, err
		}
		schedule.ID = id
	}
	err := withRowTx(s.db, func(tx *userTx) error {
		var exists int
		if err := tx.QueryRow(`SELECT 1 FROM transactions WHERE id = ? AND user_id = :user_id`, transactionID).Scan(&exists); err != nil {
			if errors.Is(err, sql.ErrNoRows) {
				return store.NotFound(transactionID)
			}
			return fmt.Errorf("find transaction %s: %w", transactionID, err)
		}
		if err := claimRowID(tx, schedule.ID, "rule"); err != nil {
			return err
		}
		position, err := nextTablePosition(tx, "recurrence_rules")
		if err != nil {
			return err
		}
		if err := insertRule(tx, position, &schedule); err != nil {
			return err
		}
		if _, err := tx.Exec(
			`INSERT INTO transaction_claims (transaction_id, fulfills_rule_id, fulfills_occurrence_date, user_id)
			 VALUES (?,?,?, :user_id)
			 ON CONFLICT(user_id, transaction_id) DO UPDATE SET
			   fulfills_rule_id = excluded.fulfills_rule_id,
			   fulfills_occurrence_date = excluded.fulfills_occurrence_date`,
			transactionID, schedule.ID, occurrenceDate,
		); err != nil {
			return fmt.Errorf("claim transaction %s for schedule %s: %w", transactionID, schedule.ID, err)
		}
		return nil
	})
	if err != nil {
		return types.Schedule{}, err
	}
	if err := s.markDirty(dirtyDay(string(schedule.StartDate))); err != nil {
		return types.Schedule{}, err
	}
	return schedule, nil
}

// DeleteScheduleCreatingTransaction removes a schedule and records the one-time
// transaction that actually happened in its place. Occurrence claims that
// pointed at the schedule are removed; the transactions they belonged to
// remain as facts.
func (s *sqliteStore) DeleteScheduleCreatingTransaction(scheduleID string, transaction types.Transaction) (types.Transaction, error) {
	if transaction.ID == "" {
		id, err := newRowID()
		if err != nil {
			return types.Transaction{}, err
		}
		transaction.ID = id
	}
	transaction.Source = store.SourceUser
	err := withRowTx(s.db, func(tx *userTx) error {
		if _, err := tx.Exec(
			`DELETE FROM transaction_claims WHERE fulfills_rule_id = ? AND user_id = :user_id`,
			scheduleID,
		); err != nil {
			return fmt.Errorf("release claims for schedule %s: %w", scheduleID, err)
		}
		result, err := tx.Exec(`DELETE FROM recurrence_rules WHERE id = ? AND user_id = :user_id`, scheduleID)
		if err != nil {
			return fmt.Errorf("delete schedule %s: %w", scheduleID, err)
		}
		affected, err := result.RowsAffected()
		if err != nil {
			return err
		}
		if affected == 0 {
			return store.NotFound(scheduleID)
		}
		if err := releaseRowID(tx, scheduleID); err != nil {
			return err
		}
		if err := claimRowID(tx, transaction.ID, "transaction"); err != nil {
			return err
		}
		position, err := nextTablePosition(tx, "transactions")
		if err != nil {
			return err
		}
		return insertTransaction(tx, position, &transaction, store.SourceUser)
	})
	if err != nil {
		return types.Transaction{}, err
	}
	if err := s.markDirtyStart(); err != nil {
		return types.Transaction{}, err
	}
	return transaction, nil
}
