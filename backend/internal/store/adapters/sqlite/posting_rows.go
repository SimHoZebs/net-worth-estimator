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

func postingLifecycleOf(tx *planTx, id string) (postingLifecycle, error) {
	var out postingLifecycle
	var source sql.NullString
	var pending, voided int64
	if err := tx.QueryRow(`SELECT source, pending, void FROM postings WHERE id = ? AND plan_id = :plan_id`, id).Scan(&source, &pending, &voided); err != nil {
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
	err = withRowTx(s.db, func(tx *planTx) error {
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
// Purchase policy remains replace-on-write, independently of other dependents.
func (s *sqliteStore) UpdatePosting(posting types.Posting) (types.Posting, error) {
	err := withRowTx(s.db, func(tx *planTx) error {
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
		if err := tx.QueryRow(`SELECT execution_order FROM postings WHERE id = ? AND plan_id = :plan_id`, posting.ID).Scan(&posting.ExecutionOrder); err != nil {
			return err
		}
		if posting.Purchase == nil {
			// The editor never models the wishlist link: an omitted policy
			// keeps the stored one instead of dropping it.
			var priority int
			if err := tx.QueryRow(`SELECT priority FROM purchase_policies WHERE posting_id = ? AND plan_id = :plan_id`, posting.ID).Scan(&priority); err != nil {
				if err != sql.ErrNoRows {
					return fmt.Errorf("read purchase policy %s: %w", posting.ID, err)
				}
			} else {
				posting.Purchase = &types.PurchasePolicy{Priority: priority}
			}
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
		if _, err := tx.Exec(`UPDATE postings SET name = ?, source_account_id = ?, destinations = ?, amount_resolution_json = ?, posted_time = ?, transaction_time = ?, fulfills_rule_id = ?, fulfills_occurrence_date = ?, enabled = ?, pending = 0 WHERE id = ? AND plan_id = :plan_id`,
			posting.Name, nullable(posting.SourceAccountID), string(destinations), string(amount), posting.PostedTime, posting.TransactionTime, rule, date, boolToInt(posting.Enabled), posting.ID); err != nil {
			return err
		}
		if _, err := tx.Exec(`DELETE FROM purchase_policies WHERE posting_id = ? AND plan_id = :plan_id`, posting.ID); err != nil {
			return err
		}
		return insertPurchasePolicy(tx, &posting)
	})
	if err != nil {
		return types.Posting{}, err
	}
	return posting, nil
}

func (s *sqliteStore) DeletePosting(id string) error {
	return withRowTx(s.db, func(tx *planTx) error {
		lifecycle, err := postingLifecycleOf(tx, id)
		if err != nil {
			return err
		}
		if !lifecycle.ownerEditable() {
			return SyncOwned(id)
		}
		// Bank sync keys survive as tombstones: a deleted bank row is never
		// re-imported by later snapshots.
		if _, err := tx.Exec(`DELETE FROM postings WHERE id = ? AND plan_id = :plan_id`, id); err != nil {
			return err
		}
		return releaseRowID(tx, id)
	})
}

func (s *sqliteStore) MovePosting(id, beforeID string) error {
	return withRowTx(s.db, func(tx *planTx) error { return moveRow(tx, RowPosting, "", id, beforeID) })
}

// ConvertPostingToRule moves one posting across to a recurrence rule in a
// single transaction. The entity ID stays claimed, the rule appends at the
// end of the execution order, and the posting's purchase policy (if any)
// cascades away with its row. Sync-owned bank rows stay put: convert, like
// delete, refuses live pending and void rows.
func (s *sqliteStore) ConvertPostingToRule(postingID string, rule types.RecurrenceRule) (types.RecurrenceRule, error) {
	rule.ID = postingID
	err := withRowTx(s.db, func(tx *planTx) error {
		lifecycle, err := postingLifecycleOf(tx, postingID)
		if err != nil {
			return err
		}
		if !lifecycle.ownerEditable() {
			return SyncOwned(postingID)
		}
		if _, err := tx.Exec(`DELETE FROM postings WHERE id = ? AND plan_id = :plan_id`, postingID); err != nil {
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
	err := withRowTx(s.db, func(tx *planTx) error {
		var present int
		if err := tx.QueryRow(`SELECT 1 FROM recurrence_rules WHERE id = ? AND plan_id = :plan_id`, ruleID).Scan(&present); err != nil {
			if err == sql.ErrNoRows {
				return NotFound(ruleID)
			}
			return fmt.Errorf("read rule %s: %w", ruleID, err)
		}
		if _, err := tx.Exec(`DELETE FROM recurrence_rules WHERE id = ? AND plan_id = :plan_id`, ruleID); err != nil {
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
