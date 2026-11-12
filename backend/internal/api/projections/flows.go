package projections

import (
	"context"
	"net/http"

	"github.com/danielgtaylor/huma/v2"

	"github.com/simhozebs/net-worth-estimator/backend/internal/domain"
	"github.com/simhozebs/net-worth-estimator/backend/internal/types"
)

type flowsOutput struct {
	Status int `json:"-"`
	Body   struct {
		Graph  *types.FlowGraph             `json:"graph,omitempty"`
		Issues []types.ModelValidationIssue `json:"issues,omitempty"`
		Error  string                       `json:"error,omitempty"`
	}
}

// flowWindow resolves the graph window from the requested range: explicit
// bounds win, an omitted bound falls back to the clipped data extent, and
// empty data falls back to the one given bound. The graph always names a
// concrete window.
func flowWindow(r *projectionRange, rows []types.ProjectionRow, events []types.TransactionEvent) (string, string) {
	start, end := r.StartDate, r.EndDate
	for _, row := range rows {
		date := string(row.Date)
		if start == "" || date < start {
			start = date
		}
		if end == "" || date > end {
			end = date
		}
	}
	for _, event := range events {
		date := string(event.Date)
		if start == "" || date < start {
			start = date
		}
		if end == "" || date > end {
			end = date
		}
	}
	if start == "" {
		start = end
	}
	if end == "" {
		end = start
	}
	return start, end
}

func (s *handler) flowGraph(_ context.Context, input *struct {
	Body projectionRequestBody
}) (*flowsOutput, error) {
	if err := validateProjectionRange(input.Body.Range); err != nil {
		return nil, err
	}
	model, err := s.resolveModel(input.Body.Model)
	if err != nil {
		return nil, huma.Error500InternalServerError(err.Error())
	}

	output := &flowsOutput{Status: http.StatusOK}
	path, result, err := domain.ProjectRawFinancialModel(model, &input.Body.Settings, input.Body.Overrides, nil)
	if err != nil {
		output.Body.Error = err.Error()
		if preparationError, ok := err.(*domain.SimulationPreparationError); ok {
			// Validation failures stay HTTP 200: callers read the issue
			// list from the body as model diagnostics.
			output.Body.Issues = preparationError.Issues
			return output, nil
		}
		output.Status = http.StatusInternalServerError
		return output, nil
	}
	clipped := clipProjectionRange(result, input.Body.Range)
	start, end := flowWindow(input.Body.Range, clipped.Timeline.Rows, clipped.TransactionEvents)
	links, err := s.store.ListTransferLinks()
	if err != nil {
		return nil, huma.Error500InternalServerError(err.Error())
	}
	graph, err := domain.BuildFlowGraphWithLinks(&path.EffectiveModel, clipped.TransactionEvents, clipped.Timeline.Rows, start, end, domain.TransferLinkPairs(links))
	if err != nil {
		return nil, huma.Error500InternalServerError(err.Error())
	}
	output.Body.Graph = graph
	return output, nil
}
