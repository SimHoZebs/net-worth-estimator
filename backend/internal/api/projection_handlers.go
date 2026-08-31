package api

import (
	"context"
	"encoding/json"
	"fmt"
	"net/http"

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
	if requested == nil && requestedIncome == nil {
		document, incomeData, err := s.store.LoadDocumentAndIncomeData()
		if err != nil {
			return nil, nil, err
		}
		if document == nil {
			return nil, nil, fmt.Errorf("financial model is not initialized")
		}
		return document, incomeData, nil
	}
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
	if document == nil {
		return nil, nil, fmt.Errorf("financial model is not initialized")
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
	Status int    `json:"-"`
	Cache  string `header:"X-Cache"`
	Body   struct {
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
		// huma writes Status verbatim; leaving it zero panics the writer.
		output := &deterministicOutput{Status: http.StatusOK, Cache: "hit"}
		cachedCopy := cached.value
		output.Body.Result = &cachedCopy
		return output, nil
	}

	result, err := domain.ProjectFinancialModelDocument(document, &input.Body.Settings, input.Body.Overrides, nil, incomeData)
	// huma writes this status verbatim; default to 200 and only raise it for
	// unexpected failures.
	output := &deterministicOutput{Status: http.StatusOK, Cache: "miss"}
	if err != nil {
		output.Body.Error = err.Error()
		if preparationError, ok := err.(*domain.SimulationPreparationError); ok {
			// Validation failures stay HTTP 200: the client reads the issue
			// list from the body and surfaces it as model diagnostics.
			output.Body.Issues = preparationError.Issues
			return output, nil
		}
		output.Status = http.StatusInternalServerError
		return output, nil
	}
	putArtifact(s.store, cacheKey, "deterministic", result)
	output.Body.Result = result
	return output, nil
}

// ---- Analyses (posting-derived payroll evidence) ----

type analysesOutput struct {
	Status int `json:"-"`
	Body   struct {
		Error   string                       `json:"error,omitempty"`
		Issues  []types.ModelValidationIssue `json:"issues,omitempty"`
		Results map[string]any               `json:"results,omitempty"`
	}
}

func (s *Server) analyzePostings(_ context.Context, input *struct {
	Body projectionRequestBody
}) (*analysesOutput, error) {
	document, incomeData, err := s.resolveDocument(input.Body.Document, input.Body.IncomeData)
	if err != nil {
		return nil, huma.Error500InternalServerError(err.Error())
	}
	// Posting analyses parse posting dates directly; reject malformed
	// documents with structured issues instead of panicking into a 500.
	output := &analysesOutput{Status: http.StatusOK}
	issues := domainValidate(document, incomeData)
	for _, issue := range issues {
		if issue.Severity == types.SeverityError {
			output.Body.Issues = append(output.Body.Issues, issue)
		}
	}
	if len(output.Body.Issues) > 0 {
		return output, nil
	}
	results, err := domain.RunPostingAnalyses(document)
	if err != nil {
		output.Body.Error = err.Error()
		return output, nil
	}
	payload, err := json.Marshal(results)
	if err != nil {
		return nil, huma.Error500InternalServerError(fmt.Sprintf("encode analysis results: %v", err))
	}
	decoded := map[string]any{}
	if err := json.Unmarshal(payload, &decoded); err != nil {
		return nil, huma.Error500InternalServerError(fmt.Sprintf("decode analysis results: %v", err))
	}
	output.Body.Results = decoded
	return output, nil
}
