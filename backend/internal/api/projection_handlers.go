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

// deterministicResultCacheVersion covers the deterministic payload shape.
// See artifactCacheVersion in artifacts.go: bump both together so old
// payloads never read as hits.
const deterministicResultCacheVersion = 7

// domainValidate avoids importing the domain package in multiple files.
func domainValidate(document *types.FinancialModelDocument) []types.ModelValidationIssue {
	return domain.ValidateFinancialModel(document)
}

// resolveDocument returns the request document or the stored one.
func (s *Server) resolveDocument(requested *types.FinancialModelDocument) (*types.FinancialModelDocument, error) {
	if requested != nil {
		return requested, nil
	}
	document, err := s.store.LoadDocument()
	if err != nil {
		return nil, err
	}
	if document == nil {
		return nil, fmt.Errorf("financial model is not initialized")
	}
	return document, nil
}

type projectionRequestBody struct {
	Document  *types.FinancialModelDocument   `json:"document,omitempty"`
	Overrides types.ModelOverrides            `json:"overrides,omitempty"`
	Settings  types.ProjectionRuntimeSettings `json:"settings"`
	// Range selects response rows and movement events by inclusive ISO dates.
	// At least one bound is required. Other result sections remain unchanged.
	Range *projectionRange `json:"range,omitempty" required:"true"`
}

type deterministicOutput struct {
	Status int    `json:"-"`
	Cache  string `header:"Cache-Status"`
	Body   struct {
		Result *types.ProjectionResult      `json:"result,omitempty"`
		Issues []types.ModelValidationIssue `json:"issues,omitempty"`
		Error  string                       `json:"error,omitempty"`
	}
}

func (s *Server) projectDeterministic(ctx context.Context, input *struct {
	Body projectionRequestBody
}) (*deterministicOutput, error) {
	if err := validateProjectionRange(input.Body.Range); err != nil {
		return nil, err
	}
	document, err := s.resolveDocument(input.Body.Document)
	if err != nil {
		return nil, huma.Error500InternalServerError(err.Error())
	}

	// Key the RESOLVED document so omitted fields track the
	// stored state: a model save changes stored content and therefore the key.
	// Response ranges stay out of the key: all ranges share the complete artifact.
	cacheKey := s.resourceArtifactKey("deterministic", map[string]any{
		"publicResultVersion": deterministicResultCacheVersion,
		"document":            document,
		"overrides":           input.Body.Overrides,
		"settings":            projectionSettingsDescriptor(input.Body.Settings),
	})
	if cached, err := lookupArtifact[types.ProjectionResult](s.store, cacheKey); err == nil && cached.hit {
		// huma writes Status verbatim; leaving it zero panics the writer.
		output := &deterministicOutput{Status: http.StatusOK, Cache: cacheStatusHit}
		cachedCopy := cached.value
		output.Body.Result = clipProjectionRange(&cachedCopy, input.Body.Range)
		return output, nil
	}
	_, prefix := parseArtifactKeyMeta(cacheKey)
	log.Printf("deterministic recalc key_prefix=%s accounts=%d postings=%d checkpoints=%d horizon=%d range=%s",
		prefix, len(document.Accounts), len(document.Postings), len(document.Checkpoints),
		input.Body.Settings.HorizonYears, formatProjectionRange(input.Body.Range))

	result, err := domain.ProjectFinancialModelDocument(document, &input.Body.Settings, input.Body.Overrides, nil)
	// huma writes this status verbatim; default to 200 and only raise it for
	// unexpected failures.
	output := &deterministicOutput{Status: http.StatusOK, Cache: cacheStatusMiss}
	if err != nil {
		output.Body.Error = err.Error()
		if preparationError, ok := err.(*domain.SimulationPreparationError); ok {
			// Validation failures stay HTTP 200: callers read the issue list from the
			// body and surface it as model diagnostics.
			output.Body.Issues = preparationError.Issues
			return output, nil
		}
		output.Status = http.StatusInternalServerError
		return output, nil
	}
	putArtifact(s.store, cacheKey, "deterministic", result)
	output.Body.Result = clipProjectionRange(result, input.Body.Range)
	return output, nil
}
