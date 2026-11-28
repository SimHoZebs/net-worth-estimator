package sqlite

import (
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
	data, err := s.loadPatternPreviewData(findingID)
	if err != nil {
		return preview, err
	}
	anchor := data.anchor
	occurrenceIDs := data.occurrenceIDs
	model := data.model
	facts := data.facts
	if !analysis.IsSchedulePatternKind(anchor.Kind) {
		return preview, fmt.Errorf("%w: finding is %s", store.ErrPatternToExistingScheduleInvalid, anchor.Kind)
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
	preview = types.PatternToExistingSchedulePreview{
		PatternPreviewHeader: types.PatternPreviewHeader{
			FindingID:  anchor.ID,
			PatternKey: analysis.RecurringPatternKey(anchor.Kind, anchor.Product, occurrenceIDs),
			Merchant:   anchor.Provider,
			Cadence:    anchor.Product,
			AccountID:  accountOfPattern(model.Transactions, occurrenceIDs),
		},
		ScheduleID:   rule.ID,
		ScheduleName: rule.Name,
		Assignments:  []types.PatternOccurrence{},
	}
	if anchor.Status != "active" {
		preview.Claimable = false
		preview.Reason = "This pattern changed since confirmation. Review it again."
		return preview, nil
	}
	if anchor.Dismissed || (anchor.Review != nil && anchor.Review.Decision == "rejected") {
		preview.Claimable = false
		preview.Reason = "Review this pattern again before linking its payments to a forecast schedule."
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
