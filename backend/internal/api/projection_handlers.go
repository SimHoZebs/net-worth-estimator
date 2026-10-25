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
	// Window selects which timeline slice to return: "history" (past to
	// projection start), "projection" (projection start onward), or "both"
	// (default). The stored artifact is always the full result; the window
	// only filters the response, so a history request warms the later full
	// request instead of computing twice.
	Window string `json:"window,omitempty"`
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
	window := input.Body.Window
	if window == "" {
		window = "both"
	}
	if window != "history" && window != "projection" && window != "both" {
		return nil, huma.Error400BadRequest("window must be history, projection, or both")
	}
	document, err := s.resolveDocument(input.Body.Document)
	if err != nil {
		return nil, huma.Error500InternalServerError(err.Error())
	}

	// Key the RESOLVED document so omitted fields track the
	// stored state: a model save changes stored content and therefore the key.
	// The window stays out of the key: history and full requests share one
	// stored artifact, and a history request warms the full one.
	cacheKey := s.resourceArtifactKey("deterministic", map[string]any{
		"publicResultVersion": deterministicResultCacheVersion,
		"document":            document,
		"overrides":           input.Body.Overrides,
		"settings":            projectionSettingsDescriptor(input.Body.Settings),
	})
	if cached, err := lookupArtifact[types.ProjectionResult](s.store, cacheKey); err == nil && cached.hit {
		// huma writes Status verbatim; leaving it zero panics the writer.
		output := &deterministicOutput{Status: http.StatusOK, Cache: "hit"}
		cachedCopy := cached.value
		output.Body.Result = filterProjectionWindow(&cachedCopy, window)
		return output, nil
	}
	_, prefix := parseArtifactKeyMeta(cacheKey)
	log.Printf("deterministic recalc key_prefix=%s accounts=%d postings=%d checkpoints=%d horizon=%d window=%s",
		prefix, len(document.Accounts), len(document.Postings), len(document.Checkpoints),
		input.Body.Settings.HorizonYears, window)

	result, err := domain.ProjectFinancialModelDocument(document, &input.Body.Settings, input.Body.Overrides, nil)
	// huma writes this status verbatim; default to 200 and only raise it for
	// unexpected failures.
	output := &deterministicOutput{Status: http.StatusOK, Cache: "miss"}
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
	output.Body.Result = filterProjectionWindow(result, window)
	return output, nil
}

// filterProjectionWindow returns the requested timeline slice. It builds new
// row and event slices and never mutates the cached or computed result, so
// shared backing arrays stay intact for later requests.
func filterProjectionWindow(result *types.ProjectionResult, window string) *types.ProjectionResult {
	if window == "both" {
		return result
	}
	filtered := *result
	if window == "history" {
		rows := make([]types.ProjectionRow, 0, len(result.Timeline.Rows))
		for _, row := range result.Timeline.Rows {
			if row.IsHistorical {
				rows = append(rows, row)
			}
		}
		filtered.Timeline.Rows = rows
		filtered.MovementEvents = nil
		// Empty arrays, not nulls: readers map over the non-optional
		// tables without nil checks. PlannedPurchases stays omitempty
		// and is therefore absent rather than []. Totals, summary,
		// milestones, and account summaries keep full-result values;
		// only rows (plus history events/evaluations) are sliced.
		filtered.Evaluations = types.EvaluationResultTables{
			FinancialIndependence: []types.EvaluationResultEnvelope{},
			NetWorthThreshold:     []types.EvaluationResultEnvelope{},
			AccountBalance:        []types.EvaluationResultEnvelope{},
			PostingFulfillment:    []types.EvaluationResultEnvelope{},
			CycleFulfillment:      []types.EvaluationResultEnvelope{},
			PlannedPurchases:      []types.EvaluationResultEnvelope{},
		}
		return &filtered
	}
	rows := make([]types.ProjectionRow, 0, len(result.Timeline.Rows))
	for _, row := range result.Timeline.Rows {
		if !row.IsHistorical {
			rows = append(rows, row)
		}
	}
	filtered.Timeline.Rows = rows
	return &filtered
}
