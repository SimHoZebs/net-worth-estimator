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

// Projection-Source identifies the result's origin. Every projection
// computes directly: no stored results exist.
const projectionSourceComputed = "computed"

const projectionSourceShared = "shared"

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

	// Unified read path: canonical requests assemble from stored slices.
	if input.Body.Model == nil && isEmptyOverrides(input.Body.Overrides) {
		if _, canonical, err := s.ensureCanonicalState(&input.Body.Settings); err != nil {
			return nil, huma.Error500InternalServerError(err.Error())
		} else if canonical {
			if result, served, err := s.readDeterministic(model, &input.Body.Settings); err != nil {
				return nil, huma.Error500InternalServerError(err.Error())
			} else if served {
				output := &deterministicOutput{Status: http.StatusOK, Source: projectionSourceComputed}
				output.Body.Result = clipProjectionRange(result, input.Body.Range)
				return output, nil
			}
			if err := s.buildDeterministic(model, &input.Body.Settings); err == nil {
				if result, served, err := s.readDeterministic(model, &input.Body.Settings); err == nil && served {
					output := &deterministicOutput{Status: http.StatusOK, Source: projectionSourceComputed}
					output.Body.Result = clipProjectionRange(result, input.Body.Range)
					return output, nil
				}
			} else {
				log.Printf("deterministic build failed, computing directly: %v", err)
			}
		}
	}

	log.Printf("deterministic compute accounts=%d postings=%d checkpoints=%d horizon=%d range=%s",
		len(model.Accounts), len(model.Postings), len(model.Checkpoints),
		input.Body.Settings.HorizonYears, formatProjectionRange(input.Body.Range))

	result, err := domain.ProjectFinancialModel(model, &input.Body.Settings, input.Body.Overrides, nil)
	// huma writes Status verbatim; leaving it zero panics the writer.
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
	output.Body.Result = clipProjectionRange(result, input.Body.Range)
	return output, nil
}

func isEmptyOverrides(overrides types.ModelOverrides) bool {
	return len(overrides.AddedAccounts) == 0 && len(overrides.AddedPostings) == 0 &&
		len(overrides.AddedRules) == 0 && len(overrides.DisabledAccountIDs) == 0 &&
		len(overrides.DisabledPostingIDs) == 0 && len(overrides.DisabledScheduleIDs) == 0
}
