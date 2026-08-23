package api

import (
	"context"

	"github.com/danielgtaylor/huma/v2"
	"github.com/simhozebs/net-worth-estimator/backend/internal/types"
)

type parseResultBody struct {
	Document *types.FinancialModelDocument `json:"document"`
	Issues   []types.ModelValidationIssue  `json:"issues"`
}

type getModelOutput struct {
	Body parseResultBody
}

func (s *Server) loadStoredDocument() (*types.FinancialModelDocument, []types.ModelValidationIssue, error) {
	document, err := s.store.LoadDocument()
	if err != nil {
		return nil, nil, err
	}
	incomeData, err := s.store.LoadIncomeData()
	if err != nil {
		return nil, nil, err
	}
	issues := domainValidate(document, incomeData)
	return document, issues, nil
}

func (s *Server) getModel(_ context.Context, _ *struct{}) (*getModelOutput, error) {
	document, issues, err := s.loadStoredDocument()
	if err != nil {
		return nil, huma.Error500InternalServerError(err.Error())
	}
	return &getModelOutput{Body: parseResultBody{Document: document, Issues: issues}}, nil
}

func (s *Server) putModel(_ context.Context, input *struct {
	Body types.FinancialModelDocument `json:"body"`
}) (*getModelOutput, error) {
	document := &input.Body
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
		if err := s.store.SaveDocument(document); err != nil {
			return nil, huma.Error500InternalServerError(err.Error())
		}
	}
	return &getModelOutput{Body: parseResultBody{Document: document, Issues: issues}}, nil
}

type resetOutput struct {
	Body struct {
		Reset  bool             `json:"reset"`
		Result *parseResultBody `json:"result,omitempty"`
	}
}

func (s *Server) resetModel(_ context.Context, _ *struct{}) (*resetOutput, error) {
	if err := s.store.ImportCSV(s.SeedModelPath, s.SeedIncomePath); err != nil {
		return nil, huma.Error500InternalServerError("reset failed: " + err.Error())
	}
	document, err := s.store.LoadDocument()
	if err != nil {
		return nil, huma.Error500InternalServerError(err.Error())
	}
	incomeData, err := s.store.LoadIncomeData()
	if err != nil {
		return nil, huma.Error500InternalServerError(err.Error())
	}
	output := &resetOutput{}
	output.Body.Reset = true
	output.Body.Result = &parseResultBody{
		Document: document,
		Issues:   domainValidate(document, incomeData),
	}
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
