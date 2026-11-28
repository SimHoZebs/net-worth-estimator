package analyses

import (
	"context"

	"github.com/danielgtaylor/huma/v2"
	"github.com/simhozebs/net-worth-estimator/backend/internal/api/model"
	"github.com/simhozebs/net-worth-estimator/backend/internal/store"
	"github.com/simhozebs/net-worth-estimator/backend/internal/types"
)

func patternToExistingScheduleError(err error) error {
	return patternScheduleError(err, store.ErrPatternToExistingScheduleInvalid, store.ErrPatternToExistingScheduleConflict, "The forecast preview is temporarily unavailable")
}

func patternToExistingScheduleErrorAs(err error, unavailable string) error {
	return patternScheduleError(err, store.ErrPatternToExistingScheduleInvalid, store.ErrPatternToExistingScheduleConflict, unavailable)
}

func (s *handler) previewPatternToExistingSchedule(_ context.Context, input *struct {
	ID         string `path:"id"`
	ScheduleID string `query:"scheduleId" maxLength:"100"`
}) (*struct {
	CacheControl string `header:"Cache-Control"`
	Body         struct {
		Preview types.PatternToExistingSchedulePreview `json:"preview"`
	}
}, error) {
	if input.ScheduleID == "" {
		return nil, huma.Error422UnprocessableEntity("scheduleId is required")
	}
	preview, err := s.store.PreviewPatternToExistingSchedule(input.ID, input.ScheduleID)
	if err != nil {
		return nil, patternToExistingScheduleError(err)
	}
	output := &struct {
		CacheControl string `header:"Cache-Control"`
		Body         struct {
			Preview types.PatternToExistingSchedulePreview `json:"preview"`
		}
	}{CacheControl: patternPreviewCacheControl}
	output.Body.Preview = preview
	return output, nil
}

func (s *handler) addPatternToExistingSchedule(ctx context.Context, input *struct {
	ID   string `path:"id"`
	Body struct {
		ScheduleID string `json:"scheduleId" maxLength:"100"`
	}
}) (*struct {
	Body struct {
		Matches    []types.Transaction          `json:"matches"`
		Issues     []types.ModelValidationIssue `json:"issues"`
		Saved      bool                         `json:"saved"`
		Revision   string                       `json:"revision"`
		PatternKey string                       `json:"patternKey"`
		ScheduleID string                       `json:"scheduleId"`
	}
}, error) {
	if err := s.requirePatternWrite(ctx); err != nil {
		return nil, err
	}
	if input.Body.ScheduleID == "" {
		return nil, huma.Error422UnprocessableEntity("scheduleId is required")
	}
	patternScheduleMu.Lock()
	defer patternScheduleMu.Unlock()
	preview, err := s.store.PreviewPatternToExistingSchedule(input.ID, input.Body.ScheduleID)
	if err != nil {
		return nil, patternToExistingScheduleErrorAs(err, "The forecast addition could not be saved.")
	}
	if !preview.Claimable {
		// The adapter returns no assignments on any Claimable=false path, so
		// every not-claimable preview is an invalid request: rejected
		// patterns need review again, disabled schedules need enabling, and
		// mismatched schedules need a different schedule.
		if preview.Reason == "" {
			return nil, huma.Error422UnprocessableEntity("This pattern cannot be added yet.")
		}
		return nil, huma.Error422UnprocessableEntity(preview.Reason)
	}
	if len(preview.Assignments) == 0 {
		return nil, huma.Error422UnprocessableEntity("This pattern names no recorded movements.")
	}
	// Validate the candidate model with claims applied through the ordinary
	// finance boundary before persisting.
	storedModel, err := s.store.LoadModel()
	if err != nil {
		return nil, huma.Error500InternalServerError("The forecast addition could not be saved.")
	}
	// Re-check the schedule is still enabled: schedule writes do not take patternScheduleMu, so
	// a disable landing between preview and persist must not mint claims the
	// preview calls un-claimable. A deleted schedule falls through to finance
	// validation, which reports the missing schedule as 422.
	scheduleFound, scheduleEnabled := false, false
	for i := range storedModel.Schedules {
		if storedModel.Schedules[i].ID == preview.ScheduleID {
			scheduleFound, scheduleEnabled = true, storedModel.Schedules[i].Enabled
			break
		}
	}
	if scheduleFound && !scheduleEnabled {
		return nil, huma.Error422UnprocessableEntity("That forecast schedule is disabled. Enable it before adding payments to it.")
	}
	byID := make(map[string]bool, len(storedModel.Transactions))
	for i := range storedModel.Transactions {
		byID[storedModel.Transactions[i].ID] = true
	}
	claims := make([]types.TransactionClaimUpdate, 0, len(preview.Assignments))
	for _, item := range preview.Assignments {
		if !byID[item.TransactionID] {
			return nil, huma.Error409Conflict("A recorded movement changed. Review the pattern again.")
		}
		claims = append(claims, types.TransactionClaimUpdate{TransactionID: item.TransactionID, Claim: types.TransactionClaim{ScheduleID: preview.ScheduleID, OccurrenceDate: item.Date}})
	}
	actor := ""
	if s.actor != nil {
		actor = s.actor(ctx)
	}
	rows, issues, saved, revision, err := model.PersistPatternTransactionClaims(s.store, func(candidate *types.FinancialModel) {
		byIndex := make(map[string]int, len(candidate.Transactions))
		for i := range candidate.Transactions {
			byIndex[candidate.Transactions[i].ID] = i
		}
		for _, item := range preview.Assignments {
			if index, ok := byIndex[item.TransactionID]; ok {
				claim := types.TransactionClaim{ScheduleID: preview.ScheduleID, OccurrenceDate: item.Date}
				candidate.Transactions[index].Claim = &claim
			}
		}
	}, func() ([]types.Transaction, error) {
		return s.store.SetPatternTransactionClaims(input.ID, actor, claims)
	})
	if err != nil {
		return nil, err
	}
	if !saved {
		for _, issue := range issues {
			if issue.Severity == types.SeverityError {
				return nil, huma.Error422UnprocessableEntity(issue.Message)
			}
		}
		return nil, huma.Error422UnprocessableEntity("This pattern cannot be added yet.")
	}
	output := &struct {
		Body struct {
			Matches    []types.Transaction          `json:"matches"`
			Issues     []types.ModelValidationIssue `json:"issues"`
			Saved      bool                         `json:"saved"`
			Revision   string                       `json:"revision"`
			PatternKey string                       `json:"patternKey"`
			ScheduleID string                       `json:"scheduleId"`
		}
	}{}
	output.Body.Matches, output.Body.Issues, output.Body.Saved, output.Body.Revision, output.Body.PatternKey, output.Body.ScheduleID = rows, issues, true, revision, preview.PatternKey, preview.ScheduleID
	return output, nil
}
