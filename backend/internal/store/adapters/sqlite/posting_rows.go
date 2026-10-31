package sqlite

import (
	"database/sql"
	"encoding/json"
	"fmt"

	"github.com/google/uuid"
	"github.com/simhozebs/net-worth-estimator/backend/internal/types"
)

type postingLifecycle struct {
	source        string
	pending, void bool
}

// ownerEditable reports whether an owner write may touch the row. Owner
// rows are always editable. Bank rows become editable once settled; live
// pending and void rows stay sync-owned so the sync never fights the owner.
func (l postingLifecycle) ownerEditable() bool {
	return l.source == SourceUser || (!l.pending && !l.void)
}

func postingLifecycleOf(tx *userTx, id string) (postingLifecycle, error) {
	var out postingLifecycle
	var source sql.NullString
	var pending, voided int64
	if err := tx.QueryRow(`SELECT source, pending, void FROM postings WHERE id = ? AND user_id = :user_id`, id).Scan(&source, &pending, &voided); err != nil {
		if err == sql.ErrNoRows {
			return out, NotFound(id)
		}
		return out, fmt.Errorf("read posting %s: %w", id, err)
	}
	if !source.Valid {
		return postingLifecycle{source: SourceUser}, nil
	}
	out.source, out.pending, out.void = source.String, pending != 0, voided != 0
	return out, nil
}

// CreatePosting inserts one owner posting. Empty IDs get a UUIDv7.
func (s *sqliteStore) CreatePosting(posting types.Posting) (types.Posting, error) {
	if posting.ID == "" {
		id, err := newRowID()
		if err != nil {
			return types.Posting{}, err
		}
		posting.ID = id
	}
	parsed, err := uuid.Parse(posting.ID)
	if err != nil || parsed.String() != posting.ID {
		return types.Posting{}, InvalidID(posting.ID)
	}
	posting.Source, posting.Pending, posting.ExecutionOrder = SourceUser, false, 0
	posting.Void = false
	err = withRowTx(s.db, func(tx *userTx) error {
		if err := claimRowID(tx, posting.ID, "posting"); err != nil {
			return err
		}
		position, err := nextTablePosition(tx, "postings")
		if err != nil {
			return err
		}
		return insertPosting(tx, position, &posting, SourceUser)
	})
	if err != nil {
		return types.Posting{}, err
	}
	return posting, nil
}

// UpdatePosting preserves the parent row, its order, and dependent evidence.
func (s *sqliteStore) UpdatePosting(posting types.Posting) (types.Posting, error) {
	err := withRowTx(s.db, func(tx *userTx) error {
		lifecycle, err := postingLifecycleOf(tx, posting.ID)
		if err != nil {
			return err
		}
		if !lifecycle.ownerEditable() {
			return SyncOwned(posting.ID)
		}
		// Owner writes change values only. Source, pending, and void stay
		// as stored so bank rows keep their provenance and lifecycle.
		posting.Source, posting.Pending, posting.Void = lifecycle.source, lifecycle.pending, lifecycle.void
		if err := tx.QueryRow(`SELECT execution_order FROM postings WHERE id = ? AND user_id = :user_id`, posting.ID).Scan(&posting.ExecutionOrder); err != nil {
			return err
		}
		destinations, err := json.Marshal(posting.Destinations)
		if err != nil {
			return err
		}
		amount, err := json.Marshal(posting.Amount)
		if err != nil {
			return err
		}
		var rule, date any
		if posting.Claim != nil {
			rule, date = posting.Claim.RuleID, posting.Claim.OccurrenceDate
		}
		if _, err := tx.Exec(`UPDATE postings SET name = ?, source_account_id = ?, destinations = ?, amount_resolution_json = ?, posted_time = ?, transaction_time = ?, fulfills_rule_id = ?, fulfills_occurrence_date = ?, enabled = ?, pending = 0 WHERE id = ? AND user_id = :user_id`,
			posting.Name, nullable(posting.SourceAccountID), string(destinations), string(amount), posting.PostedTime, posting.TransactionTime, rule, date, boolToInt(posting.Enabled), posting.ID); err != nil {
			return err
		}
		return nil
	})
	if err != nil {
		return types.Posting{}, err
	}
	return posting, nil
}

func (s *sqliteStore) DeletePosting(id string) error {
	return withRowTx(s.db, func(tx *userTx) error {
		lifecycle, err := postingLifecycleOf(tx, id)
		if err != nil {
			return err
		}
		// Owner rows are always removable. A void bank-owned row is removable
		// too: it moves nothing in the replay, and its bridge key is already
		// gone from the feed (vanished rows are reconciled from absence), so
		// there is nothing for a later sync to rejoin. Only pending rows
		// stay sync-owned here: pending seeds refresh in place on every feed.
		// (Settled rows stay deletable at the store but hidden in the UI:
		// deleting one cascades its sync keys, and the key stays in later
		// feeds, so the next sync would re-import it under a new ID.)
		voidBankRow := lifecycle.source != SourceUser && lifecycle.source != "" && !lifecycle.pending && lifecycle.void
		if !lifecycle.ownerEditable() && !voidBankRow {
			return SyncOwned(id)
		}
		// Sync keys cascade with the row: posting_sync_keys references
		// postings ON DELETE CASCADE.
		if _, err := tx.Exec(`DELETE FROM postings WHERE id = ? AND user_id = :user_id`, id); err != nil {
			return err
		}
		return releaseRowID(tx, id)
	})
}

func (s *sqliteStore) MovePosting(id, beforeID string) error {
	return withRowTx(s.db, func(tx *userTx) error { return moveRow(tx, RowPosting, "", id, beforeID) })
}

// ConvertPostingToRule moves one posting across to a recurrence rule in a
// single transaction. The entity ID stays claimed, the rule appends at the
// end of the execution order. Sync-owned bank rows stay put: convert refuses
// live pending and void rows. (Delete instead allows removing a void bank
// row; see DeletePosting.)
func (s *sqliteStore) ConvertPostingToRule(postingID string, rule types.RecurrenceRule) (types.RecurrenceRule, error) {
	rule.ID = postingID
	err := withRowTx(s.db, func(tx *userTx) error {
		lifecycle, err := postingLifecycleOf(tx, postingID)
		if err != nil {
			return err
		}
		if !lifecycle.ownerEditable() {
			return SyncOwned(postingID)
		}
		if _, err := tx.Exec(`DELETE FROM postings WHERE id = ? AND user_id = :user_id`, postingID); err != nil {
			return fmt.Errorf("convert posting %s: %w", postingID, err)
		}
		position, err := nextTablePosition(tx, "recurrence_rules")
		if err != nil {
			return err
		}
		return insertRule(tx, position, &rule)
	})
	if err != nil {
		return types.RecurrenceRule{}, err
	}
	return rule, nil
}

// ConvertRuleToPosting moves one recurrence rule across to a posting in a
// single transaction. The entity ID stays claimed and the posting appends
// at the end. The new posting is owner-authored, like a created posting.
func (s *sqliteStore) ConvertRuleToPosting(ruleID string, posting types.Posting) (types.Posting, error) {
	posting.ID = ruleID
	posting.Source, posting.Pending, posting.Void, posting.ExecutionOrder = SourceUser, false, false, 0
	err := withRowTx(s.db, func(tx *userTx) error {
		var present int
		if err := tx.QueryRow(`SELECT 1 FROM recurrence_rules WHERE id = ? AND user_id = :user_id`, ruleID).Scan(&present); err != nil {
			if err == sql.ErrNoRows {
				return NotFound(ruleID)
			}
			return fmt.Errorf("read rule %s: %w", ruleID, err)
		}
		if _, err := tx.Exec(`DELETE FROM recurrence_rules WHERE id = ? AND user_id = :user_id`, ruleID); err != nil {
			return fmt.Errorf("convert rule %s: %w", ruleID, err)
		}
		rulePos, err := nextTablePosition(tx, "postings")
		if err != nil {
			return err
		}
		return insertPosting(tx, rulePos, &posting, SourceUser)
	})
	if err != nil {
		return types.Posting{}, err
	}
	return posting, nil
}
