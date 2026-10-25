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
	// Range clips the returned timeline to [startDate, endDate], both
	// inclusive ISO dates. Either bound may be omitted for an open end;
	// an omitted range returns everything. The stored artifact is always
	// the full result, so a narrow request warms the later full one.
	Range *projectionRange `json:"range,omitempty"`
}

// projectionRange is a closed date interval over the timeline.
type projectionRange struct {
	StartDate string `json:"startDate,omitempty"`
	EndDate   string `json:"endDate,omitempty"`
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
	if err := validateProjectionRange(input.Body.Range); err != nil {
		return nil, err
	}
	document, err := s.resolveDocument(input.Body.Document)
	if err != nil {
		return nil, huma.Error500InternalServerError(err.Error())
	}

	// Key the RESOLVED document so omitted fields track the
	// stored state: a model save changes stored content and therefore the key.
	// The range stays out of the key: narrow and full requests share one
	// stored artifact, and a narrow request warms the full one.
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
	output.Body.Result = clipProjectionRange(result, input.Body.Range)
	return output, nil
}

// validateProjectionRange rejects malformed or inverted intervals before
// any resolve, lookup, or compute. ISO dates compare lexicographically.
func validateProjectionRange(r *projectionRange) error {
	if r == nil {
		return nil
	}
	for _, date := range []string{r.StartDate, r.EndDate} {
		if date != "" && !domain.IsValidIsoDate(date) {
			return huma.Error400BadRequest("range dates must be YYYY-MM-DD")
		}
	}
	if r.StartDate != "" && r.EndDate != "" && r.StartDate > r.EndDate {
		return huma.Error400BadRequest("range startDate must not be after endDate")
	}
	return nil
}

// formatProjectionRange renders the range for recalc log lines.
func formatProjectionRange(r *projectionRange) string {
	if r == nil {
		return "full"
	}
	start, end := r.StartDate, r.EndDate
	if start == "" {
		start = "beginning"
	}
	if end == "" {
		end = "end"
	}
	return start + ".." + end
}

// clipProjectionRange returns the requested timeline slice. It builds new
// row and event slices and never mutates the cached or computed result, so
// shared backing arrays stay intact for later requests. Evaluations ride
// along only when the slice holds projected rows: they summarize the whole
// projection and are meaningless over history alone.
func clipProjectionRange(result *types.ProjectionResult, r *projectionRange) *types.ProjectionResult {
	if r == nil {
		return result
	}
	filtered := *result
	rows := make([]types.ProjectionRow, 0, len(result.Timeline.Rows))
	for _, row := range result.Timeline.Rows {
		if r.StartDate != "" && row.Date < types.IsoDate(r.StartDate) {
			continue
		}
		if r.EndDate != "" && row.Date > types.IsoDate(r.EndDate) {
			continue
		}
		rows = append(rows, row)
	}
	filtered.Timeline.Rows = rows
	events := make([]types.MovementEvent, 0, len(result.MovementEvents))
	for _, event := range result.MovementEvents {
		if r.StartDate != "" && event.Date < types.IsoDate(r.StartDate) {
			continue
		}
		if r.EndDate != "" && event.Date > types.IsoDate(r.EndDate) {
			continue
		}
		events = append(events, event)
	}
	filtered.MovementEvents = events
	hasProjected := false
	for _, row := range rows {
		if !row.IsHistorical {
			hasProjected = true
			break
		}
	}
	if !hasProjected {
		// Empty arrays, not nulls: readers map over the non-optional
		// tables without nil checks. PlannedPurchases stays omitempty
		// and is therefore absent rather than []. Totals, summary,
		// milestones, and account summaries keep full-result values;
		// only rows and events are clipped.
		filtered.Evaluations = types.EvaluationResultTables{
			FinancialIndependence: []types.EvaluationResultEnvelope{},
			NetWorthThreshold:     []types.EvaluationResultEnvelope{},
			AccountBalance:        []types.EvaluationResultEnvelope{},
			PostingFulfillment:    []types.EvaluationResultEnvelope{},
			CycleFulfillment:      []types.EvaluationResultEnvelope{},
			PlannedPurchases:      []types.EvaluationResultEnvelope{},
		}
	}
	return &filtered
}
