package model

import (
	"context"
	"time"

	"github.com/danielgtaylor/huma/v2"
	"github.com/simhozebs/net-worth-estimator/backend/internal/domain"
	"github.com/simhozebs/net-worth-estimator/backend/internal/store"
	"github.com/simhozebs/net-worth-estimator/backend/internal/types"
)

type balanceAdjustmentsOutput struct {
	Body struct {
		Adjustments []types.BalanceAdjustment `json:"adjustments"`
		Revision    string                    `json:"revision"`
	} `json:"body"`
}

func (s *handler) listBalanceAdjustments(_ context.Context, input *struct {
	ID string `path:"id"`
}) (*balanceAdjustmentsOutput, error) {
	model, err := s.store.LoadModel()
	if err != nil {
		return nil, huma.Error500InternalServerError(err.Error())
	}
	found := false
	var latest int64
	if model != nil {
		for _, account := range model.Accounts {
			if account.ID == input.ID {
				found = true
			}
		}
		for _, observation := range model.Checkpoints {
			if observation.ObservedAt > latest {
				latest = observation.ObservedAt
			}
		}
	}
	if !found {
		return nil, huma.Error404NotFound("account does not exist")
	}
	if latest == 0 {
		latest = time.Now().Unix()
	}
	adjustments, err := domain.ResolveBalanceAdjustments(model, time.Unix(latest, 0).UTC().Format(time.RFC3339))
	if err != nil {
		return nil, huma.Error422UnprocessableEntity(err.Error())
	}
	output := &balanceAdjustmentsOutput{}
	output.Body.Revision, err = store.ModelETag(model)
	if err != nil {
		return nil, huma.Error500InternalServerError(err.Error())
	}
	output.Body.Adjustments = []types.BalanceAdjustment{}
	for _, adjustment := range adjustments {
		if adjustment.AccountID == input.ID {
			output.Body.Adjustments = append(output.Body.Adjustments, adjustment)
		}
	}
	return output, nil
}
