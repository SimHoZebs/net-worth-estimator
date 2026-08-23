package api

import (
	"context"
	"encoding/json"

	"github.com/danielgtaylor/huma/v2"

	"github.com/simhozebs/net-worth-estimator/backend/internal/domain"
	"github.com/simhozebs/net-worth-estimator/backend/internal/types"
)

// domainValidate avoids importing the domain package in multiple files.
func domainValidate(document *types.FinancialModelDocument, incomeData *types.IncomeDataSnapshot) []types.ModelValidationIssue {
	return domain.ValidateFinancialModel(document, incomeData)
}

// resolveDocument returns the request document/income data or stored ones.
func (s *Server) resolveDocument(requested *types.FinancialModelDocument, requestedIncome *types.IncomeDataSnapshot) (*types.FinancialModelDocument, *types.IncomeDataSnapshot, error) {
	var document *types.FinancialModelDocument
	if requested != nil {
		document = requested
	} else {
		stored, err := s.store.LoadDocument()
		if err != nil {
			return nil, nil, err
		}
		document = stored
	}
	if requestedIncome != nil {
		return document, requestedIncome, nil
	}
	incomeData, err := s.store.LoadIncomeData()
	if err != nil {
		return nil, nil, err
	}
	return document, incomeData, nil
}

type projectionRequestBody struct {
	Document   *types.FinancialModelDocument   `json:"document,omitempty"`
	Overrides  types.ModelOverrides            `json:"overrides"`
	Settings   types.ProjectionRuntimeSettings `json:"settings"`
	IncomeData *types.IncomeDataSnapshot       `json:"incomeData,omitempty"`
}

type deterministicOutput struct {
	Cache string `header:"X-Cache"`
	Body  struct {
		Result *types.ProjectionResult      `json:"result,omitempty"`
		Issues []types.ModelValidationIssue `json:"issues,omitempty"`
		Error  string                       `json:"error,omitempty"`
	}
}

func (s *Server) projectDeterministic(ctx context.Context, input *struct {
	Body projectionRequestBody
}) (*deterministicOutput, error) {
	document, incomeData, err := s.resolveDocument(input.Body.Document, input.Body.IncomeData)
	if err != nil {
		return nil, huma.Error500InternalServerError(err.Error())
	}

	// Key the RESOLVED document/income snapshot so omitted fields track the
	// stored state: a model save changes stored content and therefore the key.
	cacheKey := artifactKey("deterministic", map[string]any{
		"document":   document,
		"overrides":  input.Body.Overrides,
		"settings":   projectionSettingsDescriptor(input.Body.Settings),
		"incomeData": incomeData,
	})
	if cached, err := lookupArtifact[types.ProjectionResult](s.store, cacheKey); err == nil && cached.hit {
		output := &deterministicOutput{Cache: "hit"}
		cachedCopy := cached.value
		output.Body.Result = &cachedCopy
		return output, nil
	}

	result, err := domain.ProjectFinancialModelDocument(document, &input.Body.Settings, input.Body.Overrides, nil, incomeData)
	output := &deterministicOutput{Cache: "miss"}
	if err != nil {
		output.Body.Error = err.Error()
		if preparationError, ok := err.(*domain.SimulationPreparationError); ok {
			output.Body.Issues = preparationError.Issues
			return output, nil
		}
		return output, nil
	}
	putArtifact(s.store, cacheKey, "deterministic", result)
	output.Body.Result = result
	return output, nil
}

// ---- Analyses (posting-derived payroll evidence) ----

type analysesOutput struct {
	Body struct {
		Error   string         `json:"error,omitempty"`
		Results map[string]any `json:"results,omitempty"`
	}
}

func (s *Server) analyzePostings(_ context.Context, input *struct {
	Body projectionRequestBody
}) (*analysesOutput, error) {
	document, _, err := s.resolveDocument(input.Body.Document, input.Body.IncomeData)
	if err != nil {
		return nil, huma.Error500InternalServerError(err.Error())
	}
	results, err := domain.RunPostingAnalyses(document)
	output := &analysesOutput{}
	if err != nil {
		output.Body.Error = err.Error()
		return output, nil
	}
	payload, _ := json.Marshal(results)
	decoded := map[string]any{}
	_ = json.Unmarshal(payload, &decoded)
	output.Body.Results = decoded
	return output, nil
}
