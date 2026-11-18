package sqlite

import (
	"database/sql"
	"errors"
	"fmt"

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
	data, err := s.loadPatternPreviewData(findingID)
	if err != nil {
		return preview, err
	}
	anchor := data.anchor
	occurrenceIDs := data.occurrenceIDs
	model := data.model
	facts := data.facts
	if !analysis.IsSchedulePatternKind(anchor.Kind) {
		return preview, fmt.Errorf("%w: finding is %s", store.ErrPatternToNewScheduleInvalid, anchor.Kind)
	}
	patternKey := analysis.RecurringPatternKey(anchor.Kind, anchor.Product, occurrenceIDs)
	existingScheduleID := ""
	if record, err := s.findPatternToNewSchedule(patternKey); err == nil {
		for _, rule := range model.Schedules {
			if rule.ID == record.ScheduleID && rule.Enabled {
				existingScheduleID = record.ScheduleID
				break
			}
		}
	} else if !errors.Is(err, store.ErrNotFound) {
		return preview, err
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

// findPatternToNewSchedule returns the recorded pattern-to-rule entry for the
// shared preview loader. A missing record reports ErrNotFound; a record
// whose rule was deleted or disabled is still returned so the preview can
// decide what active means.
func (s *sqliteStore) findPatternToNewSchedule(patternKey string) (types.PatternToNewSchedule, error) {
	var record types.PatternToNewSchedule
	err := s.db.QueryRow(`SELECT pattern_key, rule_id, created_at, merchant_key FROM analysis_promotions WHERE pattern_key = ? AND user_id = :user_id`, patternKey).Scan(&record.PatternKey, &record.ScheduleID, &record.CreatedAt, &record.MerchantKey)
	if err == sql.ErrNoRows {
		return record, store.ErrNotFound
	}
	return record, err
}

// ListPatternToNewSchedules returns every promotion row for the user. The
// merchant key on each row lets auto-claim recognize a schedule even after its
// display name was edited.
func (s *sqliteStore) ListPatternToNewSchedules() ([]types.PatternToNewSchedule, error) {
	rows, err := s.db.Query(`SELECT pattern_key, rule_id, created_at, merchant_key FROM analysis_promotions WHERE user_id = :user_id`)
	if err != nil {
		return nil, err
	}
	defer rows.Close()
	records := []types.PatternToNewSchedule{}
	for rows.Next() {
		var record types.PatternToNewSchedule
		if err := rows.Scan(&record.PatternKey, &record.ScheduleID, &record.CreatedAt, &record.MerchantKey); err != nil {
			return nil, err
		}
		records = append(records, record)
	}
	if err := rows.Err(); err != nil {
		return nil, err
	}
	return records, nil
}
