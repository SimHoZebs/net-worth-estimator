package api

import (
	"context"

	"github.com/danielgtaylor/huma/v2"
	"github.com/simhozebs/net-worth-estimator/backend/internal/types"
)

type safeSpendingOutput struct {
	Body struct {
		Settings *types.SafeSpendingSettings `json:"settings"`
	}
}

type safeSpendingInput struct {
	Body types.SafeSpendingSettings
}

func (s *Server) getSafeSpendingSettings(_ context.Context, _ *struct{}) (*safeSpendingOutput, error) {
	settings, err := s.store.GetSafeSpendingSettings()
	if err != nil {
		return nil, huma.Error500InternalServerError("Cannot load safe card spending settings")
	}
	output := &safeSpendingOutput{}
	output.Body.Settings = settings
	return output, nil
}

func (s *Server) setSafeSpendingSettings(_ context.Context, input *safeSpendingInput) (*safeSpendingOutput, error) {
	if err := s.store.SetSafeSpendingSettings(input.Body); err != nil {
		return nil, huma.Error500InternalServerError("Cannot save safe card spending settings")
	}
	output := &safeSpendingOutput{}
	output.Body.Settings = &input.Body
	return output, nil
}
