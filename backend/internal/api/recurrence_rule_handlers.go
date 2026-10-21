package api

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
	Priority        int                           `json:"priority"`
	Enabled         bool                          `json:"enabled"`
}

func (b ruleBody) toRule(id string) types.RecurrenceRule {
	out := types.RecurrenceRule{
		Name: b.Name, SourceAccountID: b.SourceAccountID,
		Destinations: b.Destinations, Amount: b.Amount, Frequency: b.Frequency,
		StartDate: b.StartDate, EndDate: b.EndDate,
		AnnualCap: b.AnnualCap, Priority: b.Priority, Enabled: b.Enabled,
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

func (s *Server) createRule(_ context.Context, input *ruleInput) (*ruleOutput, error) {
	rule := input.Body.toRule("")
	row, issues, persisted, revision, err := runRowWrite(s, func(document *types.FinancialModelDocument) {
		document.RecurrenceRules = replaceByID(document.RecurrenceRules, rule.ID, ruleID, rule)
	}, func() (types.RecurrenceRule, error) {
		return s.store.CreateRule(rule)
	})
	if err != nil {
		return nil, err
	}
	return &ruleOutput{Body: rowResultBody[types.RecurrenceRule]{Row: row, Issues: issues, Persisted: persisted, Revision: revision}}, nil
}

func (s *Server) updateRule(_ context.Context, input *struct {
	ID   string   `path:"id"`
	Body ruleBody `json:"body"`
}) (*ruleOutput, error) {
	rule := input.Body.toRule(input.ID)
	row, issues, persisted, revision, err := runRowWrite(s, func(document *types.FinancialModelDocument) {
		document.RecurrenceRules = replaceByID(document.RecurrenceRules, rule.ID, ruleID, rule)
	}, func() (types.RecurrenceRule, error) {
		return s.store.UpdateRule(rule)
	})
	if err != nil {
		return nil, err
	}
	return &ruleOutput{Body: rowResultBody[types.RecurrenceRule]{Row: row, Issues: issues, Persisted: persisted, Revision: revision}}, nil
}

func (s *Server) deleteRule(_ context.Context, input *struct {
	ID string `path:"id"`
}) (*reorderOutput, error) {
	id := input.ID
	_, _, _, revision, err := runRowWrite(s, func(document *types.FinancialModelDocument) {
		document.RecurrenceRules = removeByID(document.RecurrenceRules, id, ruleID)
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

func (s *Server) moveRule(_ context.Context, input *reorderInput) (*reorderOutput, error) {
	id, beforeID := input.Body.ID, input.Body.BeforeID
	_, _, _, revision, err := runRowWrite(s, func(document *types.FinancialModelDocument) {
		document.RecurrenceRules = moveBeforeID(document.RecurrenceRules, id, beforeID, ruleID)
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
