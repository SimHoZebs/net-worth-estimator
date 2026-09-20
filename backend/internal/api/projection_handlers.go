package api

import (
	"context"
	"fmt"
	"log"
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
	Overrides  types.ModelOverrides            `json:"overrides,omitempty"`
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
	_, prefix := parseArtifactKeyMeta(cacheKey)
	log.Printf("deterministic recalc key_prefix=%s accounts=%d postings=%d checkpoints=%d horizon=%d",
		prefix, len(document.Accounts), len(document.Postings), len(document.Checkpoints),
		input.Body.Settings.HorizonYears)

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
