package api

import (
	"context"

	"github.com/simhozebs/net-worth-estimator/backend/internal/types"
)

type accountBody struct {
	ID         *string           `json:"id,omitempty"`
	Name       string            `json:"name"`
	Kind       types.AccountKind `json:"kind"`
	MinBalance *float64          `json:"minBalance,omitempty"`
	MaxBalance *float64          `json:"maxBalance,omitempty"`
	Color      *string           `json:"color,omitempty"`
	Enabled    bool              `json:"enabled"`
	// Source is accepted and ignored: accounts carry no ownership flag.
	// Row ownership lives in checkpoints/postings ("model" | "simplefin")
	// plus account_links, mirroring the retired whole-document PUT contract.
	Source *string `json:"source,omitempty"`
}

func (b accountBody) toAccount(id string) types.Account {
	out := types.Account{
		Name: b.Name, Kind: b.Kind,
		MinBalance: b.MinBalance, MaxBalance: b.MaxBalance,
		Color: b.Color, Enabled: b.Enabled,
	}
	if b.ID != nil {
		out.ID = *b.ID
	}
	if id != "" {
		out.ID = id
	}
	return out
}

type accountInput struct {
	Body accountBody `json:"body"`
}

type accountOutput struct {
	Body rowResultBody[types.Account] `json:"body"`
}

func accountID(account types.Account) string { return account.ID }

func (s *Server) createAccount(_ context.Context, input *accountInput) (*accountOutput, error) {
	account := input.Body.toAccount("")
	row, issues, persisted, revision, err := runRowWrite(s, func(document *types.FinancialModelDocument) {
		document.Accounts = replaceByID(document.Accounts, account.ID, accountID, account)
	}, func() (types.Account, error) {
		return s.store.CreateAccount(account)
	})
	if err != nil {
		return nil, err
	}
	return &accountOutput{Body: rowResultBody[types.Account]{Row: row, Issues: issues, Persisted: persisted, Revision: revision}}, nil
}

func (s *Server) updateAccount(_ context.Context, input *struct {
	ID   string      `path:"id"`
	Body accountBody `json:"body"`
}) (*accountOutput, error) {
	account := input.Body.toAccount(input.ID)
	row, issues, persisted, revision, err := runRowWrite(s, func(document *types.FinancialModelDocument) {
		document.Accounts = replaceByID(document.Accounts, account.ID, accountID, account)
	}, func() (types.Account, error) {
		return s.store.UpdateAccount(account)
	})
	if err != nil {
		return nil, err
	}
	return &accountOutput{Body: rowResultBody[types.Account]{Row: row, Issues: issues, Persisted: persisted, Revision: revision}}, nil
}

func (s *Server) deleteAccount(_ context.Context, input *struct {
	ID string `path:"id"`
}) (*struct {
	Body struct {
		DeletedID string                       `json:"deletedId"`
		Issues    []types.ModelValidationIssue `json:"issues"`
		Persisted bool                         `json:"persisted"`
		Revision  string                       `json:"revision"`
	} `json:"body"`
}, error) {
	id := input.ID
	_, issues, persisted, revision, err := runRowWrite(s, func(document *types.FinancialModelDocument) {
		document.Accounts = removeByID(document.Accounts, id, accountID)
	}, func() (struct{}, error) {
		return struct{}{}, s.store.DeleteAccount(id)
	})
	if err != nil {
		return nil, err
	}
	output := &struct {
		Body struct {
			DeletedID string                       `json:"deletedId"`
			Issues    []types.ModelValidationIssue `json:"issues"`
			Persisted bool                         `json:"persisted"`
			Revision  string                       `json:"revision"`
		} `json:"body"`
	}{}
	output.Body.DeletedID = id
	output.Body.Issues = issues
	output.Body.Persisted = persisted
	output.Body.Revision = revision
	return output, nil
}

func (s *Server) moveAccount(_ context.Context, input *reorderInput) (*reorderOutput, error) {
	id, beforeID := input.Body.ID, input.Body.BeforeID
	_, _, _, revision, err := runRowWrite(s, func(document *types.FinancialModelDocument) {
		document.Accounts = moveBeforeID(document.Accounts, id, beforeID, accountID)
	}, func() (struct{}, error) {
		return struct{}{}, s.store.MoveAccount(id, beforeID)
	})
	if err != nil {
		return nil, err
	}
	return &reorderOutput{Body: struct {
		Revision string `json:"revision"`
	}{Revision: revision}}, nil
}
