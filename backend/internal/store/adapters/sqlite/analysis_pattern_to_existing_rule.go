package sqlite

import (
	"database/sql"
	"encoding/json"
	"errors"
	"fmt"

	"github.com/simhozebs/net-worth-estimator/backend/internal/analysis"
	"github.com/simhozebs/net-worth-estimator/backend/internal/store"
	"github.com/simhozebs/net-worth-estimator/backend/internal/types"
)

// PreviewPatternToExistingSchedule describes how one confirmed recurring pattern would
// claim occurrences of one existing rule. It reads evidence, findings, and
// saved rows only; it never writes.
func (s *sqliteStore) PreviewPatternToExistingSchedule(findingID, ruleID string) (types.PatternToExistingSchedulePreview, error) {
	var preview types.PatternToExistingSchedulePreview
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
		return preview, fmt.Errorf("%w: finding is %s", store.ErrPatternToExistingScheduleInvalid, anchor.Kind)
	}
	occurrenceIDs := []string{}
	for _, evidence := range anchor.Evidence {
		occurrenceIDs = append(occurrenceIDs, evidence.TransactionIDs...)
	}
	seen := map[string]bool{}
	ordered := occurrenceIDs[:0]
	for _, id := range occurrenceIDs {
		if id == "" || seen[id] {
			continue
		}
		seen[id] = true
		ordered = append(ordered, id)
	}
	occurrenceIDs = ordered
	model, err := s.LoadModel()
	if err != nil {
		return preview, err
	}
	var rule *types.Schedule
	for i := range model.Schedules {
		if model.Schedules[i].ID == ruleID {
			rule = &model.Schedules[i]
			break
		}
	}
	if rule == nil {
		return preview, fmt.Errorf("%w: rule %s not found", store.ErrPatternToExistingScheduleInvalid, ruleID)
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
	preview = types.PatternToExistingSchedulePreview{
		FindingID:    anchor.ID,
		PatternKey:   analysis.RecurringPatternKey(anchor.Kind, anchor.Product, occurrenceIDs),
		ScheduleID:   rule.ID,
		ScheduleName: rule.Name,
		Merchant:     anchor.Provider,
		Cadence:      anchor.Product,
		AccountID:    accountOfPattern(model.Transactions, occurrenceIDs),
	}
	if anchor.Status != "active" {
		preview.Claimable = false
		preview.Reason = "This pattern changed since confirmation. Review it again."
		return preview, nil
	}
	if anchor.Dismissed || (anchor.Review != nil && anchor.Review.Decision == "rejected") {
		preview.Claimable = false
		preview.Reason = "Review this repeating pattern again before linking its payments to a forecast schedule."
		return preview, nil
	}
	assignments, err := analysis.BuildPatternToExistingSchedule(analysis.PatternToExistingScheduleInput{
		Anchor: anchor, Transactions: model.Transactions, Facts: facts, Rule: *rule, OccurrenceIDs: occurrenceIDs,
	})
	if err != nil {
		preview.Claimable = false
		switch {
		case errors.Is(err, analysis.ErrRuleDisabled):
			preview.Reason = "That forecast rule is disabled. Enable it before adding payments to it."
		case errors.Is(err, analysis.ErrRoutingMismatch):
			preview.Reason = "The recorded payments use different accounts than that forecast rule."
		case errors.Is(err, analysis.ErrNoScheduleMatch):
			preview.Reason = "The recorded payments do not fall on that rule's schedule: " + err.Error()
		case errors.Is(err, analysis.ErrRuleNotFound):
			return preview, fmt.Errorf("%w: %v", store.ErrPatternToExistingScheduleInvalid, err)
		case errors.Is(err, analysis.ErrPatternStale):
			return preview, fmt.Errorf("%w: %v", store.ErrPatternToExistingScheduleConflict, err)
		case errors.Is(err, analysis.ErrPatternIncoherent):
			return preview, fmt.Errorf("%w: %v", store.ErrPatternToExistingScheduleInvalid, err)
		case errors.Is(err, analysis.ErrNotRecurring):
			return preview, fmt.Errorf("%w: %v", store.ErrPatternToExistingScheduleInvalid, err)
		default:
			return preview, fmt.Errorf("%w: %v", store.ErrPatternToExistingScheduleInvalid, err)
		}
		return preview, nil
	}
	preview.Assignments = assignments
	preview.Claimable = true
	return preview, nil
}

func accountOfPattern(transactions []types.Transaction, ids []string) string {
	for _, transaction := range transactions {
		for _, id := range ids {
			if transaction.ID == id {
				if transaction.SourceAccountID != nil {
					return *transaction.SourceAccountID
				}
				if len(transaction.Destinations) > 0 {
					return transaction.Destinations[0]
				}
				return ""
			}
		}
	}
	return ""
}
