package analyses

import (
	"context"

	"github.com/danielgtaylor/huma/v2"
	"github.com/google/uuid"
	"github.com/simhozebs/net-worth-estimator/backend/internal/api/model"
	"github.com/simhozebs/net-worth-estimator/backend/internal/store"
	"github.com/simhozebs/net-worth-estimator/backend/internal/types"
)

func patternToNewScheduleError(err error) error {
	return patternScheduleError(err, store.ErrPatternToNewScheduleInvalid, store.ErrPatternToNewScheduleConflict, "The forecast preview is temporarily unavailable")
}

func patternToNewScheduleErrorAs(err error, unavailable string) error {
	return patternScheduleError(err, store.ErrPatternToNewScheduleInvalid, store.ErrPatternToNewScheduleConflict, unavailable)
}

func (s *handler) previewPatternToNewSchedule(_ context.Context, input *struct {
	ID string `path:"id"`
}) (*struct {
	CacheControl string `header:"Cache-Control"`
	Body         struct {
		Preview types.PatternToNewSchedulePreview `json:"preview"`
	}
}, error) {
	preview, err := s.store.PreviewPatternToNewSchedule(input.ID)
	if err != nil {
		return nil, patternToNewScheduleError(err)
	}
	output := &struct {
		CacheControl string `header:"Cache-Control"`
		Body         struct {
			Preview types.PatternToNewSchedulePreview `json:"preview"`
		}
	}{CacheControl: patternPreviewCacheControl}
	output.Body.Preview = preview
	return output, nil
}

func (s *handler) createPatternToNewSchedule(ctx context.Context, input *struct {
	ID string `path:"id"`
}) (*struct {
	Body struct {
		Result     types.Schedule               `json:"value"`
		Issues     []types.ModelValidationIssue `json:"issues"`
		Saved      bool                         `json:"saved"`
		Revision   string                       `json:"revision"`
		PatternKey string                       `json:"patternKey"`
	}
}, error) {
	if err := s.requirePatternWrite(ctx); err != nil {
		return nil, err
	}
	patternScheduleMu.Lock()
	defer patternScheduleMu.Unlock()
	preview, err := s.store.PreviewPatternToNewSchedule(input.ID)
	if err != nil {
		return nil, patternToNewScheduleErrorAs(err, "The forecast schedule could not be saved.")
	}
	if !preview.Creatable {
		// A visible plan without a schedule cannot become one yet. A visible
		// plan with a schedule permits at most one active schedule per pattern.
		if preview.Schedule == nil {
			return nil, huma.Error422UnprocessableEntity(preview.Reason)
		}
		return nil, huma.Error409Conflict(preview.Reason)
	}
	scheduleID, err := uuid.NewV7()
	if err != nil {
		return nil, huma.Error500InternalServerError("The forecast schedule could not be saved.")
	}
	schedule := types.ProposedNewScheduleToSchedule(*preview.Schedule, scheduleID.String())
	actor := ""
	if s.actor != nil {
		actor = s.actor(ctx)
	}
	row, issues, saved, revision, err := model.PersistFinanceSchedule(s.store, schedule, func(schedule types.Schedule) (types.Schedule, error) {
		return s.store.CreatePatternSchedule(input.ID, preview.PatternKey, preview.Merchant, actor, schedule)
	})
	if err != nil || !saved {
		if err != nil {
			return nil, err
		}
		return nil, huma.Error409Conflict("The saved data changed. Review the pattern again.")
	}
	output := &struct {
		Body struct {
			Result     types.Schedule               `json:"value"`
			Issues     []types.ModelValidationIssue `json:"issues"`
			Saved      bool                         `json:"saved"`
			Revision   string                       `json:"revision"`
			PatternKey string                       `json:"patternKey"`
		}
	}{}
	output.Body.Result, output.Body.Issues, output.Body.Saved, output.Body.Revision, output.Body.PatternKey = row, issues, saved, revision, preview.PatternKey
	return output, nil
}
