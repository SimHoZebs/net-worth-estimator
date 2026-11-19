package model

import (
	"context"

	"github.com/danielgtaylor/huma/v2"
	"github.com/google/uuid"
	"github.com/simhozebs/net-worth-estimator/backend/internal/api/internal/modelstate"
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
	// DisplayBasis chooses the owner-facing current balance: available
	// (the default) or posted. It never changes the modeled balance.
	DisplayBasis types.DisplayBasis `json:"displayBasis,omitempty"`
	// StatementClosingDay is this card's authoritative closing day, 1..31.
	// Omitted means the default 19.
	StatementClosingDay *int `json:"statementClosingDay,omitempty" minimum:"1" maximum:"31"`
	// Balance with ObservedAt records the opening (create) or moved (update)
	// balance observation atomically with the account write, so callers
	// never sequence a second checkpoint request. Omitted balance leaves
	// balance history untouched.
	Balance *float64 `json:"balance,omitempty"`
	// ObservedAt is the required exact Unix instant of Balance. Required
	// with Balance; there is no date fallback.
	ObservedAt *int64 `json:"observedAt,omitempty"`
	// Source is accepted and ignored: accounts carry no authorship flag.
	// Record authorship lives in checkpoints/transactions ("user" | "banksync")
	// plus account_links, mirroring the retired whole-model PUT contract.
	Source *string `json:"source,omitempty"`
}

// defaultStatementClosingDay is the closing day when a caller omits it.
const defaultStatementClosingDay = 19

func (b accountBody) toAccount(id string) types.Account {
	closingDay := defaultStatementClosingDay
	if b.StatementClosingDay != nil {
		closingDay = *b.StatementClosingDay
	}
	out := types.Account{
		Name: b.Name, Kind: b.Kind,
		MinBalance: b.MinBalance, MaxBalance: b.MaxBalance,
		Color: b.Color, Enabled: b.Enabled,
		DisplayBasis:        b.DisplayBasis,
		StatementClosingDay: closingDay,
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
	Body writeResult[types.Account] `json:"body"`
}

func accountID(account types.Account) string { return account.ID }

// findModelAccount returns the stored account with id, or nil when absent.
func findModelAccount(model *types.FinancialModel, id string) *types.Account {
	if model == nil {
		return nil
	}
	for i := range model.Accounts {
		if model.Accounts[i].ID == id {
			return &model.Accounts[i]
		}
	}
	return nil
}

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
	if input.Body.Kind == types.AccountKindDebt {
		return nil, huma.Error422UnprocessableEntity("Create debt through the debt form backed by POST /v1/loans so principal, interest, and rules stay consistent.")
	}
	account := input.Body.toAccount("")
	if account.ID == "" {
		id, err := uuid.NewV7()
		if err != nil {
			return nil, huma.Error500InternalServerError(err.Error())
		}
		account.ID = id.String()
	}
	// A created account without a basis shows available. Default empty
	// only; unknown values stay raw so validation rejects them like PATCH.
	if account.DisplayBasis == "" {
		account.DisplayBasis = types.DisplayBasisAvailable
	}
	if account.DisplayBasis != "" && !account.DisplayBasis.Valid() {
		return nil, huma.Error422UnprocessableEntity("displayBasis must be available or posted")
	}
	balance, observedAt, err := accountObservation(input.Body)
	if err != nil {
		return nil, err
	}
	account.Display = types.PassthroughDisplay(account.ID, account.Name)
	row, issues, saved, revision, err := runFinanceRowWrite(s, func(model *types.FinancialModel) {
		model.Accounts = replaceByID(model.Accounts, account.ID, accountID, account)
		if balance != nil {
			pending := types.Checkpoint{AccountID: account.ID, Balance: *balance, Source: store.SourceUser, ObservedAt: observedAt}
			model.Checkpoints = replaceByID(model.Checkpoints, checkpointKey(pending), checkpointKey, pending)
		}
	}, func() (types.Account, error) {
		return s.store.CreateAccountWithBalance(account, balance, observedAt)
	})
	if err != nil {
		return nil, err
	}
	return &accountOutput{Body: writeResult[types.Account]{Result: row, Issues: issues, Saved: saved, Revision: revision}}, nil
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
	guard := func(model *types.FinancialModel) error {
		if requireOrdinaryAccount(model, input.ID) == nil {
			if account.Kind != types.AccountKindDebt {
				return nil
			}
			for _, existing := range model.Accounts {
				if existing.ID != input.ID {
					continue
				}
				if existing.Kind == types.AccountKindDebt {
					return nil
				}
				return huma.Error422UnprocessableEntity("Convert an existing account to debt through PUT /v1/loans/{id} so principal, interest, and rules stay consistent.")
			}
			return nil
		}
		// A grouped visible account accepts display-basis-only updates:
		// the visible row owns the choice, and nothing else on a loan
		// may change outside its loan form.
		existing := findModelAccount(model, input.ID)
		if existing == nil || existing.Display == nil || types.IsPassthroughDisplay(existing.Display, existing.ID) {
			return requireOrdinaryAccount(model, input.ID)
		}
		basis := input.Body.DisplayBasis
		body := input.Body
		nameOK := body.Name == existing.Name ||
			(existing.Display != nil && body.Name == existing.Display.Name)
		closingChanged := body.StatementClosingDay != nil &&
			*body.StatementClosingDay != existing.StatementClosingDay
		if body.Balance != nil || body.MinBalance != nil || body.MaxBalance != nil || body.Color != nil ||
			!nameOK || body.Kind != existing.Kind || body.Enabled != existing.Enabled || closingChanged {
			return huma.Error409Conflict("Edit this account through its loan form so principal, interest, and rules stay consistent.")
		}
		if basis == "" || !basis.Valid() {
			return huma.Error422UnprocessableEntity("displayBasis must be available or posted")
		}
		return nil
	}
	row, issues, saved, revision, err := runFinanceRowWriteGuarded(s, guard, func(model *types.FinancialModel) {
		if existing := findModelAccount(model, input.ID); existing != nil && existing.Display != nil && !types.IsPassthroughDisplay(existing.Display, existing.ID) {
			// Basis-only: persist stored scalars and the grouped display
			// verbatim so the loan linkage survives. The persist closure
			// below writes this same account.
			account = *existing
			account.DisplayBasis = input.Body.DisplayBasis
			model.Accounts = replaceByID(model.Accounts, account.ID, accountID, account)
		} else {
			account.Display = types.PassthroughDisplay(account.ID, account.Name)
			if stored := findModelAccount(model, account.ID); stored != nil {
				if account.DisplayBasis == "" {
					account.DisplayBasis = stored.DisplayBasis
				}
				// An omitted closing day keeps the stored one, so unrelated
				// account edits never reset a card's authoritative value.
				if input.Body.StatementClosingDay == nil {
					account.StatementClosingDay = stored.StatementClosingDay
				}
			} else if account.DisplayBasis == "" {
				account.DisplayBasis = types.DisplayBasisAvailable
			}
			model.Accounts = replaceByID(model.Accounts, account.ID, accountID, account)
		}
		if balance != nil {
			pending := types.Checkpoint{AccountID: account.ID, Balance: *balance, Source: store.SourceUser, ObservedAt: observedAt}
			model.Checkpoints = replaceByID(model.Checkpoints, checkpointKey(pending), checkpointKey, pending)
		}
	}, func() (types.Account, error) {
		return s.store.UpdateAccountWithBalance(account, balance, observedAt)
	})
	if err != nil {
		return nil, err
	}
	return &accountOutput{Body: writeResult[types.Account]{Result: row, Issues: issues, Saved: saved, Revision: revision}}, nil
}

func (s *handler) deleteAccount(_ context.Context, input *struct {
	ID string `path:"id"`
}) (*struct {
	Body struct {
		DeletedID string                       `json:"deletedId"`
		Issues    []types.ModelValidationIssue `json:"issues"`
		Saved     bool                         `json:"saved"`
		Revision  string                       `json:"revision"`
	} `json:"body"`
}, error) {
	id := input.ID
	_, issues, saved, revision, err := runFinanceRowWriteGuarded(s, func(model *types.FinancialModel) error { return requireOrdinaryAccount(model, id) }, func(model *types.FinancialModel) {
		model.Accounts = removeByID(model.Accounts, id, accountID)
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
			Saved     bool                         `json:"saved"`
			Revision  string                       `json:"revision"`
		} `json:"body"`
	}{}
	output.Body.DeletedID = id
	output.Body.Issues = issues
	output.Body.Saved = saved
	output.Body.Revision = revision
	return output, nil
}

func (s *handler) moveAccount(_ context.Context, input *reorderInput) (*modelstate.ReorderOutput, error) {
	id, beforeID := input.Body.ID, input.Body.BeforeID
	_, _, _, revision, err := runFinanceRowWrite(s, func(model *types.FinancialModel) {
		model.Accounts = moveBeforeID(model.Accounts, id, beforeID, accountID)
	}, func() (struct{}, error) {
		return struct{}{}, s.store.MoveAccount(id, beforeID)
	})
	if err != nil {
		return nil, err
	}
	return &modelstate.ReorderOutput{Body: struct {
		Revision string `json:"revision"`
	}{Revision: revision}}, nil
}
