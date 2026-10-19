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

type statusOutput struct {
	Body struct {
		ReadOnly       bool `json:"readOnly"`
		AuthEnabled    bool `json:"authEnabled"`
		SyncConfigured bool `json:"syncConfigured"`
		// LastSyncAt is the last successful sync completion time (RFC3339
		// UTC), omitted when no sync has completed yet.
		LastSyncAt string `json:"lastSyncAt,omitempty"`
	}
}

func (s *Server) getStatus(_ context.Context, _ *struct{}) (*statusOutput, error) {
	output := &statusOutput{}
	output.Body.ReadOnly = s.ReadOnly
	output.Body.AuthEnabled = s.AuthEnabled
	output.Body.SyncConfigured = s.SyncRunner != nil
	lastSync, err := s.store.GetLastSyncTime()
	if err != nil {
		return nil, huma.Error500InternalServerError(err.Error())
	}
	output.Body.LastSyncAt = lastSync
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
