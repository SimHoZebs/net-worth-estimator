package sqlite

import (
	"database/sql"
	"encoding/json"
	"fmt"
	"strconv"
	"strings"
	"time"

	"github.com/simhozebs/net-worth-estimator/backend/internal/store"
	"github.com/simhozebs/net-worth-estimator/backend/internal/types"
)

// Transaction categories are sidecar assignments: one category per posting,
// never a taxonomy table. Bank values are hints. A user assignment always
// wins, a supported bank value replaces an inferred one, and clearing a user
// assignment restores the last supported bank value when one exists.
//
// Writes stay outside withRowTx's model-revision path: categories do not
// change amounts, dates, accounts, or projections, so they never invalidate a
// financial model or a cached projection.

const categoryChunkSize = 200

// ListCategoryUsers discovers user scopes with bank postings. The worker uses
// it to resume after restart without a queue table.
func (d *Database) ListCategoryUsers() ([]string, error) {
	rows, err := d.db.Query(`SELECT DISTINCT p.user_id FROM postings p
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

func ensureCategorySchema(tx *userTx) error {
	var count int
	if err := tx.Tx.QueryRow(`SELECT COUNT(*) FROM sqlite_master WHERE type = 'table' AND name = 'posting_categories'`).Scan(&count); err != nil {
		return err
	}
	if count == 1 {
		return nil
	}
	_, err := tx.Tx.Exec(postingCategoriesDDL)
	return err
}

func ensureCategorySchemaDB(db *userDB) error {
	var count int
	if err := db.DB.QueryRow(`SELECT COUNT(*) FROM sqlite_master WHERE type = 'table' AND name = 'posting_categories'`).Scan(&count); err != nil {
		return err
	}
	if count == 1 {
		return nil
	}
	_, err := db.DB.Exec(postingCategoriesDDL)
	return err
}

// LoadPostingCategories returns assignments for the named postings. Missing
// rows mean uncategorized.
func (s *sqliteStore) LoadPostingCategories(postingIDs []string) (map[string]types.PostingCategory, error) {
	out := map[string]types.PostingCategory{}
	if len(postingIDs) == 0 {
		return out, nil
	}
	if err := ensureCategorySchemaDB(s.db); err != nil {
		return nil, fmt.Errorf("ensure posting categories: %w", err)
	}
	for start := 0; start < len(postingIDs); start += categoryChunkSize {
		end := start + categoryChunkSize
		if end > len(postingIDs) {
			end = len(postingIDs)
		}
		ids := postingIDs[start:end]
		placeholders := make([]string, len(ids))
		args := make([]any, 0, len(ids))
		for index, id := range ids {
			placeholders[index] = "?"
			args = append(args, id)
		}
		rows, err := s.db.Query(`SELECT posting_id, category, source, producer FROM posting_categories
			WHERE posting_id IN (`+strings.Join(placeholders, ",")+`) AND user_id = :user_id`, args...)
		if err != nil {
			return nil, fmt.Errorf("load posting categories: %w", err)
		}
		for rows.Next() {
			var item types.PostingCategory
			if err := rows.Scan(&item.PostingID, &item.Category, &item.Source, &item.Producer); err != nil {
				rows.Close()
				return nil, err
			}
			out[item.PostingID] = item
		}
		if err := rows.Err(); err != nil {
			rows.Close()
			return nil, err
		}
		rows.Close()
	}
	return out, nil
}

// SetUserPostingCategory stores one owner choice. Nil clears the override.
func (s *sqliteStore) SetUserPostingCategory(postingID string, category *string) (types.PostingCategory, error) {
	result := types.PostingCategory{PostingID: postingID}
	if postingID == "" {
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
			return fmt.Errorf("ensure posting categories: %w", err)
		}
		var present int
		if err := tx.QueryRow(`SELECT 1 FROM postings WHERE id = ? AND user_id = :user_id`, postingID).Scan(&present); err != nil {
			if err == sql.ErrNoRows {
				return store.NotFound(postingID)
			}
			return fmt.Errorf("read posting %s: %w", postingID, err)
		}
		if category != nil {
			if err := writePostingCategory(tx, postingID, *category, types.CategorySourceUser, ""); err != nil {
				return err
			}
			result.Category, result.Source = *category, types.CategorySourceUser
			return nil
		}
		// Clearing an override returns to the last supported bank value.
		var raw string
		err := tx.QueryRow(`SELECT facts_json FROM transaction_source_facts WHERE posting_id = ? AND user_id = :user_id`, postingID).Scan(&raw)
		if err == nil {
			var facts types.TransactionFacts
			if json.Unmarshal([]byte(raw), &facts) == nil {
				if bankCategory, known := types.BankCategory(facts.Metadata["category"]); known {
					provider := postingProvider(tx, postingID)
					if err := writePostingCategory(tx, postingID, bankCategory, types.CategorySourceBank, provider); err != nil {
						return err
					}
					result.Category, result.Source, result.Producer = bankCategory, types.CategorySourceBank, provider
					return nil
				}
			}
		} else if err != sql.ErrNoRows {
			return fmt.Errorf("read posting facts %s: %w", postingID, err)
		}
		if _, err := tx.Exec(`DELETE FROM posting_categories WHERE posting_id = ? AND user_id = :user_id`, postingID); err != nil {
			return fmt.Errorf("clear posting category %s: %w", postingID, err)
		}
		return nil
	})
	if err != nil {
		return types.PostingCategory{}, err
	}
	return result, nil
}

// SetInferredPostingCategory stores one classifier result without replacing a
// bank or user assignment.
func (s *sqliteStore) SetInferredPostingCategory(postingID, category, producer string) error {
	category = strings.TrimSpace(category)
	if !types.ValidCategory(category) {
		return fmt.Errorf("unsupported category %q", category)
	}
	return withRowTx(s.db, func(tx *userTx) error {
		if err := ensureCategorySchema(tx); err != nil {
			return fmt.Errorf("ensure posting categories: %w", err)
		}
		var present int
		if err := tx.QueryRow(`SELECT 1 FROM postings WHERE id = ? AND user_id = :user_id`, postingID).Scan(&present); err != nil {
			if err == sql.ErrNoRows {
				return store.NotFound(postingID)
			}
			return fmt.Errorf("read posting %s: %w", postingID, err)
		}
		_, err := tx.Exec(`INSERT INTO posting_categories (posting_id, category, source, producer, updated_at, user_id)
			VALUES (?, ?, ?, ?, ?, :user_id)
			ON CONFLICT(user_id, posting_id) DO UPDATE SET
				category = excluded.category,
				source = excluded.source,
				producer = excluded.producer,
				updated_at = excluded.updated_at
			WHERE posting_categories.source = 'inferred'`,
			postingID, category, types.CategorySourceInferred, producer, time.Now().Unix())
		if err != nil {
			return fmt.Errorf("store inferred category %s: %w", postingID, err)
		}
		return nil
	})
}

// ListPostingCategoryCandidates returns uncategorized, non-void bank rows,
// newest first. Pending rows stay eligible: their assignment survives
// settlement because the posting identity is preserved.
func (s *sqliteStore) ListPostingCategoryCandidates(limit int) ([]types.PostingCategoryCandidate, error) {
	if limit <= 0 {
		limit = 100
	}
	if limit > categoryChunkSize {
		limit = categoryChunkSize
	}
	if err := ensureCategorySchemaDB(s.db); err != nil {
		return nil, fmt.Errorf("ensure posting categories: %w", err)
	}
	rows, err := s.db.Query(`SELECT p.id, p.name,
			CASE WHEN p.source_account_id IS NULL THEN 'in' ELSE 'out' END,
			f.facts_json
		FROM postings p
		LEFT JOIN transaction_source_facts f ON f.user_id = p.user_id AND f.posting_id = p.id
		LEFT JOIN posting_categories c ON c.user_id = p.user_id AND c.posting_id = p.id
		WHERE p.source != ?
			AND p.projection_slice_id IS NULL
			AND p.void = 0
			AND c.posting_id IS NULL
			AND p.user_id = :user_id
		ORDER BY p.posted_time DESC, p.id DESC
		LIMIT `+strconv.Itoa(limit), store.SourceUser)
	if err != nil {
		return nil, fmt.Errorf("list category candidates: %w", err)
	}
	defer rows.Close()
	candidates := []types.PostingCategoryCandidate{}
	for rows.Next() {
		var item types.PostingCategoryCandidate
		var raw sql.NullString
		if err := rows.Scan(&item.PostingID, &item.Name, &item.Direction, &raw); err != nil {
			return nil, err
		}
		if raw.Valid {
			var facts types.TransactionFacts
			if err := json.Unmarshal([]byte(raw.String), &facts); err != nil {
				return nil, fmt.Errorf("decode transaction evidence: %w", err)
			}
			item.Facts = &facts
		}
		candidates = append(candidates, item)
	}
	return candidates, rows.Err()
}

// writePostingCategory upserts one assignment. The caller chooses the source
// precedence; this helper writes exactly what it is given.
func writePostingCategory(tx *userTx, postingID, category, source, producer string) error {
	_, err := tx.Exec(`INSERT INTO posting_categories (posting_id, category, source, producer, updated_at, user_id)
		VALUES (?, ?, ?, ?, ?, :user_id)
		ON CONFLICT(user_id, posting_id) DO UPDATE SET
			category = excluded.category,
			source = excluded.source,
			producer = excluded.producer,
			updated_at = excluded.updated_at`,
		postingID, category, source, producer, time.Now().Unix())
	if err != nil {
		return fmt.Errorf("store posting category %s: %w", postingID, err)
	}
	return nil
}

// setBankPostingCategory applies one provider hint. A supported value replaces
// an inferred assignment but never a user one. An explicitly unsupported
// value clears a previous bank assignment so the classifier can try, while
// leaving inferred and user assignments alone.
func setBankPostingCategory(tx *userTx, postingID, provider string, facts types.TransactionFacts) error {
	raw := strings.TrimSpace(facts.Metadata["category"])
	if raw == "" {
		return nil
	}
	category, known := types.BankCategory(raw)
	if !known {
		_, err := tx.Exec(`DELETE FROM posting_categories WHERE posting_id = ? AND source = ? AND user_id = :user_id`,
			postingID, types.CategorySourceBank)
		return err
	}
	_, err := tx.Exec(`INSERT INTO posting_categories (posting_id, category, source, producer, updated_at, user_id)
		VALUES (?, ?, ?, ?, ?, :user_id)
		ON CONFLICT(user_id, posting_id) DO UPDATE SET
			category = excluded.category,
			source = excluded.source,
			producer = excluded.producer,
			updated_at = excluded.updated_at
		WHERE posting_categories.source != 'user'`,
		postingID, category, types.CategorySourceBank, provider, time.Now().Unix())
	if err != nil {
		return fmt.Errorf("store bank category %s: %w", postingID, err)
	}
	return nil
}

func postingProvider(tx *userTx, postingID string) string {
	var provider string
	_ = tx.QueryRow(`SELECT provider FROM posting_sync_keys WHERE posting_id = ? AND user_id = :user_id ORDER BY provider LIMIT 1`, postingID).Scan(&provider)
	return provider
}
