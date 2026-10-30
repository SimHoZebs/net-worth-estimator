package api

import (
	"github.com/danielgtaylor/huma/v2"

	"github.com/simhozebs/net-worth-estimator/backend/internal/domain"
	"github.com/simhozebs/net-worth-estimator/backend/internal/types"
)

// projectionRange selects response dates inclusively. Either bound may be omitted.
type projectionRange struct {
	StartDate string `json:"startDate,omitempty"`
	EndDate   string `json:"endDate,omitempty"`
}

func validateProjectionRange(r *projectionRange) error {
	if r == nil || (r.StartDate == "" && r.EndDate == "") {
		return huma.Error400BadRequest("range is required: set startDate and/or endDate")
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

// formatProjectionRange renders the range for simulation log lines.
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

func (r *projectionRange) contains(date types.IsoDate) bool {
	return (r.StartDate == "" || date >= types.IsoDate(r.StartDate)) &&
		(r.EndDate == "" || date <= types.IsoDate(r.EndDate))
}

// clipProjectionRange filters rows and transaction events by validated date bounds.
// All other sections remain unchanged. New slices preserve the source arrays;
// nested values remain shared and must be treated as read-only.
func clipProjectionRange(result *types.ProjectionResult, r *projectionRange) *types.ProjectionResult {
	if r == nil {
		return result
	}
	filtered := *result
	rows := make([]types.ProjectionRow, 0, len(result.Timeline.Rows))
	for _, row := range result.Timeline.Rows {
		if r.contains(row.Date) {
			rows = append(rows, row)
		}
	}
	filtered.Timeline.Rows = rows
	events := make([]types.TransactionEvent, 0, len(result.TransactionEvents))
	for _, event := range result.TransactionEvents {
		if r.contains(event.Date) {
			events = append(events, event)
		}
	}
	filtered.TransactionEvents = events
	return &filtered
}
