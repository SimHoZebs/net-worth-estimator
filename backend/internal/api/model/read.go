package model

import (
	"context"

	"github.com/danielgtaylor/huma/v2"
	"github.com/simhozebs/net-worth-estimator/backend/internal/domain"
	"github.com/simhozebs/net-worth-estimator/backend/internal/store"
	"github.com/simhozebs/net-worth-estimator/backend/internal/types"
)

type financialModelResponse struct {
	Model        *types.FinancialModel        `json:"model"`
	Issues       []types.ModelValidationIssue `json:"issues"`
	Revision     string                       `json:"revision,omitempty"`
	ReceiptLinks map[string][]string          `json:"receiptLinks,omitempty"`
}

type getModelOutput struct {
	Body financialModelResponse
}

func (s *handler) loadStoredModel() (*types.FinancialModel, []types.ModelValidationIssue, error) {
	model, err := s.store.LoadModel()
	if err != nil {
		return nil, nil, err
	}
	if model == nil {
		return nil, []types.ModelValidationIssue{}, nil
	}
	issues := domain.ValidateFinancialModel(model)
	return model, issues, nil
}

func (s *handler) getModel(_ context.Context, _ *struct{}) (*getModelOutput, error) {
	model, issues, err := s.loadStoredModel()
	if err != nil {
		return nil, huma.Error500InternalServerError(err.Error())
	}
	revision, err := store.ModelETag(model)
	if err != nil {
		return nil, huma.Error500InternalServerError(err.Error())
	}
	links, err := s.receipts.ListLinks()
	if err != nil {
		return nil, huma.Error500InternalServerError(err.Error())
	}
	return &getModelOutput{Body: financialModelResponse{Model: model, Issues: issues, Revision: revision, ReceiptLinks: links}}, nil
}
