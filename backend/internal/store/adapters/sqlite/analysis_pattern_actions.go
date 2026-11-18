package sqlite

import (
	"encoding/json"
	"errors"
	"fmt"
	"time"

	"github.com/google/uuid"
	"github.com/simhozebs/net-worth-estimator/backend/internal/analysis"
	"github.com/simhozebs/net-worth-estimator/backend/internal/store"
	"github.com/simhozebs/net-worth-estimator/backend/internal/types"
)

// acceptRecurringPattern runs inside the finance write transaction. Preview
// never labels a detection, and a failed finance write rolls the label back.
func acceptRecurringPattern(tx *userTx, findingID, actor string) error {
	var kind, status, raw string
	var dismissed bool
	if err := tx.QueryRow(`SELECT kind, status, dismissed, review_json FROM analysis_findings WHERE id = ? AND user_id = :user_id`, findingID).Scan(&kind, &status, &dismissed, &raw); err != nil {
		return err
	}
	var review *types.AnalysisReview
	if err := json.Unmarshal([]byte(raw), &review); err != nil {
		return err
	}
	if !analysis.IsSchedulePatternKind(kind) || status != "active" || dismissed || (review != nil && review.Decision == "rejected") {
		return store.ErrAnalysisFeedbackConflict
	}
	if review != nil && review.Decision == "confirmed" {
		return nil
	}
	_, err := applyAnalysisFeedback(tx, findingID, types.AnalysisFeedbackInput{RequestID: uuid.NewString(), Action: "confirm", Actor: actor}, false)
	return err
}

func (s *sqliteStore) CreatePatternSchedule(findingID, patternKey, merchantKey, actor string, schedule types.Schedule) (types.Schedule, error) {
	// The rule covers its recorded movements through claims, so creation
	// must claim each recorded movement onto its scheduled
	// occurrence in the same write as the rule insert. Assignments reuse
	// the existing-schedule matching (nearest unused occurrence within
	// 15% of the nominal interval, one-day floor), which validates routing
	// and schedule fit; the new-schedule preview validation behind it
	// enforces immutable source amounts and evidence coherence.
	data, err := s.loadPatternPreviewData(findingID)
	if err != nil {
		return types.Schedule{}, err
	}
	accountIDs := make([]string, 0, len(data.model.Accounts))
	for _, account := range data.model.Accounts {
		accountIDs = append(accountIDs, account.ID)
	}
	if _, err := analysis.BuildPatternToNewSchedulePreview(analysis.PatternToNewScheduleInput{
		Anchor: data.anchor, Transactions: data.model.Transactions, Facts: data.facts, AccountIDs: accountIDs,
	}); err != nil {
		switch {
		case errors.Is(err, analysis.ErrPatternStale):
			return types.Schedule{}, fmt.Errorf("%w: %v", store.ErrPatternToNewScheduleConflict, err)
		default:
			return types.Schedule{}, fmt.Errorf("%w: %v", store.ErrPatternToNewScheduleInvalid, err)
		}
	}
	assignments, err := analysis.BuildPatternToExistingSchedule(analysis.PatternToExistingScheduleInput{
		Anchor: data.anchor, Transactions: data.model.Transactions, Facts: data.facts, Rule: schedule, OccurrenceIDs: data.occurrenceIDs,
	})
	if err != nil {
		switch {
		case errors.Is(err, analysis.ErrPatternStale):
			return types.Schedule{}, fmt.Errorf("%w: %v", store.ErrPatternToNewScheduleConflict, err)
		default:
			return types.Schedule{}, fmt.Errorf("%w: %v", store.ErrPatternToNewScheduleInvalid, err)
		}
	}
	err = withRowTx(s.db, func(tx *userTx) error {
		if err := acceptRecurringPattern(tx, findingID, actor); err != nil {
			return err
		}
		if err := claimRowID(tx, schedule.ID, "rule"); err != nil {
			return err
		}
		position, err := nextTablePosition(tx, "recurrence_rules")
		if err != nil {
			return err
		}
		if err := insertRule(tx, position, &schedule); err != nil {
			return err
		}
		for _, item := range assignments {
			if _, err := tx.Exec(`INSERT INTO transaction_claims (transaction_id, fulfills_rule_id, fulfills_occurrence_date, user_id) VALUES (?, ?, ?, :user_id)
				ON CONFLICT(user_id, transaction_id) DO UPDATE SET fulfills_rule_id = excluded.fulfills_rule_id, fulfills_occurrence_date = excluded.fulfills_occurrence_date`,
				item.TransactionID, schedule.ID, item.Date); err != nil {
				return fmt.Errorf("claim transaction %s for schedule %s: %w", item.TransactionID, schedule.ID, err)
			}
		}
		_, err = tx.Exec(`INSERT INTO analysis_promotions(pattern_key, rule_id, created_at, merchant_key, user_id) VALUES (?, ?, ?, ?, :user_id)
			ON CONFLICT(user_id, pattern_key) DO UPDATE SET rule_id = excluded.rule_id, created_at = excluded.created_at, merchant_key = excluded.merchant_key`, patternKey, schedule.ID, time.Now().Unix(), merchantKey)
		return err
	})
	if err != nil {
		return types.Schedule{}, err
	}
	if err := s.markDirty(dirtyDay(string(schedule.StartDate))); err != nil {
		return types.Schedule{}, err
	}
	return schedule, nil
}
