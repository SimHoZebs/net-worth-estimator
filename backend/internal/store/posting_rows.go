package store

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
	return l.source == SourceModel || (!l.pending && !l.void)
}

func postingLifecycleOf(tx *planTx, id string) (postingLifecycle, error) {
	var out postingLifecycle
	var source sql.NullString
	var pending, voided int64
	if err := tx.QueryRow(`SELECT source, pending, void FROM postings WHERE id = ? AND plan_id = :plan_id`, id).Scan(&source, &pending, &voided); err != nil {
		if err == sql.ErrNoRows {
			return out, &rowError{code: "not-found", id: id}
		}
		return out, fmt.Errorf("read posting %s: %w", id, err)
	}
	if !source.Valid {
		return postingLifecycle{source: SourceModel}, nil
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
		return types.Posting{}, &rowError{code: "invalid-id", id: posting.ID}
	}
	posting.Source, posting.Pending, posting.ExecutionOrder = SourceModel, false, 0
	posting.Void = false
	err = withRowTx(s.db, func(tx *planTx) error {
		if err := claimRowID(tx, posting.ID, "posting"); err != nil {
			return err
		}
		position, err := nextTablePosition(tx, "postings")
		if err != nil {
			return err
		}
		return insertPosting(tx, position, &posting, SourceModel)
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
			return &rowError{code: "sync-owned", id: posting.ID}
		}
		// Owner writes change values only. Source, pending, and void stay
		// as stored so bank rows keep their provenance and lifecycle.
		posting.Source, posting.Pending, posting.Void = lifecycle.source, lifecycle.pending, lifecycle.void
		if err := tx.QueryRow(`SELECT execution_order FROM postings WHERE id = ? AND plan_id = :plan_id`, posting.ID).Scan(&posting.ExecutionOrder); err != nil {
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
			return &rowError{code: "sync-owned", id: id}
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
