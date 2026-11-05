package sqlite

import (
	"database/sql"
	"errors"
	"fmt"

	"github.com/simhozebs/net-worth-estimator/backend/internal/store"
	"github.com/simhozebs/net-worth-estimator/backend/internal/types"
)

// CreateScheduleClaimingPosting creates a schedule and records an existing
// transaction as its first occurrence in one transaction. The transaction is
// not modified.
func (s *sqliteStore) CreateScheduleClaimingPosting(schedule types.Schedule, postingID, occurrenceDate string) (types.Schedule, error) {
	if schedule.ID == "" {
		id, err := newRowID()
		if err != nil {
			return types.Schedule{}, err
		}
		schedule.ID = id
	}
	err := withRowTx(s.db, func(tx *userTx) error {
		var exists int
		if err := tx.QueryRow(`SELECT 1 FROM postings WHERE id = ? AND user_id = :user_id`, postingID).Scan(&exists); err != nil {
			if errors.Is(err, sql.ErrNoRows) {
				return store.NotFound(postingID)
			}
			return fmt.Errorf("find transaction %s: %w", postingID, err)
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
			`INSERT INTO posting_claims (posting_id, fulfills_rule_id, fulfills_occurrence_date, user_id)
			 VALUES (?,?,?, :user_id)
			 ON CONFLICT(user_id, posting_id) DO UPDATE SET
			   fulfills_rule_id = excluded.fulfills_rule_id,
			   fulfills_occurrence_date = excluded.fulfills_occurrence_date`,
			postingID, schedule.ID, occurrenceDate,
		); err != nil {
			return fmt.Errorf("claim transaction %s for schedule %s: %w", postingID, schedule.ID, err)
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

// DeleteScheduleCreatingPosting removes a schedule and records the one-time
// transaction that actually happened in its place. Occurrence claims that
// pointed at the schedule are removed; the transactions they belonged to
// remain as facts.
func (s *sqliteStore) DeleteScheduleCreatingPosting(scheduleID string, posting types.Posting) (types.Posting, error) {
	if posting.ID == "" {
		id, err := newRowID()
		if err != nil {
			return types.Posting{}, err
		}
		posting.ID = id
	}
	posting.Source = store.SourceUser
	err := withRowTx(s.db, func(tx *userTx) error {
		if _, err := tx.Exec(
			`DELETE FROM posting_claims WHERE fulfills_rule_id = ? AND user_id = :user_id`,
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
		if err := claimRowID(tx, posting.ID, "posting"); err != nil {
			return err
		}
		position, err := nextTablePosition(tx, "postings")
		if err != nil {
			return err
		}
		return insertPosting(tx, position, &posting, store.SourceUser)
	})
	if err != nil {
		return types.Posting{}, err
	}
	if err := s.markDirtyStart(); err != nil {
		return types.Posting{}, err
	}
	return posting, nil
}
