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
	Body parseResultBody
}

func (s *Server) loadStoredDocument() (*types.FinancialModelDocument, []types.ModelValidationIssue, error) {
	document, err := s.store.LoadDocument()
	if err != nil {
		return nil, nil, err
	}
	if document == nil {
		return nil, []types.ModelValidationIssue{}, nil
	}
	issues := domainValidate(document)
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
	return &getModelOutput{Body: parseResultBody{Document: document, Issues: issues, Revision: revision}}, nil
}

type statusOutput struct {
	Body struct {
		ReadOnly       bool   `json:"readOnly"`
		SyncConfigured bool   `json:"syncConfigured"`
		SyncHost       string `json:"syncHost,omitempty"`
		// LastSyncAt is the last successful sync completion time (RFC3339
		// UTC), omitted when no sync has completed yet.
		LastSyncAt string `json:"lastSyncAt,omitempty"`
		// SyncQuotaUsed counts Bridge hits in the trailing 24 hours.
		// SyncQuotaLimit is the Bridge daily allowance.
		SyncQuotaUsed  int `json:"syncQuotaUsed"`
		SyncQuotaLimit int `json:"syncQuotaLimit"`
	}
}

func (s *Server) getStatus(ctx context.Context, _ *struct{}) (*statusOutput, error) {
	output := &statusOutput{}
	output.Body.ReadOnly = s.ReadOnly
	if s.CanWrite != nil && !s.CanWrite(ctx) {
		output.Body.ReadOnly = true
	}
	output.Body.SyncConfigured = s.SyncRunner.IsConfigured()
	if output.Body.SyncConfigured {
		if host := s.SyncRunner.BridgeHost(); host != "" {
			output.Body.SyncHost = host
		} else if credential, err := s.store.GetSyncCredential(); err == nil && credential.BridgeHost != "" {
			output.Body.SyncHost = credential.BridgeHost
		}
	}
	lastSync, err := s.store.GetLastSyncTime()
	if err != nil {
		return nil, huma.Error500InternalServerError(err.Error())
	}
	output.Body.LastSyncAt = lastSync
	if s.SyncRunner != nil {
		used, limit := s.SyncRunner.QuotaUsage()
		output.Body.SyncQuotaUsed = used
		output.Body.SyncQuotaLimit = limit
	}
	return output, nil
}
