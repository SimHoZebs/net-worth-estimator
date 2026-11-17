package model

import (
	"context"
	"time"

	"github.com/danielgtaylor/huma/v2"
	"github.com/simhozebs/net-worth-estimator/backend/internal/domain"
	"github.com/simhozebs/net-worth-estimator/backend/internal/safespending"
	"github.com/simhozebs/net-worth-estimator/backend/internal/store"
	"github.com/simhozebs/net-worth-estimator/backend/internal/types"
)

type safeSpendingSummaryOutput struct {
	CacheControl string `header:"Cache-Control"`
	Body         types.SafeSpendingSummary
}

func (s *handler) getSafeSpendingSummary(_ context.Context, input *struct {
	Start string `query:"start" required:"true" doc:"UTC cash evidence cut and inclusive bill-window start YYYY-MM-DD"`
	End   string `query:"end" required:"true" doc:"Inclusive conditional bill-window end YYYY-MM-DD"`
}) (*safeSpendingSummaryOutput, error) {
	now := time.Now().UTC()
	if !domain.IsValidIsoDate(input.Start) || input.Start > domain.FormatIsoDate(now) {
		return nil, huma.Error422UnprocessableEntity("start must be a UTC calendar date at or before today")
	}
	if !domain.IsValidIsoDate(input.End) || input.End < input.Start {
		return nil, huma.Error422UnprocessableEntity("end must be a UTC calendar date at or after start")
	}
	model, err := s.store.LoadModel()
	if err != nil {
		return nil, huma.Error500InternalServerError(err.Error())
	}
	revision, err := store.ModelETag(model)
	if err != nil {
		return nil, huma.Error500InternalServerError(err.Error())
	}
	settings, err := s.store.GetSafeSpendingSettings()
	if err != nil {
		return nil, huma.Error500InternalServerError(err.Error())
	}
	summary := safespending.BuildAtCut(model, settings, input.Start, input.End, now.Unix())
	summary.Revision = revision
	return &safeSpendingSummaryOutput{CacheControl: "private, no-store", Body: summary}, nil
}
