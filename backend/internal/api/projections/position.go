package projections

import (
	"context"
	"time"

	"github.com/danielgtaylor/huma/v2"
	"github.com/simhozebs/net-worth-estimator/backend/internal/domain"
	"github.com/simhozebs/net-worth-estimator/backend/internal/types"
)

type positionRequestBody struct {
	Model    *types.FinancialModel `json:"model,omitempty"`
	AsOfDate string                `json:"asOfDate,omitempty" doc:"Cut YYYY-MM-DD or RFC 3339 instant; defaults to today's UTC date"`
}

type positionOutput struct {
	Body struct {
		Result *types.CurrentPosition       `json:"result,omitempty"`
		Issues []types.ModelValidationIssue `json:"issues,omitempty"`
		Error  string                       `json:"error,omitempty"`
	}
}

func (s *handler) currentPosition(ctx context.Context, input *struct{ Body positionRequestBody }) (*positionOutput, error) {
	model, err := s.resolveModel(input.Body.Model)
	if err != nil {
		return nil, huma.Error500InternalServerError(err.Error())
	}
	asOfDate := input.Body.AsOfDate
	if asOfDate == "" {
		asOfDate = time.Now().UTC().Format("2006-01-02")
	}
	result, err := domain.ResolveCurrentPosition(model, asOfDate, types.ModelOverrides{})
	output := &positionOutput{}
	if err != nil {
		if preparationError, ok := err.(*domain.SimulationPreparationError); ok {
			output.Body.Error = err.Error()
			output.Body.Issues = preparationError.Issues
			return output, nil
		}
		return nil, huma.Error500InternalServerError(err.Error())
	}
	output.Body.Result = result
	return output, nil
}
