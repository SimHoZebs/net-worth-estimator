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

// PreviewPatternToNewSchedule describes the forecast rule one confirmed
// recurring pattern would create. It reads evidence, findings, and saved
// rows only; it never writes. The active generated rule for the pattern, if
// one still exists and is enabled, is reported so approval stays singular.
func (s *sqliteStore) PreviewPatternToNewSchedule(findingID string) (types.PatternToNewSchedulePreview, error) {
	var preview types.PatternToNewSchedulePreview
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
	if !analysis.IsSchedulePatternKind(anchor.Kind) {
		return preview, fmt.Errorf("%w: finding is %s", store.ErrPatternToNewScheduleInvalid, anchor.Kind)
	}
	occurrenceIDs := []string{}
	for _, evidence := range anchor.Evidence {
		occurrenceIDs = append(occurrenceIDs, evidence.TransactionIDs...)
	}
	patternKey := analysis.RecurringPatternKey(anchor.Kind, anchor.Product, occurrenceIDs)
	model, err := s.LoadModel()
	if err != nil {
		return preview, err
	}
	existingScheduleID := ""
	if record, err := s.FindPatternToNewSchedule(patternKey); err == nil {
		for _, rule := range model.Schedules {
			if rule.ID == record.ScheduleID && rule.Enabled {
				existingScheduleID = record.ScheduleID
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
		rows, err := s.db.Query(`SELECT transaction_id, facts_json FROM transaction_source_facts WHERE transaction_id IN (`+placeholders+`) AND user_id = :user_id`, args...)
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
	preview, err = analysis.BuildPatternToNewSchedulePreview(analysis.PatternToNewScheduleInput{
		Anchor:       anchor,
		Transactions: model.Transactions,
		Facts:        facts,
		AccountIDs: func() []string {
			ids := make([]string, 0, len(model.Accounts))
			for _, account := range model.Accounts {
				ids = append(ids, account.ID)
			}
			return ids
		}(),
		ExistingScheduleID: existingScheduleID,
	})
	if err != nil {
		switch {
		case errors.Is(err, analysis.ErrPatternStale):
			return preview, fmt.Errorf("%w: %v", store.ErrPatternToNewScheduleConflict, err)
		default:
			return preview, fmt.Errorf("%w: %v", store.ErrPatternToNewScheduleInvalid, err)
		}
	}
	return preview, nil
}

// FindPatternToNewSchedule returns the recorded pattern-to-rule entry.
// A missing record reports ErrNotFound; a record whose rule was deleted or
// disabled is still returned so callers can decide what active means.
func (s *sqliteStore) FindPatternToNewSchedule(patternKey string) (types.PatternToNewSchedule, error) {
	var record types.PatternToNewSchedule
	err := s.db.QueryRow(`SELECT pattern_key, rule_id, created_at FROM analysis_promotions WHERE pattern_key = ? AND user_id = :user_id`, patternKey).Scan(&record.PatternKey, &record.ScheduleID, &record.CreatedAt)
	if err == sql.ErrNoRows {
		return record, store.ErrNotFound
	}
	return record, err
}

// RecordPatternToNewSchedule saves the pattern-to-rule record, replacing any
// previous record for the same pattern. Recording happens before the rule
// row is created: a record without a rule reads as inactive, so a retry
// replaces it instead of creating a second rule.
func (s *sqliteStore) RecordPatternToNewSchedule(record types.PatternToNewSchedule) error {
	if record.PatternKey == "" || record.ScheduleID == "" {
		return fmt.Errorf("%w: pattern and rule are required", store.ErrPatternToNewScheduleInvalid)
	}
	created := record.CreatedAt
	if created <= 0 {
		created = time.Now().Unix()
	}
	_, err := s.db.Exec(`INSERT INTO analysis_promotions(pattern_key, rule_id, created_at, user_id) VALUES (?, ?, ?, :user_id)
		ON CONFLICT(user_id, pattern_key) DO UPDATE SET rule_id = excluded.rule_id, created_at = excluded.created_at`, record.PatternKey, record.ScheduleID, created)
	return err
}

// RemovePatternToNewSchedule clears the record only when it still names the
// given rule, so a failed approval never removes a concurrent winner.
func (s *sqliteStore) RemovePatternToNewSchedule(patternKey, ruleID string) error {
	_, err := s.db.Exec(`DELETE FROM analysis_promotions WHERE pattern_key = ? AND rule_id = ? AND user_id = :user_id`, patternKey, ruleID)
	return err
}
