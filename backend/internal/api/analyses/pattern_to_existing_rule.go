package analyses

import (
	"context"
	"errors"
	"sync"

	"github.com/danielgtaylor/huma/v2"
	"github.com/simhozebs/net-worth-estimator/backend/internal/api/internal/modelstate"
	"github.com/simhozebs/net-worth-estimator/backend/internal/domain"
	"github.com/simhozebs/net-worth-estimator/backend/internal/store"
	"github.com/simhozebs/net-worth-estimator/backend/internal/types"
)

// patternToExistingRuleMu serializes additions within one server instance.
// Preview plus claim updates are separate store calls; without this, two
// concurrent additions for one pattern could both pass preview and each
// claim overlapping occurrences.
var patternToExistingRuleMu sync.Mutex

func patternToExistingRuleError(err error) error {
	return patternToExistingRuleErrorAs(err, "The forecast preview is temporarily unavailable")
}

func patternToExistingRuleErrorAs(err error, unavailable string) error {
	switch {
	case errors.Is(err, store.ErrNotFound):
		return huma.Error404NotFound("Finding not found")
	case errors.Is(err, store.ErrPatternToExistingScheduleInvalid):
		return huma.Error422UnprocessableEntity(err.Error())
	case errors.Is(err, store.ErrPatternToExistingScheduleConflict):
		return huma.Error409Conflict(err.Error())
	default:
		return huma.Error500InternalServerError(unavailable)
	}
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
		return nil, patternToExistingRuleError(err)
	}
	output := &struct {
		CacheControl string `header:"Cache-Control"`
		Body         struct {
			Preview types.PatternToExistingSchedulePreview `json:"preview"`
		}
	}{CacheControl: "private, no-store"}
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
		Matches    []types.Posting              `json:"matches"`
		Issues     []types.ModelValidationIssue `json:"issues"`
		Saved      bool                         `json:"saved"`
		Revision   string                       `json:"revision"`
		PatternKey string                       `json:"patternKey"`
		ScheduleID string                       `json:"scheduleId"`
	}
}, error) {
	if s.canWrite != nil && !s.canWrite(ctx) {
		return nil, huma.Error403Forbidden("Write permission is required")
	}
	if input.Body.ScheduleID == "" {
		return nil, huma.Error422UnprocessableEntity("scheduleId is required")
	}
	patternToExistingRuleMu.Lock()
	defer patternToExistingRuleMu.Unlock()
	preview, err := s.store.PreviewPatternToExistingSchedule(input.ID, input.Body.ScheduleID)
	if err != nil {
		return nil, patternToExistingRuleErrorAs(err, "The forecast addition could not be saved.")
	}
	if !preview.Claimable {
		// The adapter returns no assignments on any Claimable=false path, so
		// every not-claimable preview is an invalid request: unconfirmed
		// patterns wait on review, disabled rules need enabling, and
		// mismatched schedules need a different rule.
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
	model, err := s.store.LoadModel()
	if err != nil {
		return nil, huma.Error500InternalServerError("The forecast addition could not be saved.")
	}
	// Re-check the rule is still enabled: rule writes do not take patternToExistingRuleMu, so
	// a disable landing between preview and persist must not mint claims the
	// preview calls un-claimable. A deleted rule falls through to finance
	// validation, which reports the missing rule as 422.
	ruleFound, ruleEnabled := false, false
	for i := range model.Schedules {
		if model.Schedules[i].ID == preview.ScheduleID {
			ruleFound, ruleEnabled = true, model.Schedules[i].Enabled
			break
		}
	}
	if ruleFound && !ruleEnabled {
		return nil, huma.Error422UnprocessableEntity("That forecast rule is disabled. Enable it before adding payments to it.")
	}
	baseline := domain.EvaluationReferenceIssues(model)
	candidate := *model
	byIndex := make(map[string]int, len(candidate.Postings))
	for i := range candidate.Postings {
		byIndex[candidate.Postings[i].ID] = i
	}
	claims := make([]types.PostingClaimUpdate, 0, len(preview.Assignments))
	for _, item := range preview.Assignments {
		index, ok := byIndex[item.PostingID]
		if !ok {
			return nil, huma.Error409Conflict("A recorded movement changed. Review the pattern again.")
		}
		claim := types.PostingClaim{ScheduleID: preview.ScheduleID, OccurrenceDate: item.Date}
		candidate.Postings[index].Claim = &claim
		claims = append(claims, types.PostingClaimUpdate{PostingID: item.PostingID, Claim: claim})
	}
	issues := domain.ValidateFinanceWriteChange(baseline, &candidate)
	for _, issue := range issues {
		if issue.Severity == types.SeverityError {
			return nil, huma.Error422UnprocessableEntity(issue.Message)
		}
	}
	rows, err := s.store.SetPostingClaims(claims)
	if err != nil {
		if errors.Is(err, store.ErrPatternToExistingScheduleInvalid) {
			return nil, patternToExistingRuleErrorAs(err, "The forecast addition could not be saved.")
		}
		return nil, modelstate.WriteError(err)
	}
	stored, err := s.store.LoadModel()
	if err != nil {
		return nil, huma.Error500InternalServerError("The forecast addition could not be saved.")
	}
	warnings := domain.ValidateFinanceModel(stored)
	if warnings == nil {
		warnings = []types.ModelValidationIssue{}
	}
	revision, err := store.ModelETag(stored)
	if err != nil {
		return nil, huma.Error500InternalServerError("The forecast addition could not be saved.")
	}
	output := &struct {
		Body struct {
			Matches    []types.Posting              `json:"matches"`
			Issues     []types.ModelValidationIssue `json:"issues"`
			Saved      bool                         `json:"saved"`
			Revision   string                       `json:"revision"`
			PatternKey string                       `json:"patternKey"`
			ScheduleID string                       `json:"scheduleId"`
		}
	}{}
	output.Body.Matches, output.Body.Issues, output.Body.Saved, output.Body.Revision, output.Body.PatternKey, output.Body.ScheduleID = rows, warnings, true, revision, preview.PatternKey, preview.ScheduleID
	return output, nil
}
