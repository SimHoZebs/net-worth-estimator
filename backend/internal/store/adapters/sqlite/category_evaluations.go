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

const (
	categoryRetryInitial = 15 * time.Second
	categoryRetryMaximum = time.Hour
)

// ListTransactionCategoryCandidates scans eligible uncategorized bank rows in
// (posted_time,id) keyset order. When the cursor reaches the end, the same call
// wraps once to eligible rows at the head. Terminal evaluations and deferred
// evaluations before next_attempt_at are excluded.
func (s *sqliteStore) ListTransactionCategoryCandidates(limit int) ([]types.TransactionCategoryCandidate, error) {
	if limit <= 0 {
		limit = 100
	}
	if limit > categoryChunkSize {
		limit = categoryChunkSize
	}
	if err := ensureCategorySchemaDB(s.db); err != nil {
		return nil, fmt.Errorf("ensure transaction categories: %w", err)
	}
	cursor, hasCursor, err := s.categoryScanCursor()
	if err != nil {
		return nil, err
	}
	baseWhere := `WHERE p.source != ?
		AND p.projection_slice_id IS NULL
		AND p.void = 0
		AND c.transaction_id IS NULL
		AND (e.transaction_id IS NULL OR (e.outcome = 'deferred' AND e.next_attempt_at <= ?))`
	baseArgs := []any{store.SourceUser, time.Now().Unix()}
	if !hasCursor {
		candidates, err := s.queryCategoryCandidates(baseWhere, baseArgs, limit+1)
		if err != nil {
			return nil, err
		}
		return trimCategoryCandidates(candidates, limit), nil
	}

	afterWhere := baseWhere + ` AND (p.posted_time > ? OR (p.posted_time = ? AND p.id > ?))`
	afterArgs := append(append([]any(nil), baseArgs...), cursor.PostedTime, cursor.PostedTime, cursor.TransactionID)
	after, err := s.queryCategoryCandidates(afterWhere, afterArgs, limit+1)
	if err != nil {
		return nil, err
	}
	if len(after) > limit {
		return trimCategoryCandidates(after, limit), nil
	}
	remaining := limit - len(after)
	if remaining == 0 {
		return after, nil
	}

	// With no rows after the cursor, include the cursor row itself: it may have
	// become eligible after an evidence change or explicit clear. Otherwise the
	// strict head bound avoids duplicating rows already returned after the cursor.
	operator := "<"
	if len(after) == 0 {
		operator = "<="
	}
	headWhere := baseWhere + ` AND (p.posted_time ` + operator + ` ? OR (p.posted_time = ? AND p.id ` + operator + ` ?))`
	headArgs := append(append([]any(nil), baseArgs...), cursor.PostedTime, cursor.PostedTime, cursor.TransactionID)
	head, err := s.queryCategoryCandidates(headWhere, headArgs, remaining+1)
	if err != nil {
		return nil, err
	}
	return append(after, trimCategoryCandidates(head, remaining)...), nil
}

func (s *sqliteStore) categoryScanCursor() (types.TransactionCategoryCursor, bool, error) {
	var cursor types.TransactionCategoryCursor
	err := s.db.QueryRow(`SELECT posted_time, transaction_id FROM category_scan_progress WHERE user_id = :user_id`).Scan(&cursor.PostedTime, &cursor.TransactionID)
	if err == sql.ErrNoRows {
		return cursor, false, nil
	}
	if err != nil {
		return cursor, false, fmt.Errorf("read category scan cursor: %w", err)
	}
	return cursor, true, nil
}

func (s *sqliteStore) queryCategoryCandidates(where string, args []any, limit int) ([]types.TransactionCategoryCandidate, error) {
	query := `SELECT p.id, p.name, p.posted_time,
			CASE WHEN p.source_account_id IS NULL THEN 'in' ELSE 'out' END,
			COALESCE(e.attempts, 0), f.facts_json
		FROM transactions p
		LEFT JOIN transaction_source_facts f ON f.user_id = p.user_id AND f.transaction_id = p.id
		LEFT JOIN transaction_categories c ON c.user_id = p.user_id AND c.transaction_id = p.id
		LEFT JOIN category_evaluations e ON e.user_id = p.user_id AND e.transaction_id = p.id
		` + where + ` AND p.user_id = :user_id
		ORDER BY p.posted_time, p.id
		LIMIT ` + strconv.Itoa(limit)
	rows, err := s.db.Query(query, args...)
	if err != nil {
		return nil, fmt.Errorf("list category candidates: %w", err)
	}
	defer rows.Close()
	candidates := []types.TransactionCategoryCandidate{}
	for rows.Next() {
		var item types.TransactionCategoryCandidate
		var raw sql.NullString
		if err := rows.Scan(&item.TransactionID, &item.Name, &item.PostedTime, &item.Direction, &item.Attempts, &raw); err != nil {
			return nil, err
		}
		factsJSON := ""
		if raw.Valid {
			factsJSON = raw.String
			var facts types.TransactionFacts
			if err := json.Unmarshal([]byte(raw.String), &facts); err != nil {
				return nil, fmt.Errorf("decode transaction evidence: %w", err)
			}
			item.Facts = &facts
		}
		item.EvidenceHash = types.CategoryEvidenceHash(item.Name, item.Direction, factsJSON)
		candidates = append(candidates, item)
	}
	return candidates, rows.Err()
}

func trimCategoryCandidates(candidates []types.TransactionCategoryCandidate, limit int) []types.TransactionCategoryCandidate {
	if len(candidates) > limit {
		return candidates[:limit]
	}
	return candidates
}

// RecordTransactionCategoryBatch publishes every current result and the scan
// cursor in one short transaction. Provider calls happen before this method.
func (s *sqliteStore) RecordTransactionCategoryBatch(batch types.TransactionCategoryBatch) error {
	if strings.TrimSpace(batch.ClassifierVersion) == "" {
		return fmt.Errorf("category classification requires a version")
	}
	if len(batch.Evaluations) == 0 || batch.Cursor.TransactionID == "" {
		return fmt.Errorf("category classification requires an evaluated batch")
	}
	return withRowTx(s.db, func(tx *userTx) error {
		if err := ensureCategorySchema(tx); err != nil {
			return fmt.Errorf("ensure transaction categories: %w", err)
		}
		now := time.Now().Unix()
		for _, evaluation := range batch.Evaluations {
			currentHash, eligible, err := currentCategoryEvidenceHash(tx, evaluation.TransactionID)
			if err != nil {
				return err
			}
			if !eligible || currentHash != evaluation.EvidenceHash {
				continue
			}
			switch evaluation.Outcome {
			case types.TransactionCategoryOutcomeAssigned:
				category := strings.TrimSpace(evaluation.Category)
				if !types.ValidCategory(category) {
					return fmt.Errorf("category classification returned an invalid assignment")
				}
				if err := writeInferredTransactionCategory(tx, evaluation.TransactionID, category, evaluation.Producer, now); err != nil {
					return fmt.Errorf("store inferred category %s: %w", evaluation.TransactionID, err)
				}
			case types.TransactionCategoryOutcomeEvaluated:
			case types.TransactionCategoryOutcomeDeferred:
			default:
				return fmt.Errorf("category classification returned an invalid outcome")
			}
			if err := upsertCategoryEvaluation(tx, batch.ClassifierVersion, evaluation, now); err != nil {
				return err
			}
		}
		_, err := tx.Exec(`INSERT INTO category_scan_progress (posted_time, transaction_id, updated_at, user_id)
			VALUES (?, ?, ?, :user_id)
			ON CONFLICT(user_id) DO UPDATE SET
				posted_time = excluded.posted_time,
				transaction_id = excluded.transaction_id,
				updated_at = excluded.updated_at`,
			batch.Cursor.PostedTime, batch.Cursor.TransactionID, now)
		if err != nil {
			return fmt.Errorf("advance category scan cursor: %w", err)
		}
		return nil
	})
}

func currentCategoryEvidenceHash(tx *userTx, transactionID string) (string, bool, error) {
	var name, direction string
	var factsRaw sql.NullString
	err := tx.QueryRow(`SELECT p.name,
			CASE WHEN p.source_account_id IS NULL THEN 'in' ELSE 'out' END,
			f.facts_json
		FROM transactions p
		LEFT JOIN transaction_source_facts f ON f.user_id = p.user_id AND f.transaction_id = p.id
		WHERE p.id = ? AND p.source != ? AND p.projection_slice_id IS NULL AND p.void = 0 AND p.user_id = :user_id`,
		transactionID, store.SourceUser).Scan(&name, &direction, &factsRaw)
	if err == sql.ErrNoRows {
		return "", false, nil
	}
	if err != nil {
		return "", false, fmt.Errorf("read category evidence: %w", err)
	}
	factsJSON := ""
	if factsRaw.Valid {
		factsJSON = factsRaw.String
	}
	return types.CategoryEvidenceHash(name, direction, factsJSON), true, nil
}

func upsertCategoryEvaluation(tx *userTx, classifierVersion string, evaluation types.TransactionCategoryEvaluation, now int64) error {
	var attempts int64
	err := tx.QueryRow(`SELECT attempts FROM category_evaluations WHERE transaction_id = ? AND user_id = :user_id`, evaluation.TransactionID).Scan(&attempts)
	if err != nil && err != sql.ErrNoRows {
		return fmt.Errorf("read category evaluation attempts: %w", err)
	}
	attempts++
	nextAttemptAt := int64(0)
	problemCode := ""
	if evaluation.Outcome == types.TransactionCategoryOutcomeDeferred {
		nextAttemptAt = now + int64(categoryRetryDelay(attempts)/time.Second)
		problemCode = types.TransactionCategoryProblemProvider
	}
	_, err = tx.Exec(`INSERT INTO category_evaluations
		(transaction_id, evidence_hash, classifier_version, outcome, attempts, next_attempt_at, problem_code, evaluated_at, user_id)
		VALUES (?, ?, ?, ?, ?, ?, ?, ?, :user_id)
		ON CONFLICT(user_id, transaction_id) DO UPDATE SET
			evidence_hash = excluded.evidence_hash,
			classifier_version = excluded.classifier_version,
			outcome = excluded.outcome,
			attempts = excluded.attempts,
			next_attempt_at = excluded.next_attempt_at,
			problem_code = excluded.problem_code,
			evaluated_at = excluded.evaluated_at`,
		evaluation.TransactionID, evaluation.EvidenceHash, classifierVersion, evaluation.Outcome, attempts, nextAttemptAt, problemCode, now)
	if err != nil {
		return fmt.Errorf("store category evaluation %s: %w", evaluation.TransactionID, err)
	}
	return nil
}

func deleteCategoryEvaluation(tx *userTx, transactionID string) error {
	_, err := tx.Exec(`DELETE FROM category_evaluations WHERE transaction_id = ? AND user_id = :user_id`, transactionID)
	if err != nil {
		return fmt.Errorf("clear category evaluation %s: %w", transactionID, err)
	}
	return nil
}

func categoryRetryDelay(attempts int64) time.Duration {
	if attempts < 1 {
		attempts = 1
	}
	delay := categoryRetryInitial
	for attempt := int64(1); attempt < attempts && delay < categoryRetryMaximum; attempt++ {
		if delay > categoryRetryMaximum/2 {
			return categoryRetryMaximum
		}
		delay *= 2
	}
	if delay > categoryRetryMaximum {
		return categoryRetryMaximum
	}
	return delay
}
