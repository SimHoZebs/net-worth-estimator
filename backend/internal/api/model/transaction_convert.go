package model

import (
	"context"

	"github.com/danielgtaylor/huma/v2"
	"github.com/simhozebs/net-worth-estimator/backend/internal/types"
)

// convertTransactionBody moves one transaction across the posting/rule tables.
// The frontend declares the target row; the backend deletes the old row and
// inserts the new one in one transaction, so a kind change can never leave
// a deleted row without its replacement.
type convertTransactionBody struct {
	// Kind is the target row kind: posting for once, rule for recurring.
	Kind    string       `json:"kind"`
	Posting *postingBody `json:"posting,omitempty"`
	Rule    *ruleBody    `json:"rule,omitempty"`
}

type convertTransactionOutput struct {
	Body struct {
		ID        string                       `json:"id"`
		Kind      string                       `json:"kind"`
		Issues    []types.ModelValidationIssue `json:"issues"`
		Persisted bool                         `json:"persisted"`
		Revision  string                       `json:"revision"`
	} `json:"body"`
}

func (s *handler) convertTransaction(_ context.Context, input *struct {
	ID   string                 `path:"id"`
	Body convertTransactionBody `json:"body"`
},
) (*convertTransactionOutput, error) {
	id := input.ID
	var kind string
	switch input.Body.Kind {
	case "posting":
		if input.Body.Posting == nil {
			return nil, huma.Error422UnprocessableEntity("convert to posting requires a posting body")
		}
		kind = "posting"
	case "rule":
		if input.Body.Rule == nil {
			return nil, huma.Error422UnprocessableEntity("convert to rule requires a rule body")
		}
		kind = "rule"
	default:
		return nil, huma.Error422UnprocessableEntity(`convert kind must be "posting" or "rule"`)
	}
	current, err := s.store.LoadDocument()
	if err != nil {
		return nil, huma.Error500InternalServerError(err.Error())
	}
	if current != nil {
		for _, posting := range current.Postings {
			if posting.ID == id && kind == "posting" {
				return nil, huma.Error422UnprocessableEntity("transaction is already a posting; use PATCH")
			}
		}
		for _, rule := range current.RecurrenceRules {
			if rule.ID == id && kind == "rule" {
				return nil, huma.Error422UnprocessableEntity("transaction is already a rule; use PATCH")
			}
		}
	}
	var posting types.Posting
	var rule types.RecurrenceRule
	if current != nil {
		// Convert echoes the display destination like an update does; keep
		// a stored multi-destination set on an unchanged echo.
		for _, existing := range current.Postings {
			if existing.ID == id && kind == "rule" && input.Body.Rule != nil {
				input.Body.Rule.Destinations = keepEchoedDestinations(existing.Destinations, input.Body.Rule.Destinations)
			}
		}
		for _, existing := range current.RecurrenceRules {
			if existing.ID == id && kind == "posting" && input.Body.Posting != nil {
				input.Body.Posting.Destinations = keepEchoedDestinations(existing.Destinations, input.Body.Posting.Destinations)
			}
		}
	}
	_, issues, persisted, revision, err := runRowWrite(s, func(document *types.FinancialModelDocument) {
		document.Postings = removeByID(document.Postings, id, postingID)
		document.RecurrenceRules = removeByID(document.RecurrenceRules, id, ruleID)
		if kind == "rule" {
			priority := 0
			if input.Body.Rule.Priority != nil {
				priority = *input.Body.Rule.Priority
			} else {
				max := -1
				for _, existing := range document.RecurrenceRules {
					if existing.Priority > max {
						max = existing.Priority
					}
				}
				priority = max + 1
			}
			rule = input.Body.Rule.toRule(id, priority)
			document.RecurrenceRules = replaceByID(document.RecurrenceRules, rule.ID, ruleID, rule)
		} else {
			posting = input.Body.Posting.toPosting(id)
			document.Postings = replaceByID(document.Postings, posting.ID, postingID, posting)
		}
	}, func() (struct{}, error) {
		if kind == "rule" {
			_, err := s.store.ConvertPostingToRule(id, rule)
			return struct{}{}, err
		}
		_, err := s.store.ConvertRuleToPosting(id, posting)
		return struct{}{}, err
	})
	if err != nil {
		return nil, err
	}
	output := &convertTransactionOutput{}
	output.Body.ID = id
	output.Body.Kind = kind
	output.Body.Issues = issues
	output.Body.Persisted = persisted
	output.Body.Revision = revision
	return output, nil
}
