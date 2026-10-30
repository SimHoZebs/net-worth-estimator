package projections

import (
	"context"
	"fmt"
	"log"
	"net/http"

	"github.com/danielgtaylor/huma/v2"

	"github.com/simhozebs/net-worth-estimator/backend/internal/domain"
	"github.com/simhozebs/net-worth-estimator/backend/internal/types"
)

// deterministicResultVersion covers the deterministic payload shape.
// See artifactIdentityVersion in artifacts.go: bump both together so
// incompatible stored results are not retrieved.
const deterministicResultVersion = 12

// resolveModel returns the request model or the stored one.
func (s *handler) resolveModel(requested *types.FinancialModel) (*types.FinancialModel, error) {
	if requested != nil {
		return requested, nil
	}
	model, err := s.store.LoadModel()
	if err != nil {
		return nil, err
	}
	if model == nil {
		return nil, fmt.Errorf("financial model is not initialized")
	}
	return model, nil
}

type projectionRequestBody struct {
	Model     *types.FinancialModel           `json:"model,omitempty"`
	Overrides types.ModelOverrides            `json:"overrides,omitempty"`
	Settings  types.ProjectionRuntimeSettings `json:"settings"`
	// Range selects response rows and transaction events by inclusive ISO dates.
	// At least one bound is required. Other result sections remain unchanged.
	Range *projectionRange `json:"range,omitempty" required:"true"`
}

type deterministicOutput struct {
	Status int    `json:"-"`
	Source string `header:"Projection-Source"`
	Body   struct {
		Result *types.ProjectionResult      `json:"result,omitempty"`
		Issues []types.ModelValidationIssue `json:"issues,omitempty"`
		Error  string                       `json:"error,omitempty"`
	}
}

func (s *handler) projectDeterministic(ctx context.Context, input *struct {
	Body projectionRequestBody
}) (*deterministicOutput, error) {
	if err := validateProjectionRange(input.Body.Range); err != nil {
		return nil, err
	}
	model, err := s.resolveModel(input.Body.Model)
	if err != nil {
		return nil, huma.Error500InternalServerError(err.Error())
	}

	// Key the RESOLVED model so omitted fields track the
	// stored state: a model save changes stored content and therefore the key.
	// Response ranges stay out of the key: all ranges share the complete artifact.
	resultKey := s.resourceArtifactKey("deterministic", map[string]any{
		"publicResultVersion": deterministicResultVersion,
		"model":               model,
		"overrides":           input.Body.Overrides,
		"settings":            projectionSettingsDescriptor(input.Body.Settings),
	})
	if stored, err := lookupArtifact[types.ProjectionResult](s.store, resultKey); err == nil && stored.found {
		// huma writes Status verbatim; leaving it zero panics the writer.
		output := &deterministicOutput{Status: http.StatusOK, Source: projectionSourceStored}
		output.Body.Result = clipProjectionRange(&stored.value, input.Body.Range)
		return output, nil
	}
	_, prefix := parseArtifactKeyMeta(resultKey)
	log.Printf("deterministic simulation key_prefix=%s accounts=%d postings=%d checkpoints=%d horizon=%d range=%s",
		prefix, len(model.Accounts), len(model.Postings), len(model.Checkpoints),
		input.Body.Settings.HorizonYears, formatProjectionRange(input.Body.Range))

	result, err := domain.ProjectFinancialModel(model, &input.Body.Settings, input.Body.Overrides, nil)
	// huma writes this status verbatim; default to 200 and only raise it for
	// unexpected failures.
	output := &deterministicOutput{Status: http.StatusOK, Source: projectionSourceComputed}
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
	putArtifact(s.store, resultKey, "deterministic", result)
	output.Body.Result = clipProjectionRange(result, input.Body.Range)
	return output, nil
}
