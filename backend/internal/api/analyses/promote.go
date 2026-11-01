package analyses

import (
	"context"
	"errors"
	"sync"

	"github.com/danielgtaylor/huma/v2"
	"github.com/google/uuid"
	"github.com/simhozebs/net-worth-estimator/backend/internal/api/model"
	"github.com/simhozebs/net-worth-estimator/backend/internal/store"
	"github.com/simhozebs/net-worth-estimator/backend/internal/types"
)

// promoteMu serializes approvals within one server instance. Preview, link
// record, and rule creation are separate store calls; without this, two
// concurrent approvals for one pattern could both pass preview and each
// create their own rule. The store contract already assumes one server and
// one instance, so a process-wide mutex matches the deployment.
var promoteMu sync.Mutex

func promotionError(err error) error {
	return promotionErrorAs(err, "The forecast preview is temporarily unavailable")
}

func promotionErrorAs(err error, unavailable string) error {
	switch {
	case errors.Is(err, store.ErrNotFound):
		return huma.Error404NotFound("Finding not found")
	case errors.Is(err, store.ErrRecurringPromotionInvalid):
		return huma.Error422UnprocessableEntity(err.Error())
	case errors.Is(err, store.ErrRecurringPromotionConflict):
		return huma.Error409Conflict(err.Error())
	default:
		return huma.Error500InternalServerError(unavailable)
	}
}

func (s *handler) previewRecurringPromotion(_ context.Context, input *struct {
	ID string `path:"id"`
}) (*struct {
	CacheControl string `header:"Cache-Control"`
	Body         struct {
		Preview types.RecurringPromotionPreview `json:"preview"`
	}
}, error) {
	preview, err := s.store.PreviewRecurringPromotion(input.ID)
	if err != nil {
		return nil, promotionError(err)
	}
	output := &struct {
		CacheControl string `header:"Cache-Control"`
		Body         struct {
			Preview types.RecurringPromotionPreview `json:"preview"`
		}
	}{CacheControl: "private, no-store"}
	output.Body.Preview = preview
	return output, nil
}

func (s *handler) promoteRecurringPattern(ctx context.Context, input *struct {
	ID string `path:"id"`
}) (*struct {
	Body struct {
		Row        types.RecurrenceRule         `json:"row"`
		Issues     []types.ModelValidationIssue `json:"issues"`
		Persisted  bool                         `json:"persisted"`
		Revision   string                       `json:"revision"`
		PatternKey string                       `json:"patternKey"`
	}
}, error) {
	if s.canWrite != nil && !s.canWrite(ctx) {
		return nil, huma.Error403Forbidden("Write permission is required")
	}
	promoteMu.Lock()
	defer promoteMu.Unlock()
	preview, err := s.store.PreviewRecurringPromotion(input.ID)
	if err != nil {
		return nil, promotionErrorAs(err, "The forecast rule could not be saved.")
	}
	if !preview.Promotable {
		// A visible plan without a rule cannot become one yet. A visible
		// plan with a rule waits on approval state: confirmation first,
		// then at most one active rule per pattern.
		if preview.Rule == nil {
			return nil, huma.Error422UnprocessableEntity(preview.Reason)
		}
		return nil, huma.Error409Conflict(preview.Reason)
	}
	ruleID, err := uuid.NewV7()
	if err != nil {
		return nil, huma.Error500InternalServerError("The forecast rule could not be saved.")
	}
	rule := types.RecurrenceRule{
		ID:              ruleID.String(),
		Name:            preview.Rule.Name,
		SourceAccountID: preview.Rule.SourceAccountID,
		Destinations:    append([]string(nil), preview.Rule.Destinations...),
		Amount:          types.PostingAmountResolution{Resolver: "expression", Config: map[string]any{"expression": preview.Rule.Amount}, Inputs: map[string]types.AmountInputBinding{}},
		Frequency:       preview.Rule.Frequency,
		StartDate:       preview.Rule.StartDate,
		Enabled:         true,
	}
	// Record the pattern-to-rule link before creating the rule row. A link
	// without a rule reads as inactive, so a retry after an interrupted
	// approval replaces the link instead of creating a second rule.
	if err := s.store.RecordRecurringPromotion(types.RecurringPromotion{PatternKey: preview.PatternKey, RuleID: rule.ID}); err != nil {
		return nil, huma.Error500InternalServerError("The forecast rule could not be saved.")
	}
	row, issues, persisted, revision, err := model.PersistFinanceRule(s.store, rule)
	if err != nil || !persisted {
		// Leave a concurrent winner's link alone: remove only our own.
		_ = s.store.RemoveRecurringPromotion(preview.PatternKey, rule.ID)
		if err != nil {
			return nil, err
		}
		return nil, huma.Error409Conflict("The saved data changed. Review the pattern again.")
	}
	output := &struct {
		Body struct {
			Row        types.RecurrenceRule         `json:"row"`
			Issues     []types.ModelValidationIssue `json:"issues"`
			Persisted  bool                         `json:"persisted"`
			Revision   string                       `json:"revision"`
			PatternKey string                       `json:"patternKey"`
		}
	}{}
	output.Body.Row, output.Body.Issues, output.Body.Persisted, output.Body.Revision, output.Body.PatternKey = row, issues, persisted, revision, preview.PatternKey
	return output, nil
}
