package sqlite

import (
	"database/sql"
	"encoding/json"
	"fmt"
	"strings"
	"time"

	"github.com/simhozebs/net-worth-estimator/backend/internal/store"
	"github.com/simhozebs/net-worth-estimator/backend/internal/types"
)

// Transaction categories are sidecar assignments: one category per transaction,
// never a taxonomy table. Bank values are hints. A user assignment always
// wins, a supported bank value replaces an inferred one, and clearing a user
// assignment restores the last supported bank value when one exists.
//
// Writes stay outside withRowTx's model-revision path: categories do not
// change amounts, dates, accounts, or projections, so they never invalidate a
// financial model or a cached projection.

const categoryChunkSize = 200

// ListCategoryUsers discovers user scopes with bank transactions. The worker uses
// it to resume after restart without a queue table.
func (d *Database) ListCategoryUsers() ([]string, error) {
	rows, err := d.db.Query(`SELECT DISTINCT p.user_id FROM transactions p
		WHERE p.source != ? AND p.projection_slice_id IS NULL ORDER BY p.user_id`, store.SourceUser)
	if err != nil {
		return nil, fmt.Errorf("list category users: %w", err)
	}
	defer rows.Close()
	users := []string{}
	for rows.Next() {
		var user string
		if err := rows.Scan(&user); err != nil {
			return nil, err
		}
		users = append(users, user)
	}
	return users, rows.Err()
}

func categorySchemaReady(db queryer) (bool, error) {
	args := make([]any, 0, len(categorySchemaTableNames)+len(categoryTriggerNames)+len(categorySchemaIndexNames))
	for _, names := range [][]string{categorySchemaTableNames, categoryTriggerNames, categorySchemaIndexNames} {
		for _, name := range names {
			args = append(args, name)
		}
	}
	placeholders := func(names []string) string {
		values := make([]string, len(names))
		for index := range names {
			values[index] = "?"
		}
		return strings.Join(values, ",")
	}
	query := `SELECT COUNT(*) FROM sqlite_master WHERE
		(type = 'table' AND name IN (` + placeholders(categorySchemaTableNames) + `)) OR
		(type = 'trigger' AND name IN (` + placeholders(categoryTriggerNames) + `)) OR
		(type = 'index' AND name IN (` + placeholders(categorySchemaIndexNames) + `))`
	var count int
	if err := db.QueryRow(query, args...).Scan(&count); err != nil {
		return false, err
	}
	return count == len(args), nil
}

func ensureCategorySchema(tx *userTx) error {
	ready, err := categorySchemaReady(tx.Tx)
	if err != nil {
		return err
	}
	if ready {
		return nil
	}
	for _, ddl := range categorySchemaTableDDLs() {
		if _, err := tx.Exec(ddl); err != nil {
			return err
		}
	}
	for _, ddl := range categorySchemaTriggerDDLs() {
		if _, err := tx.Exec(ddl); err != nil {
			return err
		}
	}
	return nil
}

func ensureCategorySchemaDB(db *userDB) error {
	ready, err := categorySchemaReady(db.DB)
	if err != nil {
		return err
	}
	if ready {
		return nil
	}
	for _, ddl := range categorySchemaTableDDLs() {
		if _, err := db.Exec(ddl); err != nil {
			return err
		}
	}
	for _, ddl := range categorySchemaTriggerDDLs() {
		if _, err := db.Exec(ddl); err != nil {
			return err
		}
	}
	return nil
}

// LoadTransactionCategories returns assignments for the named transactions. Missing
// rows mean uncategorized.
func (s *sqliteStore) LoadTransactionCategories(transactionIDs []string) (map[string]types.TransactionCategory, error) {
	out := map[string]types.TransactionCategory{}
	if len(transactionIDs) == 0 {
		return out, nil
	}
	if err := ensureCategorySchemaDB(s.db); err != nil {
		return nil, fmt.Errorf("ensure transaction categories: %w", err)
	}
	for start := 0; start < len(transactionIDs); start += categoryChunkSize {
		end := start + categoryChunkSize
		if end > len(transactionIDs) {
			end = len(transactionIDs)
		}
		ids := transactionIDs[start:end]
		placeholders := make([]string, len(ids))
		args := make([]any, 0, len(ids))
		for index, id := range ids {
			placeholders[index] = "?"
			args = append(args, id)
		}
		rows, err := s.db.Query(`SELECT transaction_id, category, source, producer FROM transaction_categories
			WHERE transaction_id IN (`+strings.Join(placeholders, ",")+`) AND user_id = :user_id`, args...)
		if err != nil {
			return nil, fmt.Errorf("load transaction categories: %w", err)
		}
		for rows.Next() {
			var item types.TransactionCategory
			if err := rows.Scan(&item.TransactionID, &item.Category, &item.Source, &item.Producer); err != nil {
				rows.Close()
				return nil, err
			}
			out[item.TransactionID] = item
		}
		if err := rows.Err(); err != nil {
			rows.Close()
			return nil, err
		}
		rows.Close()
	}
	return out, nil
}

// SetUserTransactionCategory stores one owner choice. Nil clears the override.
func (s *sqliteStore) SetUserTransactionCategory(transactionID string, category *string) (types.TransactionCategory, error) {
	result := types.TransactionCategory{TransactionID: transactionID}
	if transactionID == "" {
		return result, store.NotFound("")
	}
	if category != nil {
		value := strings.TrimSpace(*category)
		if !types.ValidCategory(value) {
			return result, fmt.Errorf("unsupported category %q", value)
		}
		category = &value
	}
	err := withRowTx(s.db, func(tx *userTx) error {
		if err := ensureCategorySchema(tx); err != nil {
			return fmt.Errorf("ensure transaction categories: %w", err)
		}
		if err := ensureCategoryFeedbackSchema(tx); err != nil {
			return fmt.Errorf("ensure category feedback: %w", err)
		}
		var present int
		var name, direction string
		if err := tx.QueryRow(`SELECT 1, name, CASE WHEN source_account_id IS NULL THEN 'in' ELSE 'out' END FROM transactions WHERE id = ? AND user_id = :user_id`, transactionID).Scan(&present, &name, &direction); err != nil {
			if err == sql.ErrNoRows {
				return store.NotFound(transactionID)
			}
			return fmt.Errorf("read transaction %s: %w", transactionID, err)
		}
		var factsRaw sql.NullString
		if err := tx.QueryRow(`SELECT facts_json FROM transaction_source_facts WHERE transaction_id = ? AND user_id = :user_id`, transactionID).Scan(&factsRaw); err != nil && err != sql.ErrNoRows {
			return fmt.Errorf("read transaction facts %s: %w", transactionID, err)
		}
		if category != nil {
			if err := deleteCategoryEvaluation(tx, transactionID); err != nil {
				return err
			}
			if err := writeTransactionCategory(tx, transactionID, *category, types.CategorySourceUser, ""); err != nil {
				return err
			}
			// The journal row shares this transaction: a journal failure
			// rolls the sidecar write back with it, so the two never diverge.
			if err := insertCategoryFeedback(tx, transactionID, types.CategoryFeedbackAssign, category, name, direction, factsRaw, time.Now().Unix()); err != nil {
				return err
			}
			result.Category, result.Source = *category, types.CategorySourceUser
			return nil
		}
		// Clearing an override records the removed key: the sidecar row the
		// clear replaces or deletes is the owner's rejected label.
		if err := deleteCategoryEvaluation(tx, transactionID); err != nil {
			return err
		}
		var removed sql.NullString
		if err := tx.QueryRow(`SELECT category FROM transaction_categories WHERE transaction_id = ? AND user_id = :user_id`, transactionID).Scan(&removed); err != nil && err != sql.ErrNoRows {
			return fmt.Errorf("read transaction category %s: %w", transactionID, err)
		}
		var removedKey *string
		if removed.Valid {
			value := removed.String
			removedKey = &value
		}
		// Clearing an override returns to the last supported bank value.
		var raw string
		err := tx.QueryRow(`SELECT facts_json FROM transaction_source_facts WHERE transaction_id = ? AND user_id = :user_id`, transactionID).Scan(&raw)
		if err == nil {
			var facts types.TransactionFacts
			if json.Unmarshal([]byte(raw), &facts) == nil {
				if bankCategory, known := types.BankCategory(facts.Metadata["category"]); known {
					provider := transactionProvider(tx, transactionID)
					if err := writeTransactionCategory(tx, transactionID, bankCategory, types.CategorySourceBank, provider); err != nil {
						return err
					}
					if err := insertCategoryFeedback(tx, transactionID, types.CategoryFeedbackClear, removedKey, name, direction, factsRaw, time.Now().Unix()); err != nil {
						return err
					}
					result.Category, result.Source, result.Producer = bankCategory, types.CategorySourceBank, provider
					return nil
				}
			}
		} else if err != sql.ErrNoRows {
			return fmt.Errorf("read transaction facts %s: %w", transactionID, err)
		}
		if _, err := tx.Exec(`DELETE FROM transaction_categories WHERE transaction_id = ? AND user_id = :user_id`, transactionID); err != nil {
			return fmt.Errorf("clear transaction category %s: %w", transactionID, err)
		}
		if err := insertCategoryFeedback(tx, transactionID, types.CategoryFeedbackClear, removedKey, name, direction, factsRaw, time.Now().Unix()); err != nil {
			return err
		}
		return nil
	})
	if err != nil {
		return types.TransactionCategory{}, err
	}
	return result, nil
}

// SetInferredTransactionCategory stores one classifier result without replacing a
// bank or user assignment.
func (s *sqliteStore) SetInferredTransactionCategory(transactionID, category, producer string) error {
	category = strings.TrimSpace(category)
	if !types.ValidCategory(category) {
		return fmt.Errorf("unsupported category %q", category)
	}
	return withRowTx(s.db, func(tx *userTx) error {
		if err := ensureCategorySchema(tx); err != nil {
			return fmt.Errorf("ensure transaction categories: %w", err)
		}
		var present int
		if err := tx.QueryRow(`SELECT 1 FROM transactions WHERE id = ? AND user_id = :user_id`, transactionID).Scan(&present); err != nil {
			if err == sql.ErrNoRows {
				return store.NotFound(transactionID)
			}
			return fmt.Errorf("read transaction %s: %w", transactionID, err)
		}
		err := writeInferredTransactionCategory(tx, transactionID, category, producer, time.Now().Unix())
		if err != nil {
			return fmt.Errorf("store inferred category %s: %w", transactionID, err)
		}
		return nil
	})
}

// writeInferredTransactionCategory applies classifier precedence in one upsert.
// Existing bank and user assignments always win.
func writeInferredTransactionCategory(tx *userTx, transactionID, category, producer string, updatedAt int64) error {
	_, err := tx.Exec(`INSERT INTO transaction_categories (transaction_id, category, source, producer, updated_at, user_id)
		VALUES (?, ?, ?, ?, ?, :user_id)
		ON CONFLICT(user_id, transaction_id) DO UPDATE SET
			category = excluded.category,
			source = excluded.source,
			producer = excluded.producer,
			updated_at = excluded.updated_at
		WHERE transaction_categories.source = 'inferred'`,
		transactionID, category, types.CategorySourceInferred, producer, updatedAt)
	return err
}

// writeTransactionCategory upserts one assignment. The caller chooses the source
// precedence; this helper writes exactly what it is given.
func writeTransactionCategory(tx *userTx, transactionID, category, source, producer string) error {
	_, err := tx.Exec(`INSERT INTO transaction_categories (transaction_id, category, source, producer, updated_at, user_id)
		VALUES (?, ?, ?, ?, ?, :user_id)
		ON CONFLICT(user_id, transaction_id) DO UPDATE SET
			category = excluded.category,
			source = excluded.source,
			producer = excluded.producer,
			updated_at = excluded.updated_at`,
		transactionID, category, source, producer, time.Now().Unix())
	if err != nil {
		return fmt.Errorf("store transaction category %s: %w", transactionID, err)
	}
	return nil
}

// setBankTransactionCategory applies one provider hint. A supported value replaces
// an inferred assignment but never a user one. An explicitly unsupported
// value clears a previous bank assignment so the classifier can try, while
// leaving inferred and user assignments alone.
func setBankTransactionCategory(tx *userTx, transactionID, provider string, facts types.TransactionFacts) error {
	raw := strings.TrimSpace(facts.Metadata["category"])
	if raw == "" {
		return nil
	}
	category, known := types.BankCategory(raw)
	if !known {
		_, err := tx.Exec(`DELETE FROM transaction_categories WHERE transaction_id = ? AND source = ? AND user_id = :user_id`,
			transactionID, types.CategorySourceBank)
		return err
	}
	_, err := tx.Exec(`INSERT INTO transaction_categories (transaction_id, category, source, producer, updated_at, user_id)
		VALUES (?, ?, ?, ?, ?, :user_id)
		ON CONFLICT(user_id, transaction_id) DO UPDATE SET
			category = excluded.category,
			source = excluded.source,
			producer = excluded.producer,
			updated_at = excluded.updated_at
		WHERE transaction_categories.source != 'user'`,
		transactionID, category, types.CategorySourceBank, provider, time.Now().Unix())
	if err != nil {
		return fmt.Errorf("store bank category %s: %w", transactionID, err)
	}
	return nil
}

func transactionProvider(tx *userTx, transactionID string) string {
	var provider string
	_ = tx.QueryRow(`SELECT provider FROM transaction_sync_keys WHERE transaction_id = ? AND user_id = :user_id ORDER BY provider LIMIT 1`, transactionID).Scan(&provider)
	return provider
}
