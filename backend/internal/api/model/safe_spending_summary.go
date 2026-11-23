package model

import (
	"context"
	"time"

	"github.com/danielgtaylor/huma/v2"
	"github.com/simhozebs/net-worth-estimator/backend/internal/safespending"
	"github.com/simhozebs/net-worth-estimator/backend/internal/store"
	"github.com/simhozebs/net-worth-estimator/backend/internal/types"
)

type safeSpendingSummaryOutput struct {
	CacheControl string `header:"Cache-Control"`
	Body         types.SafeSpendingSummary
}

func (s *handler) getSafeSpendingSummary(_ context.Context, _ *struct{}) (*safeSpendingSummaryOutput, error) {
	cut := time.Now().Unix()
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
