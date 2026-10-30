package model

import (
	"context"

	"github.com/danielgtaylor/huma/v2"
	"github.com/simhozebs/net-worth-estimator/backend/internal/domain"
	"github.com/simhozebs/net-worth-estimator/backend/internal/store"
	"github.com/simhozebs/net-worth-estimator/backend/internal/types"
)

type parseResultBody struct {
	Document     *types.FinancialModelDocument `json:"document"`
	Issues       []types.ModelValidationIssue  `json:"issues"`
	Revision     string                        `json:"revision,omitempty"`
	ReceiptLinks map[string][]string           `json:"receiptLinks,omitempty"`
}

type getModelOutput struct {
	Body parseResultBody
}

func (s *handler) loadStoredDocument() (*types.FinancialModelDocument, []types.ModelValidationIssue, error) {
	document, err := s.store.LoadDocument()
	if err != nil {
		return nil, nil, err
	}
	if document == nil {
		return nil, []types.ModelValidationIssue{}, nil
	}
	issues := domain.ValidateFinancialModel(document)
	return document, issues, nil
}

func (s *handler) getModel(_ context.Context, _ *struct{}) (*getModelOutput, error) {
	document, issues, err := s.loadStoredDocument()
	if err != nil {
		return nil, huma.Error500InternalServerError(err.Error())
	}
	revision, err := store.DocumentETag(document)
	if err != nil {
		return nil, huma.Error500InternalServerError(err.Error())
	}
	links, err := s.receipts.ListLinks()
	if err != nil {
		return nil, huma.Error500InternalServerError(err.Error())
	}
	return &getModelOutput{Body: parseResultBody{Document: document, Issues: issues, Revision: revision, ReceiptLinks: links}}, nil
}
