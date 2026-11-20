package model

import (
	"context"
	"encoding/json"
	"fmt"

	"github.com/danielgtaylor/huma/v2"
	"github.com/simhozebs/net-worth-estimator/backend/internal/types"
)

type safeSpendingOutput struct {
	Body struct {
		Settings *types.SafeSpendingSettings `json:"settings"`
	}
}

type safeSpendingInput struct {
	Body safeSpendingBody
}

type safeSpendingBody types.SafeSpendingSettings

func (b *safeSpendingBody) UnmarshalJSON(data []byte) error {
	// Huma applies defaults to omitted fields but skips validation for null
	// optional fields. A supplied setting must still be a number.
	type plain safeSpendingBody
	var decoded struct {
		*plain
		CycleStartDay optional[int]     `json:"cycleStartDay"`
		PaydayDay     optional[int]     `json:"paydayDay"`
		SavingsTarget optional[float64] `json:"savingsTarget"`
	}
	decoded.plain = (*plain)(b)
	if err := json.Unmarshal(data, &decoded); err != nil {
		return err
	}
	if decoded.CycleStartDay.Null || decoded.PaydayDay.Null || decoded.SavingsTarget.Null {
		return fmt.Errorf("cycleStartDay, paydayDay, and savingsTarget cannot be null")
	}
	b.CycleStartDay = decoded.CycleStartDay.Value
	b.PaydayDay = decoded.PaydayDay.Value
	b.SavingsTarget = decoded.SavingsTarget.Value
	return nil
}

func (s *handler) getSafeSpendingSettings(_ context.Context, _ *struct{}) (*safeSpendingOutput, error) {
	settings, err := s.store.GetSafeSpendingSettings()
	if err != nil {
		return nil, huma.Error500InternalServerError("Cannot load safe card spending settings")
	}
	output := &safeSpendingOutput{}
	output.Body.Settings = settings
	return output, nil
}

func (s *handler) setSafeSpendingSettings(_ context.Context, input *safeSpendingInput) (*safeSpendingOutput, error) {
	settings := types.SafeSpendingSettings(input.Body)
	if err := s.store.SetSafeSpendingSettings(settings); err != nil {
		return nil, huma.Error500InternalServerError("Cannot save safe card spending settings")
	}
	output := &safeSpendingOutput{}
	output.Body.Settings = &settings
	return output, nil
}
