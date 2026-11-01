package sqlite

import (
	"database/sql"
	"encoding/json"
	"errors"
	"fmt"
	"time"

	"github.com/simhozebs/net-worth-estimator/backend/internal/analysis"
	"github.com/simhozebs/net-worth-estimator/backend/internal/store"
	"github.com/simhozebs/net-worth-estimator/backend/internal/types"
)

// PreviewRecurringPromotion describes the forecast rule one confirmed
// recurring pattern would create. It reads evidence, findings, and saved
// rows only; it never writes. The active generated rule for the pattern, if
// one still exists and is enabled, is reported so approval stays singular.
func (s *sqliteStore) PreviewRecurringPromotion(findingID string) (types.RecurringPromotionPreview, error) {
	var preview types.RecurringPromotionPreview
	var anchor types.AnalysisFinding
	var detectionJSON, reviewJSON string
	err := s.db.QueryRow(`SELECT f.id, f.analysis_type, f.detection_json, f.run_id, r.version, r.input_revision,
		f.first_detected_at, f.last_checked_at, f.status, f.dismissed, f.review_json, f.feedback_revision
		FROM analysis_findings f JOIN analysis_runs r ON r.user_id = f.user_id AND r.id = f.run_id
		WHERE f.id = ? AND f.user_id = :user_id`, findingID).Scan(
		&anchor.ID, &anchor.AnalysisType, &detectionJSON, &anchor.RunID, &anchor.AnalyzerVersion,
		&anchor.InputRevision, &anchor.FirstDetectedAt, &anchor.LastCheckedAt, &anchor.Status,
		&anchor.Dismissed, &reviewJSON, &anchor.FeedbackRevision)
	if err == sql.ErrNoRows {
		return preview, store.ErrNotFound
	}
	if err != nil {
		return preview, err
	}
	if err := json.Unmarshal([]byte(detectionJSON), &anchor.AnalysisDetection); err != nil {
		return preview, err
	}
	if err := json.Unmarshal([]byte(reviewJSON), &anchor.Review); err != nil {
		return preview, err
	}
	if anchor.Kind != "recurring" {
		return preview, fmt.Errorf("%w: finding is %s", store.ErrRecurringPromotionInvalid, anchor.Kind)
	}
	occurrenceIDs := []string{}
	for _, evidence := range anchor.Evidence {
		occurrenceIDs = append(occurrenceIDs, evidence.PostingIDs...)
	}
	patternKey := analysis.RecurringPatternKey(anchor.Kind, anchor.Product, occurrenceIDs)
	model, err := s.LoadModel()
	if err != nil {
		return preview, err
	}
	existingRuleID := ""
	if link, err := s.FindRecurringPromotion(patternKey); err == nil {
		for _, rule := range model.RecurrenceRules {
			if rule.ID == link.RuleID && rule.Enabled {
				existingRuleID = link.RuleID
				break
			}
		}
	} else if !errors.Is(err, store.ErrNotFound) {
		return preview, err
	}
	facts := map[string]types.TransactionFacts{}
	if len(occurrenceIDs) > 0 {
		placeholders := ""
		args := make([]any, 0, len(occurrenceIDs))
		for i, id := range occurrenceIDs {
			if i > 0 {
				placeholders += ","
			}
			placeholders += "?"
			args = append(args, id)
		}
		rows, err := s.db.Query(`SELECT posting_id, facts_json FROM transaction_source_facts WHERE posting_id IN (`+placeholders+`) AND user_id = :user_id`, args...)
		if err != nil {
			return preview, err
		}
		defer rows.Close()
		for rows.Next() {
			var id, raw string
			if err := rows.Scan(&id, &raw); err != nil {
				return preview, err
			}
			var item types.TransactionFacts
			if err := json.Unmarshal([]byte(raw), &item); err != nil {
				return preview, err
			}
			facts[id] = item
		}
		if err := rows.Err(); err != nil {
			return preview, err
		}
	}
	preview, err = analysis.BuildRecurringPreview(analysis.RecurringPatternInput{
		Anchor:   anchor,
		Postings: model.Postings,
		Facts:    facts,
		AccountIDs: func() []string {
			ids := make([]string, 0, len(model.Accounts))
			for _, account := range model.Accounts {
				ids = append(ids, account.ID)
			}
			return ids
		}(),
		ExistingRuleID: existingRuleID,
	})
	if err != nil {
		switch {
		case errors.Is(err, analysis.ErrPatternStale):
			return preview, fmt.Errorf("%w: %v", store.ErrRecurringPromotionConflict, err)
		default:
			return preview, fmt.Errorf("%w: %v", store.ErrRecurringPromotionInvalid, err)
		}
	}
	return preview, nil
}

// FindRecurringPromotion returns the recorded pattern-to-rule link.
// A missing link reports ErrNotFound; a link whose rule was deleted or
// disabled is still returned so callers can decide what active means.
func (s *sqliteStore) FindRecurringPromotion(patternKey string) (types.RecurringPromotion, error) {
	var link types.RecurringPromotion
	err := s.db.QueryRow(`SELECT pattern_key, rule_id, created_at FROM analysis_promotions WHERE pattern_key = ? AND user_id = :user_id`, patternKey).Scan(&link.PatternKey, &link.RuleID, &link.CreatedAt)
	if err == sql.ErrNoRows {
		return link, store.ErrNotFound
	}
	return link, err
}

// RecordRecurringPromotion saves the pattern-to-rule link, replacing any
// previous link for the same pattern. Recording happens before the rule
// row is created: a link without a rule reads as inactive, so a retry
// replaces it instead of creating a second rule.
func (s *sqliteStore) RecordRecurringPromotion(link types.RecurringPromotion) error {
	if link.PatternKey == "" || link.RuleID == "" {
		return fmt.Errorf("%w: pattern and rule are required", store.ErrRecurringPromotionInvalid)
	}
	created := link.CreatedAt
	if created <= 0 {
		created = time.Now().Unix()
	}
	_, err := s.db.Exec(`INSERT INTO analysis_promotions(pattern_key, rule_id, created_at, user_id) VALUES (?, ?, ?, :user_id)
		ON CONFLICT(user_id, pattern_key) DO UPDATE SET rule_id = excluded.rule_id, created_at = excluded.created_at`, link.PatternKey, link.RuleID, created)
	return err
}

// RemoveRecurringPromotion clears the link only when it still names the
// given rule, so a failed approval never removes a concurrent winner.
func (s *sqliteStore) RemoveRecurringPromotion(patternKey, ruleID string) error {
	_, err := s.db.Exec(`DELETE FROM analysis_promotions WHERE pattern_key = ? AND rule_id = ? AND user_id = :user_id`, patternKey, ruleID)
	return err
}
