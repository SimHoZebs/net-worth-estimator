package api

import (
	"context"

	"github.com/danielgtaylor/huma/v2"
	"github.com/simhozebs/net-worth-estimator/backend/internal/store"
	"github.com/simhozebs/net-worth-estimator/backend/internal/types"
)

type parseResultBody struct {
	Document *types.FinancialModelDocument `json:"document"`
	Issues   []types.ModelValidationIssue  `json:"issues"`
	Revision string                        `json:"revision,omitempty"`
}

type getModelOutput struct {
	ETag string `header:"ETag"`
	Body parseResultBody
}

func (s *Server) loadStoredDocument() (*types.FinancialModelDocument, []types.ModelValidationIssue, error) {
	document, incomeData, err := s.store.LoadDocumentAndIncomeData()
	if err != nil {
		return nil, nil, err
	}
	if document == nil {
		return nil, []types.ModelValidationIssue{}, nil
	}
	issues := domainValidate(document, incomeData)
	return document, issues, nil
}

func (s *Server) getModel(_ context.Context, _ *struct{}) (*getModelOutput, error) {
	document, issues, err := s.loadStoredDocument()
	if err != nil {
		return nil, huma.Error500InternalServerError(err.Error())
	}
	revision, err := store.DocumentETag(document)
	if err != nil {
		return nil, huma.Error500InternalServerError(err.Error())
	}
	return &getModelOutput{ETag: revision, Body: parseResultBody{Document: document, Issues: issues, Revision: revision}}, nil
}

func (s *Server) putModel(_ context.Context, input *struct {
	IfMatch string                       `header:"If-Match"`
	Body    types.FinancialModelDocument `json:"body"`
}) (*getModelOutput, error) {
	document := &input.Body
	if input.IfMatch == "" {
		return nil, huma.Error428PreconditionRequired("If-Match is required for financial model writes. Reload the model before saving.")
	}
	matches, err := s.store.DocumentMatchesETag(input.IfMatch)
	if err != nil {
		return nil, huma.Error500InternalServerError(err.Error())
	}
	if !matches {
		return nil, huma.Error412PreconditionFailed("The server model changed after it was loaded. Reload it before saving.")
	}
	effectiveIncome, err := s.store.LoadIncomeData()
	if err != nil {
		return nil, huma.Error500InternalServerError(err.Error())
	}
	issues := domainValidate(document, effectiveIncome)
	hasErrors := false
	for _, issue := range issues {
		if issue.Severity == types.SeverityError {
			hasErrors = true
			break
		}
	}
	if !hasErrors {
		saved, err := s.store.SaveDocumentIfUnchanged(document, input.IfMatch)
		if err != nil {
			return nil, huma.Error500InternalServerError(err.Error())
		}
		if !saved {
			return nil, huma.Error412PreconditionFailed("The server model changed after it was loaded. Reload it before saving.")
		}
		canonical, err := s.store.LoadDocument()
		if err != nil {
			return nil, huma.Error500InternalServerError(err.Error())
		}
		document = canonical
	}
	var revisionDocument *types.FinancialModelDocument = document
	if hasErrors {
		var loadErr error
		revisionDocument, loadErr = s.store.LoadDocument()
		if loadErr != nil {
			return nil, huma.Error500InternalServerError(loadErr.Error())
		}
	}
	revision, err := store.DocumentETag(revisionDocument)
	if err != nil {
		return nil, huma.Error500InternalServerError(err.Error())
	}
	return &getModelOutput{ETag: revision, Body: parseResultBody{Document: document, Issues: issues, Revision: revision}}, nil
}

type statusOutput struct {
	Body struct {
		ReadOnly    bool `json:"readOnly"`
		AuthEnabled bool `json:"authEnabled"`
	}
}

func (s *Server) getStatus(_ context.Context, _ *struct{}) (*statusOutput, error) {
	output := &statusOutput{}
	output.Body.ReadOnly = s.ReadOnly
	output.Body.AuthEnabled = s.AuthEnabled
	return output, nil
}

type incomeDataOutput struct {
	Body types.IncomeDataSnapshot
}

func (s *Server) getIncomeData(_ context.Context, _ *struct{}) (*incomeDataOutput, error) {
	snapshot, err := s.store.LoadIncomeData()
	if err != nil {
		return nil, huma.Error500InternalServerError(err.Error())
	}
	return &incomeDataOutput{Body: *snapshot}, nil
}
