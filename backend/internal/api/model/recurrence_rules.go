package model

import (
	"context"

	"github.com/danielgtaylor/huma/v2"
	"github.com/simhozebs/net-worth-estimator/backend/internal/api/internal/modelstate"
	"github.com/simhozebs/net-worth-estimator/backend/internal/types"
)

type ruleBody struct {
	ID              *string                   `json:"id,omitempty"`
	Name            string                    `json:"name"`
	SourceAccountID *string                   `json:"sourceAccountId,omitempty"`
	Destinations    []string                  `json:"destinations,omitempty"`
	Amount          amountInput               `json:"amount"`
	Frequency       types.RecurrenceFrequency `json:"frequency"`
	StartDate       types.IsoDate             `json:"startDate"`
	EndDate         *types.IsoDate            `json:"endDate,omitempty"`
	AnnualCap       *float64                  `json:"annualCap,omitempty"`
	// Priority orders rules sharing a day. Omitted on create appends after
	// the current maximum; omitted on update keeps the stored priority, so
	// editors that never model priority leave it alone.
	Priority *int `json:"priority,omitempty"`
	Enabled  bool `json:"enabled"`
}

func (b ruleBody) toRule(id string, priority int) (types.RecurrenceRule, error) {
	amount, err := b.Amount.resolution()
	if err != nil {
		return types.RecurrenceRule{}, err
	}
	out := types.RecurrenceRule{
		Name: b.Name, SourceAccountID: b.SourceAccountID,
		Destinations: b.Destinations, Amount: amount, Frequency: b.Frequency,
		StartDate: b.StartDate, EndDate: b.EndDate,
		AnnualCap: b.AnnualCap, Priority: priority, Enabled: b.Enabled,
	}
	if b.ID != nil {
		out.ID = *b.ID
	}
	if id != "" {
		out.ID = id
	}
	return out, nil
}

// ruleUpdateBody states only the members an edit changes. Absent members keep
// their stored value; a null member clears a nullable field. Priority and cap
// are ordinary patch members: absent keeps, present replaces, null clears the
// cap.
type ruleUpdateBody struct {
	// ID is accepted and ignored: stored rows replayed as an update carry
	// their identity, which the path already states.
	ID              optional[string]                    `json:"id,omitempty"`
	Name            optional[string]                    `json:"name,omitempty"`
	SourceAccountID nullableOptional[string]            `json:"sourceAccountId,omitempty"`
	Destinations    nullableOptional[[]string]          `json:"destinations,omitempty"`
	Amount          optional[amountInput]               `json:"amount,omitempty"`
	Frequency       optional[types.RecurrenceFrequency] `json:"frequency,omitempty"`
	StartDate       optional[types.IsoDate]             `json:"startDate,omitempty"`
	EndDate         nullableOptional[types.IsoDate]     `json:"endDate,omitempty"`
	AnnualCap       nullableOptional[float64]           `json:"annualCap,omitempty"`
	Priority        optional[int]                       `json:"priority,omitempty"`
	Enabled         optional[bool]                      `json:"enabled,omitempty"`
}

func (p ruleUpdateBody) apply(stored types.RecurrenceRule) (types.RecurrenceRule, error) {
	out := stored
	if p.Name.Set {
		out.Name = p.Name.Value
	}
	if p.SourceAccountID.Set {
		if p.SourceAccountID.Null {
			out.SourceAccountID = nil
		} else {
			value := p.SourceAccountID.Value
			out.SourceAccountID = &value
		}
	}
	if p.Destinations.Set {
		if p.Destinations.Null {
			out.Destinations = nil
		} else {
			out.Destinations = p.Destinations.Value
		}
	}
	if p.Amount.Set {
		amount, err := p.Amount.Value.resolution()
		if err != nil {
			return types.RecurrenceRule{}, err
		}
		out.Amount = amount
	}
	if p.Frequency.Set {
		out.Frequency = p.Frequency.Value
	}
	if p.StartDate.Set {
		out.StartDate = p.StartDate.Value
	}
	if p.EndDate.Set {
		if p.EndDate.Null {
			out.EndDate = nil
		} else {
			value := p.EndDate.Value
			out.EndDate = &value
		}
	}
	if p.AnnualCap.Set {
		if p.AnnualCap.Null {
			out.AnnualCap = nil
		} else {
			value := p.AnnualCap.Value
			out.AnnualCap = &value
		}
	}
	if p.Priority.Set {
		out.Priority = p.Priority.Value
	}
	if p.Enabled.Set {
		out.Enabled = p.Enabled.Value
	}
	return out, nil
}

type ruleInput struct {
	Body ruleBody `json:"body"`
}

type ruleOutput struct {
	Body writeResult[types.RecurrenceRule] `json:"body"`
}

func ruleID(rule types.RecurrenceRule) string { return rule.ID }

func (s *handler) createRule(_ context.Context, input *ruleInput) (*ruleOutput, error) {
	priority := 0
	if input.Body.Priority != nil {
		priority = *input.Body.Priority
	}
	rule, err := input.Body.toRule("", priority)
	if err != nil {
		return nil, huma.Error422UnprocessableEntity(err.Error())
	}
	row, issues, saved, revision, err := runFinanceRowWrite(s, func(model *types.FinancialModel) {
		if input.Body.Priority == nil {
			// Omitted priority appends after the current maximum, so callers
			// that never model ordering leave it out.
			max := -1
			for _, existing := range model.RecurrenceRules {
				if existing.Priority > max {
					max = existing.Priority
				}
			}
			priority = max + 1
			next, buildErr := input.Body.toRule("", priority)
			if buildErr != nil {
				return
			}
			rule = next
		}
		model.RecurrenceRules = replaceByID(model.RecurrenceRules, rule.ID, ruleID, rule)
	}, func() (types.RecurrenceRule, error) {
		return s.store.CreateRule(rule)
	})
	if err != nil {
		return nil, err
	}
	return &ruleOutput{Body: writeResult[types.RecurrenceRule]{Result: row, Issues: issues, Saved: saved, Revision: revision}}, nil
}

func (s *handler) updateRule(_ context.Context, input *struct {
	ID   string         `path:"id"`
	Body ruleUpdateBody `json:"body"`
}) (*ruleOutput, error) {
	stored, err := s.store.LoadModel()
	if err != nil {
		return nil, huma.Error500InternalServerError(err.Error())
	}
	var existing types.RecurrenceRule
	found := false
	if stored != nil {
		for _, rule := range stored.RecurrenceRules {
			if rule.ID == input.ID {
				existing, found = rule, true
				break
			}
		}
	}
	if !found {
		return nil, huma.Error404NotFound("recurrence rule " + input.ID + " does not exist")
	}
	rule, err := input.Body.apply(existing)
	if err != nil {
		return nil, huma.Error422UnprocessableEntity(err.Error())
	}
	row, issues, saved, revision, err := runFinanceRowWrite(s, func(model *types.FinancialModel) {
		model.RecurrenceRules = replaceByID(model.RecurrenceRules, rule.ID, ruleID, rule)
	}, func() (types.RecurrenceRule, error) {
		return s.store.UpdateRule(rule)
	})
	if err != nil {
		return nil, err
	}
	return &ruleOutput{Body: writeResult[types.RecurrenceRule]{Result: row, Issues: issues, Saved: saved, Revision: revision}}, nil
}

func (s *handler) deleteRule(_ context.Context, input *struct {
	ID string `path:"id"`
}) (*modelstate.ReorderOutput, error) {
	id := input.ID
	_, _, _, revision, err := runFinanceRowWrite(s, func(model *types.FinancialModel) {
		model.RecurrenceRules = removeByID(model.RecurrenceRules, id, ruleID)
	}, func() (struct{}, error) {
		return struct{}{}, s.store.DeleteRule(id)
	})
	if err != nil {
		return nil, err
	}
	return &modelstate.ReorderOutput{Body: struct {
		Revision string `json:"revision"`
	}{Revision: revision}}, nil
}

func (s *handler) moveRule(_ context.Context, input *reorderInput) (*modelstate.ReorderOutput, error) {
	id, beforeID := input.Body.ID, input.Body.BeforeID
	_, _, _, revision, err := runFinanceRowWrite(s, func(model *types.FinancialModel) {
		model.RecurrenceRules = moveBeforeID(model.RecurrenceRules, id, beforeID, ruleID)
	}, func() (struct{}, error) {
		return struct{}{}, s.store.MoveRule(id, beforeID)
	})
	if err != nil {
		return nil, err
	}
	return &modelstate.ReorderOutput{Body: struct {
		Revision string `json:"revision"`
	}{Revision: revision}}, nil
}
