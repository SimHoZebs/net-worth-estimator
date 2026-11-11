package sqlite

import (
	"encoding/json"
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

func (s *sqliteStore) CreatePatternSchedule(findingID, patternKey, actor string, schedule types.Schedule) (types.Schedule, error) {
	err := withRowTx(s.db, func(tx *userTx) error {
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
		_, err = tx.Exec(`INSERT INTO analysis_promotions(pattern_key, rule_id, created_at, user_id) VALUES (?, ?, ?, :user_id)
			ON CONFLICT(user_id, pattern_key) DO UPDATE SET rule_id = excluded.rule_id, created_at = excluded.created_at`, patternKey, schedule.ID, time.Now().Unix())
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
