package analyses

import (
	"context"
	"errors"
	"sync"

	"github.com/danielgtaylor/huma/v2"
	"github.com/google/uuid"
	"github.com/simhozebs/net-worth-estimator/backend/internal/api/model"
	"github.com/simhozebs/net-worth-estimator/backend/internal/store"
	"github.com/simhozebs/net-worth-estimator/backend/internal/types"
)

// patternToNewRuleMu serializes creations within one server instance. Preview,
// record, and rule creation are separate store calls; without this, two
// concurrent creations for one pattern could both pass preview and each
// create their own rule. The store contract already assumes one server and
// one instance, so a process-wide mutex matches the deployment.
var patternToNewRuleMu sync.Mutex

func patternToNewRuleError(err error) error {
	return patternToNewRuleErrorAs(err, "The forecast preview is temporarily unavailable")
}

func patternToNewRuleErrorAs(err error, unavailable string) error {
	switch {
	case errors.Is(err, store.ErrNotFound):
		return huma.Error404NotFound("Finding not found")
	case errors.Is(err, store.ErrPatternToNewScheduleInvalid):
		return huma.Error422UnprocessableEntity(err.Error())
	case errors.Is(err, store.ErrPatternToNewScheduleConflict):
		return huma.Error409Conflict(err.Error())
	default:
		return huma.Error500InternalServerError(unavailable)
	}
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
		return nil, patternToNewRuleError(err)
	}
	output := &struct {
		CacheControl string `header:"Cache-Control"`
		Body         struct {
			Preview types.PatternToNewSchedulePreview `json:"preview"`
		}
	}{CacheControl: "private, no-store"}
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
	if s.canWrite != nil && !s.canWrite(ctx) {
		return nil, huma.Error403Forbidden("Write permission is required")
	}
	patternToNewRuleMu.Lock()
	defer patternToNewRuleMu.Unlock()
	preview, err := s.store.PreviewPatternToNewSchedule(input.ID)
	if err != nil {
		return nil, patternToNewRuleErrorAs(err, "The forecast rule could not be saved.")
	}
	if !preview.Creatable {
		// A visible plan without a rule cannot become one yet. A visible
		// plan with a rule permits at most one active rule per pattern.
		if preview.Schedule == nil {
			return nil, huma.Error422UnprocessableEntity(preview.Reason)
		}
		return nil, huma.Error409Conflict(preview.Reason)
	}
	ruleID, err := uuid.NewV7()
	if err != nil {
		return nil, huma.Error500InternalServerError("The forecast rule could not be saved.")
	}
	rule := types.Schedule{
		ID:              ruleID.String(),
		Name:            preview.Schedule.Name,
		SourceAccountID: preview.Schedule.SourceAccountID,
		Destinations:    append([]string(nil), preview.Schedule.Destinations...),
		Amount:          types.TransactionAmountResolution{Resolver: "expression", Config: map[string]any{"expression": preview.Schedule.Amount}, Inputs: map[string]types.AmountInputBinding{}},
		Frequency:       preview.Schedule.Frequency,
		StartDate:       preview.Schedule.StartDate,
		Enabled:         true,
	}
	actor := ""
	if s.actor != nil {
		actor = s.actor(ctx)
	}
	row, issues, saved, revision, err := model.PersistFinanceSchedule(s.store, rule, func(schedule types.Schedule) (types.Schedule, error) {
		return s.store.CreatePatternSchedule(input.ID, preview.PatternKey, actor, schedule)
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
