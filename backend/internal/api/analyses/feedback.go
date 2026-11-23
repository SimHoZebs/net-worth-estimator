package analyses

import (
	"context"
	"errors"

	"github.com/danielgtaylor/huma/v2"
	"github.com/simhozebs/net-worth-estimator/backend/internal/store"
	"github.com/simhozebs/net-worth-estimator/backend/internal/types"
)

func (s *handler) reviewAnalysisFinding(ctx context.Context, input *struct {
	ID   string `path:"id"`
	Body types.AnalysisFeedbackInput
}) (*struct {
	CacheControl string `header:"Cache-Control"`
	Body         struct {
		Feedback types.AnalysisFeedback `json:"feedback"`
	}
}, error) {
	if s.canWrite != nil && !s.canWrite(ctx) {
		return nil, huma.Error403Forbidden("Write permission is required")
	}
	if s.actor != nil {
		input.Body.Actor = s.actor(ctx)
	}
	feedback, err := s.store.ReviewAnalysisFinding(input.ID, input.Body)
	if err != nil {
		switch {
		case errors.Is(err, store.ErrNotFound):
			return nil, huma.Error404NotFound("Finding not found")
		case errors.Is(err, store.ErrAnalysisFeedbackConflict):
			return nil, huma.Error409Conflict("The finding changed. Review it again.")
		case errors.Is(err, store.ErrAnalysisFeedbackInvalid):
			return nil, huma.Error422UnprocessableEntity("The answer or plan duration is invalid.")
		default:
			return nil, huma.Error500InternalServerError("The answer could not be saved.")
		}
	}
	output := &struct {
		CacheControl string `header:"Cache-Control"`
		Body         struct {
			Feedback types.AnalysisFeedback `json:"feedback"`
		}
	}{CacheControl: "private, no-store"}
	output.Body.Feedback = feedback
	return output, nil
}
