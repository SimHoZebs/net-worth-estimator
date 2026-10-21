package api

import (
	"context"

	"github.com/simhozebs/net-worth-estimator/backend/internal/store"
	"github.com/simhozebs/net-worth-estimator/backend/internal/types"
)

type postingBody struct {
	ID              *string                       `json:"id,omitempty"`
	Name            string                        `json:"name"`
	SourceAccountID *string                       `json:"sourceAccountId,omitempty"`
	Destinations    []string                      `json:"destinations,omitempty"`
	Amount          types.PostingAmountResolution `json:"amount"`
	PostedTime      int64                         `json:"postedTime"`
	TransactionTime int64                         `json:"transactionTime"`
	Claim           *types.PostingClaim           `json:"claim,omitempty"`
	Purchase        *types.PurchasePolicy         `json:"purchase,omitempty"`
	Enabled         bool                          `json:"enabled"`
	// Source is accepted and ignored: ownership is server-computed,
	// mirroring the retired whole-document PUT contract.
	Source *string `json:"source,omitempty"`
}

func (b postingBody) toPosting(id string) types.Posting {
	out := types.Posting{
		Name: b.Name, SourceAccountID: b.SourceAccountID,
		Destinations: b.Destinations, Amount: b.Amount,
		PostedTime: b.PostedTime, TransactionTime: b.TransactionTime,
		Claim: b.Claim, Purchase: b.Purchase, Enabled: b.Enabled,
	}
	if b.ID != nil {
		out.ID = *b.ID
	}
	if id != "" {
		out.ID = id
	}
	return out
}

type postingInput struct {
	Body postingBody `json:"body"`
}

type postingOutput struct {
	Body rowResultBody[types.Posting] `json:"body"`
}

func postingID(posting types.Posting) string { return posting.ID }

func (s *Server) createPosting(_ context.Context, input *postingInput) (*postingOutput, error) {
	posting := input.Body.toPosting("")
	row, issues, persisted, revision, err := runRowWrite(s, func(document *types.FinancialModelDocument) {
		document.Postings = replaceByID(document.Postings, posting.ID, postingID, posting)
	}, func() (types.Posting, error) {
		return s.store.CreatePosting(posting)
	})
	if err != nil {
		return nil, err
	}
	if persisted {
		row.Source = store.SourceModel
	}
	return &postingOutput{Body: rowResultBody[types.Posting]{Row: row, Issues: issues, Persisted: persisted, Revision: revision}}, nil
}

func (s *Server) updatePosting(_ context.Context, input *struct {
	ID   string      `path:"id"`
	Body postingBody `json:"body"`
}) (*postingOutput, error) {
	posting := input.Body.toPosting(input.ID)
	row, issues, persisted, revision, err := runRowWrite(s, func(document *types.FinancialModelDocument) {
		document.Postings = replaceByID(document.Postings, posting.ID, postingID, posting)
	}, func() (types.Posting, error) {
		return s.store.UpdatePosting(posting)
	})
	if err != nil {
		return nil, err
	}
	if persisted {
		row.Source = store.SourceModel
	}
	return &postingOutput{Body: rowResultBody[types.Posting]{Row: row, Issues: issues, Persisted: persisted, Revision: revision}}, nil
}

func (s *Server) deletePosting(_ context.Context, input *struct {
	ID string `path:"id"`
}) (*reorderOutput, error) {
	id := input.ID
	_, _, _, revision, err := runRowWrite(s, func(document *types.FinancialModelDocument) {
		document.Postings = removeByID(document.Postings, id, postingID)
	}, func() (struct{}, error) {
		return struct{}{}, s.store.DeletePosting(id)
	})
	if err != nil {
		return nil, err
	}
	return &reorderOutput{Body: struct {
		Revision string `json:"revision"`
	}{Revision: revision}}, nil
}

func (s *Server) movePosting(_ context.Context, input *reorderInput) (*reorderOutput, error) {
	id, beforeID := input.Body.ID, input.Body.BeforeID
	_, _, _, revision, err := runRowWrite(s, func(document *types.FinancialModelDocument) {
		document.Postings = moveBeforeID(document.Postings, id, beforeID, postingID)
	}, func() (struct{}, error) {
		return struct{}{}, s.store.MovePosting(id, beforeID)
	})
	if err != nil {
		return nil, err
	}
	return &reorderOutput{Body: struct {
		Revision string `json:"revision"`
	}{Revision: revision}}, nil
}
