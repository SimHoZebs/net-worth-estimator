package sqlite

import (
	"database/sql"
	"fmt"
)

// Pinned evaluations are a per-user display preference: the subset of
// evaluation instances the user wants surfaced on Outlook. They live
// outside the canonical financial model, so they never affect
// the model ETag, validation, or the row-sync diff. Ordering is
// explicit (position) and owned by the writer: SetPinnedEvaluations
// replaces the whole list.
//
// Referential rule: a pin names an existing evaluation instance. Unknown
// IDs are rejected (not-found), and deleting an evaluation drops its pin
// in the same transaction, so pins never dangle.
// ListPinnedEvaluations returns pinned evaluation instance IDs in pin order.
func (s *sqliteStore) ListPinnedEvaluations() ([]string, error) {
	rows, err := s.db.Query(`SELECT instance_id FROM pinned_evaluations WHERE user_id = :user_id ORDER BY position`)
	if err != nil {
		return nil, fmt.Errorf("list pinned evaluations: %w", err)
	}
	defer rows.Close()
	ids := []string{}
	for rows.Next() {
		var id string
		if err := rows.Scan(&id); err != nil {
			return nil, err
		}
		ids = append(ids, id)
	}
	if err := rows.Err(); err != nil {
		return nil, err
	}
	return ids, rows.Close()
}

// evaluationExists reports whether an evaluation instance is present.
func evaluationExists(tx *userTx, instanceID string) (bool, error) {
	var present int
	if err := tx.QueryRow(`SELECT 1 FROM evaluations WHERE instance_id = ? AND user_id = :user_id`, instanceID).Scan(&present); err != nil {
		if err == sql.ErrNoRows {
			return false, nil
		}
		return false, fmt.Errorf("check evaluation %s: %w", instanceID, err)
	}
	return true, nil
}

// SetPinnedEvaluations replaces the pin list. Duplicates collapse to the
// first occurrence; every ID must name a stored evaluation instance.
// Pin writes are preference writes: they run in their own transaction and
// never mark the model present.
func (s *sqliteStore) SetPinnedEvaluations(ids []string) ([]string, error) {
	seen := make(map[string]struct{}, len(ids))
	ordered := make([]string, 0, len(ids))
	for _, id := range ids {
		if id == "" {
			continue
		}
		if _, ok := seen[id]; ok {
			continue
		}
		seen[id] = struct{}{}
		ordered = append(ordered, id)
	}
	tx, err := s.db.Begin()
	if err != nil {
		return nil, err
	}
	defer tx.Rollback()
	for _, id := range ordered {
		exists, err := evaluationExists(tx, id)
		if err != nil {
			return nil, err
		}
		if !exists {
			return nil, NotFound(id)
		}
	}
	if _, err := tx.Exec(`DELETE FROM pinned_evaluations WHERE user_id = :user_id`); err != nil {
		return nil, fmt.Errorf("replace pinned evaluations: %w", err)
	}
	for position, id := range ordered {
		if _, err := tx.Exec(`INSERT INTO pinned_evaluations (instance_id, position, user_id) VALUES (?,?, :user_id)`, id, position); err != nil {
			return nil, fmt.Errorf("pin evaluation %s: %w", id, err)
		}
	}
	if err := tx.Commit(); err != nil {
		return nil, fmt.Errorf("pin commit: %w", err)
	}
	return ordered, nil
}
