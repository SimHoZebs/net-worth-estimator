package sqlite

import (
	"database/sql"
	"encoding/json"
	"fmt"
	"strconv"

	"github.com/simhozebs/net-worth-estimator/backend/internal/types"
)

// The category journal is an append-only record of every user assign and
// clear. The sidecar answers "what is the category now"; the journal
// answers "what did the owner decide, and on what evidence". Training reads
// only the journal after a quarantine, never the sidecar.
//
// Like transaction_categories, the table is additive and self-heals through
// the ensure helpers below: fresh databases create it during setup, and
// existing databases create it on first journal read or write. There is no
// migration file. Deletes cascade exactly like the sidecar: removing a
// transaction or a user drops its journal rows, and rows are never updated
// or deleted by normal paths.
const categoryFeedbackDDL = `CREATE TABLE IF NOT EXISTS category_feedback (
	user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
	seq INTEGER PRIMARY KEY AUTOINCREMENT,
	transaction_id TEXT NOT NULL,
	action TEXT NOT NULL CHECK(action IN ('assign', 'clear')),
	category TEXT,
	name TEXT NOT NULL DEFAULT '',
	direction TEXT NOT NULL DEFAULT '',
	facts_json TEXT,
	created_at INTEGER NOT NULL,
	FOREIGN KEY(user_id, transaction_id) REFERENCES transactions(user_id, id) ON DELETE CASCADE
)`

const categoryFeedbackIndexDDL = `CREATE INDEX IF NOT EXISTS category_feedback_user_txn ON category_feedback(user_id, transaction_id, seq)`

func ensureCategoryFeedbackSchema(tx *userTx) error {
	var count int
	if err := tx.QueryRow(`SELECT COUNT(*) FROM sqlite_master WHERE type = 'table' AND name = 'category_feedback'`).Scan(&count); err != nil {
		return err
	}
	if count == 1 {
		return nil
	}
	if _, err := tx.Exec(categoryFeedbackDDL); err != nil {
		return err
	}
	_, err := tx.Exec(categoryFeedbackIndexDDL)
	return err
}

func ensureCategoryFeedbackSchemaDB(db *userDB) error {
	var count int
	if err := db.QueryRow(`SELECT COUNT(*) FROM sqlite_master WHERE type = 'table' AND name = 'category_feedback'`).Scan(&count); err != nil {
		return err
	}
	if count == 1 {
		return nil
	}
	if _, err := db.Exec(categoryFeedbackDDL); err != nil {
		return err
	}
	_, err := db.Exec(categoryFeedbackIndexDDL)
	return err
}

// formatCategoryFeedbackID renders a sequence as a fixed-width string ID so
// lexicographic order matches sequence order. The journal source reuses
// the same width for sub-item event IDs.
func formatCategoryFeedbackID(seq int64) string {
	return fmt.Sprintf("%020d", seq)
}

// parseCategoryFeedbackCursor resolves an item cursor to its sequence. The
// empty cursor is the head of the journal. Anything else must be canonical:
// exactly what the store or the journal source handed out, so a corrupt
// checkpoint fails loudly instead of silently retraining history.
func parseCategoryFeedbackCursor(after string) (int64, error) {
	if after == "" {
		return 0, nil
	}
	seq, err := strconv.ParseInt(after, 10, 64)
	if err != nil || seq < 0 || formatCategoryFeedbackID(seq) != after {
		return 0, fmt.Errorf("invalid category feedback cursor %q", after)
	}
	return seq, nil
}

// insertCategoryFeedback appends one journal row inside the caller's
// transaction. The caller writes the sidecar row first in the same closure,
// so a journal failure rolls the sidecar write back with it.
func insertCategoryFeedback(tx *userTx, transactionID, action string, category *string, name, direction string, factsRaw sql.NullString, createdAt int64) error {
	if action != types.CategoryFeedbackAssign && action != types.CategoryFeedbackClear {
		return fmt.Errorf("invalid category feedback action %q", action)
	}
	var categoryValue sql.NullString
	if category != nil {
		categoryValue = sql.NullString{String: *category, Valid: true}
	}
	var factsValue sql.NullString
	if factsRaw.Valid {
		factsValue = factsRaw
	}
	_, err := tx.Exec(`INSERT INTO category_feedback (transaction_id, action, category, name, direction, facts_json, created_at, user_id) VALUES (?, ?, ?, ?, ?, ?, ?, :user_id)`,
		transactionID, action, categoryValue, name, direction, factsValue, createdAt)
	if err != nil {
		return fmt.Errorf("journal category feedback %s: %w", transactionID, err)
	}
	return nil
}

// ListCategoryFeedback returns journal rows in sequence order. after is a
// zero-padded sequence ID (empty for the head); the row at or below it is
// excluded. Quarantine and latest-per-transaction-wins live in the journal
// feedback source in the categorization package, not here.
func (s *sqliteStore) ListCategoryFeedback(after string, limit int) ([]types.CategoryFeedback, error) {
	base, err := parseCategoryFeedbackCursor(after)
	if err != nil {
		return nil, err
	}
	if limit <= 0 {
		limit = 200
	}
	if limit > 1000 {
		limit = 1000
	}
	if err := ensureCategoryFeedbackSchemaDB(s.db); err != nil {
		return nil, fmt.Errorf("ensure category feedback: %w", err)
	}
	rows, err := s.db.Query(`SELECT seq, transaction_id, action, category, name, direction, facts_json, created_at
		FROM category_feedback WHERE seq > ? AND user_id = :user_id ORDER BY seq LIMIT `+strconv.Itoa(limit), base)
	if err != nil {
		return nil, fmt.Errorf("list category feedback: %w", err)
	}
	defer rows.Close()
	items := []types.CategoryFeedback{}
	for rows.Next() {
		var item types.CategoryFeedback
		var category sql.NullString
		var factsRaw sql.NullString
		if err := rows.Scan(&item.Seq, &item.TransactionID, &item.Action, &category, &item.Name, &item.Direction, &factsRaw, &item.CreatedAt); err != nil {
			return nil, err
		}
		item.ID = formatCategoryFeedbackID(item.Seq)
		if category.Valid {
			value := category.String
			item.Category = &value
		}
		if factsRaw.Valid {
			var facts types.TransactionFacts
			if err := json.Unmarshal([]byte(factsRaw.String), &facts); err != nil {
				return nil, fmt.Errorf("decode category feedback evidence: %w", err)
			}
			item.Facts = &facts
		}
		items = append(items, item)
	}
	return items, rows.Err()
}

// ListRecentUserCategories returns transactions whose latest journal row is
// a user assignment, newest first, with bank evidence joined. A later clear
// suppresses the transaction: the owner's current intent is uncategorized,
// so there is nothing to compare against. The disagree monitor bounds its
// sample through this read; it never trains the learner directly.
func (s *sqliteStore) ListRecentUserCategories(limit int) ([]types.UserCategoryLabel, error) {
	if limit <= 0 {
		limit = 20
	}
	if limit > 100 {
		limit = 100
	}
	if err := ensureCategoryFeedbackSchemaDB(s.db); err != nil {
		return nil, fmt.Errorf("ensure category feedback: %w", err)
	}
	rows, err := s.db.Query(`SELECT j.transaction_id, j.category, t.name,
			CASE WHEN t.source_account_id IS NULL THEN 'in' ELSE 'out' END,
			f.facts_json
		FROM category_feedback j
		JOIN transactions t ON t.user_id = j.user_id AND t.id = j.transaction_id
		LEFT JOIN transaction_source_facts f ON f.user_id = j.user_id AND f.transaction_id = j.transaction_id
		WHERE j.user_id = :user_id AND j.action = 'assign'
			AND j.seq = (SELECT MAX(m.seq) FROM category_feedback m WHERE m.user_id = j.user_id AND m.transaction_id = j.transaction_id)
		ORDER BY j.seq DESC LIMIT ` + strconv.Itoa(limit))
	if err != nil {
		return nil, fmt.Errorf("list recent user categories: %w", err)
	}
	defer rows.Close()
	labels := []types.UserCategoryLabel{}
	for rows.Next() {
		var item types.UserCategoryLabel
		var raw sql.NullString
		if err := rows.Scan(&item.TransactionID, &item.Category, &item.Name, &item.Direction, &raw); err != nil {
			return nil, err
		}
		if raw.Valid {
			var facts types.TransactionFacts
			if err := json.Unmarshal([]byte(raw.String), &facts); err != nil {
				return nil, fmt.Errorf("decode transaction evidence: %w", err)
			}
			item.Facts = &facts
		}
		labels = append(labels, item)
	}
	return labels, rows.Err()
}
