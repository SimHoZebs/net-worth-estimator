package api

import (
	"context"
	"errors"

	"github.com/danielgtaylor/huma/v2"
	"github.com/simhozebs/net-worth-estimator/backend/internal/simplefin"
)

type syncOutput struct {
	Body simplefin.Summary
}

func (s *Server) triggerSync(ctx context.Context, _ *struct{}) (*syncOutput, error) {
	if s.SyncRunner == nil {
		return nil, huma.Error503ServiceUnavailable("simplefin sync is not configured")
	}
	summary, err := s.SyncRunner.Trigger(ctx)
	if err != nil {
		var tooSoon *simplefin.TooSoonError
		if errors.As(err, &tooSoon) {
			return nil, huma.Error429TooManyRequests(tooSoon.Error())
		}
		var inProgress *simplefin.InProgressError
		if errors.As(err, &inProgress) {
			return nil, huma.Error409Conflict(inProgress.Error())
		}
		return nil, huma.Error500InternalServerError(err.Error())
	}
	return &syncOutput{Body: *summary}, nil
}
