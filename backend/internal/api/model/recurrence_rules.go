package model

import (
	"context"

	"github.com/simhozebs/net-worth-estimator/backend/internal/types"
)

type ruleBody struct {
	ID              *string                       `json:"id,omitempty"`
	Name            string                        `json:"name"`
	SourceAccountID *string                       `json:"sourceAccountId,omitempty"`
	Destinations    []string                      `json:"destinations,omitempty"`
	Amount          types.PostingAmountResolution `json:"amount"`
	Frequency       types.RecurrenceFrequency     `json:"frequency"`
	StartDate       types.IsoDate                 `json:"startDate"`
	EndDate         *types.IsoDate                `json:"endDate,omitempty"`
	AnnualCap       *float64                      `json:"annualCap,omitempty"`
	// Priority orders rules sharing a day. Omitted on create appends after
	// the current maximum; omitted on update keeps the stored priority, so
	// editors that never model priority leave it alone.
	Priority *int `json:"priority,omitempty"`
	Enabled  bool `json:"enabled"`
}

func (b ruleBody) toRule(id string, priority int) types.RecurrenceRule {
	out := types.RecurrenceRule{
		Name: b.Name, SourceAccountID: b.SourceAccountID,
		Destinations: b.Destinations, Amount: b.Amount, Frequency: b.Frequency,
		StartDate: b.StartDate, EndDate: b.EndDate,
		AnnualCap: b.AnnualCap, Priority: priority, Enabled: b.Enabled,
	}
	if b.ID != nil {
		out.ID = *b.ID
	}
	if id != "" {
		out.ID = id
	}
	return out
}

type ruleInput struct {
	Body ruleBody `json:"body"`
}

type ruleOutput struct {
	Body rowResultBody[types.RecurrenceRule] `json:"body"`
}

func ruleID(rule types.RecurrenceRule) string { return rule.ID }

func (s *handler) createRule(_ context.Context, input *ruleInput) (*ruleOutput, error) {
	priority := 0
	if input.Body.Priority != nil {
		priority = *input.Body.Priority
	}
	rule := input.Body.toRule("", priority)
	row, issues, persisted, revision, err := runRowWrite(s, func(model *types.FinancialModel) {
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
			rule = input.Body.toRule("", priority)
		}
		model.RecurrenceRules = replaceByID(model.RecurrenceRules, rule.ID, ruleID, rule)
	}, func() (types.RecurrenceRule, error) {
		return s.store.CreateRule(rule)
	})
	if err != nil {
		return nil, err
	}
	return &ruleOutput{Body: rowResultBody[types.RecurrenceRule]{Row: row, Issues: issues, Persisted: persisted, Revision: revision}}, nil
}

func (s *handler) updateRule(_ context.Context, input *struct {
	ID   string   `path:"id"`
	Body ruleBody `json:"body"`
}) (*ruleOutput, error) {
	priority := input.Body.Priority
	annualCap := input.Body.AnnualCap
	destinations := input.Body.Destinations
	if priority == nil || annualCap == nil || len(destinations) == 1 {
		// Omitted optionals keep their stored values: the editor never
		// models priority or caps, so absent means untouched, not cleared.
		// Single destinations get the same echo treatment via
		// keepEchoedDestinations, since the editor never models extra legs.
		if stored, err := s.store.LoadModel(); err == nil && stored != nil {
			for _, existing := range stored.RecurrenceRules {
				if existing.ID != input.ID {
					continue
				}
				if priority == nil {
					kept := existing.Priority
					priority = &kept
				}
				if annualCap == nil {
					annualCap = existing.AnnualCap
				}
				destinations = keepEchoedDestinations(existing.Destinations, destinations)
			}
		}
	}
	rulePriority := 0
	if priority != nil {
		rulePriority = *priority
	}
	input.Body.Destinations = destinations
	rule := input.Body.toRule(input.ID, rulePriority)
	rule.AnnualCap = annualCap
	row, issues, persisted, revision, err := runRowWrite(s, func(model *types.FinancialModel) {
		model.RecurrenceRules = replaceByID(model.RecurrenceRules, rule.ID, ruleID, rule)
	}, func() (types.RecurrenceRule, error) {
		return s.store.UpdateRule(rule)
	})
	if err != nil {
		return nil, err
	}
	return &ruleOutput{Body: rowResultBody[types.RecurrenceRule]{Row: row, Issues: issues, Persisted: persisted, Revision: revision}}, nil
}

func (s *handler) deleteRule(_ context.Context, input *struct {
	ID string `path:"id"`
}) (*reorderOutput, error) {
	id := input.ID
	_, _, _, revision, err := runRowWrite(s, func(model *types.FinancialModel) {
		model.RecurrenceRules = removeByID(model.RecurrenceRules, id, ruleID)
	}, func() (struct{}, error) {
		return struct{}{}, s.store.DeleteRule(id)
	})
	if err != nil {
		return nil, err
	}
	return &reorderOutput{Body: struct {
		Revision string `json:"revision"`
	}{Revision: revision}}, nil
}

func (s *handler) moveRule(_ context.Context, input *reorderInput) (*reorderOutput, error) {
	id, beforeID := input.Body.ID, input.Body.BeforeID
	_, _, _, revision, err := runRowWrite(s, func(model *types.FinancialModel) {
		model.RecurrenceRules = moveBeforeID(model.RecurrenceRules, id, beforeID, ruleID)
	}, func() (struct{}, error) {
		return struct{}{}, s.store.MoveRule(id, beforeID)
	})
	if err != nil {
		return nil, err
	}
	return &reorderOutput{Body: struct {
		Revision string `json:"revision"`
	}{Revision: revision}}, nil
}
