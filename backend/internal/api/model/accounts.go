package model

import (
	"context"

	"github.com/danielgtaylor/huma/v2"
	"github.com/google/uuid"
	"github.com/simhozebs/net-worth-estimator/backend/internal/store"
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
	// Balance with ObservedAt records the opening (create) or moved (update)
	// balance observation atomically with the account write, so callers
	// never sequence a second checkpoint request. Omitted balance leaves
	// balance history untouched.
	Balance *float64 `json:"balance,omitempty"`
	// ObservedAt is the required exact Unix instant of Balance. Required
	// with Balance; there is no date fallback.
	ObservedAt *int64 `json:"observedAt,omitempty"`
	// Source is accepted and ignored: accounts carry no authorship flag.
	// Row authorship lives in checkpoints/postings ("user" | "simplefin")
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

func accountObservation(body accountBody) (*float64, int64, error) {
	if body.Balance == nil && body.ObservedAt == nil {
		return nil, 0, nil
	}
	if body.Balance == nil || body.ObservedAt == nil || *body.ObservedAt <= 0 {
		return nil, 0, huma.Error422UnprocessableEntity("balance and observedAt must be sent together; observedAt must carry the exact observation time as Unix seconds")
	}
	return body.Balance, *body.ObservedAt, nil
}

func (s *handler) createAccount(_ context.Context, input *accountInput) (*accountOutput, error) {
	account := input.Body.toAccount("")
	if account.ID == "" {
		id, err := uuid.NewV7()
		if err != nil {
			return nil, huma.Error500InternalServerError(err.Error())
		}
		account.ID = id.String()
	}
	balance, observedAt, err := accountObservation(input.Body)
	if err != nil {
		return nil, err
	}
	row, issues, persisted, revision, err := runRowWrite(s, func(document *types.FinancialModelDocument) {
		document.Accounts = replaceByID(document.Accounts, account.ID, accountID, account)
		if balance != nil {
			pending := types.Checkpoint{AccountID: account.ID, Balance: *balance, Source: store.SourceUser, ObservedAt: observedAt}
			document.Checkpoints = replaceByID(document.Checkpoints, checkpointKey(pending), checkpointKey, pending)
		}
	}, func() (types.Account, error) {
		return s.store.CreateAccountWithBalance(account, balance, observedAt)
	})
	if err != nil {
		return nil, err
	}
	return &accountOutput{Body: rowResultBody[types.Account]{Row: row, Issues: issues, Persisted: persisted, Revision: revision}}, nil
}

func (s *handler) updateAccount(_ context.Context, input *struct {
	ID   string      `path:"id"`
	Body accountBody `json:"body"`
}) (*accountOutput, error) {
	account := input.Body.toAccount(input.ID)
	balance, observedAt, err := accountObservation(input.Body)
	if err != nil {
		return nil, err
	}
	row, issues, persisted, revision, err := runRowWrite(s, func(document *types.FinancialModelDocument) {
		document.Accounts = replaceByID(document.Accounts, account.ID, accountID, account)
		if balance != nil {
			pending := types.Checkpoint{AccountID: account.ID, Balance: *balance, Source: store.SourceUser, ObservedAt: observedAt}
			document.Checkpoints = replaceByID(document.Checkpoints, checkpointKey(pending), checkpointKey, pending)
		}
	}, func() (types.Account, error) {
		return s.store.UpdateAccountWithBalance(account, balance, observedAt)
	})
	if err != nil {
		return nil, err
	}
	return &accountOutput{Body: rowResultBody[types.Account]{Row: row, Issues: issues, Persisted: persisted, Revision: revision}}, nil
}

func (s *handler) deleteAccount(_ context.Context, input *struct {
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

func (s *handler) moveAccount(_ context.Context, input *reorderInput) (*reorderOutput, error) {
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
