package model

import (
	"context"

	"github.com/danielgtaylor/huma/v2"
	"github.com/simhozebs/net-worth-estimator/backend/internal/api/internal/modelstate"
	"github.com/simhozebs/net-worth-estimator/backend/internal/store"
	"github.com/simhozebs/net-worth-estimator/backend/internal/types"
)

type postingBody struct {
	ID              *string             `json:"id,omitempty" format:"uuid"`
	Name            string              `json:"name"`
	SourceAccountID *string             `json:"sourceAccountId,omitempty"`
	Destinations    []string            `json:"destinations,omitempty"`
	Amount          amountInput         `json:"amount"`
	PostedTime      int64               `json:"postedTime"`
	TransactionTime int64               `json:"transactionTime"`
	Claim           *types.PostingClaim `json:"claim,omitempty"`
	Enabled         bool                `json:"enabled"`
	// Accepted and ignored: model import replays whole stored rows, and
	// ownership plus lifecycle stay server-computed.
	Source         *string `json:"source,omitempty"`
	Pending        *bool   `json:"pending,omitempty"`
	Void           *bool   `json:"void,omitempty"`
	ExecutionOrder *int64  `json:"executionOrder,omitempty"`
}

func (b postingBody) toPosting(id string) (types.Posting, error) {
	amount, err := b.Amount.literalResolution()
	if err != nil {
		return types.Posting{}, err
	}
	out := types.Posting{
		Name: b.Name, SourceAccountID: b.SourceAccountID,
		Destinations: b.Destinations, Amount: amount,
		PostedTime: b.PostedTime, TransactionTime: b.TransactionTime,
		Claim: b.Claim, Enabled: b.Enabled,
	}
	if b.ID != nil {
		out.ID = *b.ID
	}
	if id != "" {
		out.ID = id
	}
	return out, nil
}

// postingUpdateBody states only the members an edit changes. Absent members
// keep their stored value; a null member clears a nullable field. Server-owned
// source, pending, void, and execution-order fields are never authored here.
type postingUpdateBody struct {
	// ID is accepted and ignored: stored rows replayed as an update carry
	// their identity, which the path already states.
	ID              optional[string]                     `json:"id,omitempty"`
	Name            optional[string]                     `json:"name,omitempty"`
	SourceAccountID nullableOptional[string]             `json:"sourceAccountId,omitempty"`
	Destinations    nullableOptional[[]string]           `json:"destinations,omitempty"`
	Amount          optional[amountInput]                `json:"amount,omitempty"`
	PostedTime      optional[int64]                      `json:"postedTime,omitempty"`
	TransactionTime optional[int64]                      `json:"transactionTime,omitempty"`
	Claim           nullableOptional[types.PostingClaim] `json:"claim,omitempty"`
	Enabled         optional[bool]                       `json:"enabled,omitempty"`
	// Accepted and ignored so an imported stored row can be replayed as a
	// patch; ownership and lifecycle stay server-computed.
	Source         optional[string] `json:"source,omitempty"`
	Pending        optional[bool]   `json:"pending,omitempty"`
	Void           optional[bool]   `json:"void,omitempty"`
	ExecutionOrder optional[int64]  `json:"executionOrder,omitempty"`
}

// apply overlays the update on the stored row. Every nullable member keeps an
// explicit clear path, so an edit never has to restate the full row.
func (p postingUpdateBody) apply(stored types.Posting) (types.Posting, error) {
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
		amount, err := p.Amount.Value.literalResolution()
		if err != nil {
			return types.Posting{}, err
		}
		out.Amount = amount
	}
	if p.PostedTime.Set {
		out.PostedTime = p.PostedTime.Value
	}
	if p.TransactionTime.Set {
		out.TransactionTime = p.TransactionTime.Value
	}
	if p.Claim.Set {
		if p.Claim.Null {
			out.Claim = nil
		} else {
			claim := p.Claim.Value
			out.Claim = &claim
		}
	}
	if p.Enabled.Set {
		out.Enabled = p.Enabled.Value
	}
	return out, nil
}

type postingInput struct {
	Body postingBody `json:"body"`
}

type postingOutput struct {
	Body rowResultBody[types.Posting] `json:"body"`
}

func postingID(posting types.Posting) string { return posting.ID }

// keepEchoedDestinations preserves a stored multi-destination set when a row
// write echoes its display destination unchanged. The row endpoints carry a
// single display destination, so an unchanged echo cannot express intent to
// trim; an explicit change (different, cleared, or multi-valued) still
// replaces the set verbatim.
func keepEchoedDestinations(stored, incoming []string) []string {
	if len(incoming) == 1 && len(stored) > 1 && stored[0] == incoming[0] {
		return stored
	}
	return incoming
}

func (s *handler) createPosting(_ context.Context, input *postingInput) (*postingOutput, error) {
	posting, err := input.Body.toPosting("")
	if err != nil {
		return nil, huma.Error422UnprocessableEntity(err.Error())
	}

	row, issues, persisted, revision, err := runFinanceRowWrite(s, func(model *types.FinancialModel) {
		model.Postings = replaceByID(model.Postings, posting.ID, postingID, posting)
	}, func() (types.Posting, error) {
		return s.store.CreatePosting(posting)
	})
	if err != nil {
		return nil, err
	}
	if persisted {
		row.Source = store.SourceUser
	}
	return &postingOutput{Body: rowResultBody[types.Posting]{Row: row, Issues: issues, Persisted: persisted, Revision: revision}}, nil
}

func (s *handler) updatePosting(_ context.Context, input *struct {
	ID   string            `path:"id"`
	Body postingUpdateBody `json:"body"`
}) (*postingOutput, error) {
	stored, err := s.store.LoadModel()
	if err != nil {
		return nil, huma.Error500InternalServerError(err.Error())
	}
	var existing types.Posting
	found := false
	if stored != nil {
		for _, posting := range stored.Postings {
			if posting.ID == input.ID {
				existing, found = posting, true
				break
			}
		}
	}
	if !found {
		return nil, huma.Error404NotFound("posting " + input.ID + " does not exist")
	}
	posting, err := input.Body.apply(existing)
	if err != nil {
		return nil, huma.Error422UnprocessableEntity(err.Error())
	}
	row, issues, persisted, revision, err := runFinanceRowWrite(s, func(model *types.FinancialModel) {
		model.Postings = replaceByID(model.Postings, posting.ID, postingID, posting)
	}, func() (types.Posting, error) {
		return s.store.UpdatePosting(posting)
	})
	if err != nil {
		return nil, err
	}
	if persisted {
		row.Source = store.SourceUser
	}
	return &postingOutput{Body: rowResultBody[types.Posting]{Row: row, Issues: issues, Persisted: persisted, Revision: revision}}, nil
}

func (s *handler) deletePosting(_ context.Context, input *struct {
	ID string `path:"id"`
}) (*modelstate.ReorderOutput, error) {
	id := input.ID
	_, _, _, revision, err := runFinanceRowWrite(s, func(model *types.FinancialModel) {
		model.Postings = removeByID(model.Postings, id, postingID)
	}, func() (struct{}, error) {
		return struct{}{}, s.store.DeletePosting(id)
	})
	if err != nil {
		return nil, err
	}
	return &modelstate.ReorderOutput{Body: struct {
		Revision string `json:"revision"`
	}{Revision: revision}}, nil
}

func (s *handler) movePosting(_ context.Context, input *reorderInput) (*modelstate.ReorderOutput, error) {
	id, beforeID := input.Body.ID, input.Body.BeforeID
	_, _, _, revision, err := runFinanceRowWrite(s, func(model *types.FinancialModel) {
		model.Postings = moveBeforeID(model.Postings, id, beforeID, postingID)
	}, func() (struct{}, error) {
		return struct{}{}, s.store.MovePosting(id, beforeID)
	})
	if err != nil {
		return nil, err
	}
	return &modelstate.ReorderOutput{Body: struct {
		Revision string `json:"revision"`
	}{Revision: revision}}, nil
}
