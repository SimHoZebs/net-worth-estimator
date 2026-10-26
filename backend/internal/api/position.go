package api

import (
	"context"

	"github.com/danielgtaylor/huma/v2"
	"github.com/simhozebs/net-worth-estimator/backend/internal/domain"
	"github.com/simhozebs/net-worth-estimator/backend/internal/types"
)

type positionRequestBody struct {
	Document *types.FinancialModelDocument `json:"document,omitempty"`
	AsOfDate string                        `json:"asOfDate"`
}

type positionOutput struct {
	Body struct {
		Result *types.CurrentPosition       `json:"result,omitempty"`
		Issues []types.ModelValidationIssue `json:"issues,omitempty"`
		Error  string                       `json:"error,omitempty"`
	}
}

func (s *Server) currentPosition(ctx context.Context, input *struct{ Body positionRequestBody }) (*positionOutput, error) {
	document, err := s.resolveDocument(input.Body.Document)
	if err != nil {
		return nil, huma.Error500InternalServerError(err.Error())
	}
	result, err := domain.ResolveCurrentPosition(document, input.Body.AsOfDate, types.ModelOverrides{})
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
