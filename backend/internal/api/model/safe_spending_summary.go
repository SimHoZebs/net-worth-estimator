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
	AsOf string `query:"asOf" doc:"Historical cut: YYYY-MM-DD (end of day) or RFC 3339 instant. Defaults to now."`
}) (*safeSpendingSummaryOutput, error) {
	cut := time.Now().Unix()
	if input.AsOf != "" {
		requested, _, err := domain.ParseAsOfCut(input.AsOf)
		if err != nil {
			return nil, huma.Error422UnprocessableEntity(err.Error())
		}
		if requested > cut {
			return nil, huma.Error422UnprocessableEntity("Safe Spending requires a historical cut")
		}
		cut = requested
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
	summary := safespending.BuildAtCut(model, settings, cut)
	summary.Revision = revision
	return &safeSpendingSummaryOutput{CacheControl: "private, no-store", Body: summary}, nil
}
