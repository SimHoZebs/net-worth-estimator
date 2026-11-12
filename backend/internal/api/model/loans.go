package model

import (
	"context"

	"github.com/danielgtaylor/huma/v2"
	"github.com/google/uuid"
	"github.com/simhozebs/net-worth-estimator/backend/internal/domain"
	"github.com/simhozebs/net-worth-estimator/backend/internal/types"
)

func (s *handler) createLoan(_ context.Context, input *struct{ Body types.LoanTerms }) (*accountOutput, error) {
	ids := make([]string, 4)
	for i := range ids {
		id, err := uuid.NewV7()
		if err != nil {
			return nil, huma.Error500InternalServerError(err.Error())
		}
		ids[i] = id.String()
	}
	bundle, err := domain.BuildLoan(ids[0], ids[1], ids[2], ids[3], input.Body)
	if err != nil {
		return nil, huma.Error422UnprocessableEntity(err.Error())
	}
	return s.saveLoan(bundle, true)
}

func (s *handler) updateLoan(_ context.Context, input *struct {
	ID   string `path:"id"`
	Body types.LoanTerms
}) (*accountOutput, error) {
	model, err := s.store.LoadModel()
	if err != nil {
		return nil, huma.Error500InternalServerError(err.Error())
	}
	if model == nil {
		return nil, huma.Error404NotFound("Loan not found")
	}
	for _, account := range model.Accounts {
		if account.ID != input.ID || account.Display == nil || types.IsPassthroughDisplay(account.Display, account.ID) {
			continue
		}
		d := account.Display
		interestID := ""
		for _, c := range d.Components {
			if c.Role == "interest" {
				interestID = c.AccountID
			}
		}
		bundle, err := domain.BuildLoan(account.ID, interestID, d.InterestScheduleID, d.PaymentScheduleID, input.Body)
		if err != nil {
			return nil, huma.Error422UnprocessableEntity(err.Error())
		}
		for i := range bundle.Accounts {
			for _, existing := range model.Accounts {
				if existing.ID == bundle.Accounts[i].ID {
					bundle.Accounts[i].MinBalance = existing.MinBalance
					bundle.Accounts[i].Color = existing.Color
				}
			}
		}
		var charge, payment types.Schedule
		for _, r := range model.Schedules {
			if r.ID == d.InterestScheduleID {
				charge = r
			}
			if r.ID == d.PaymentScheduleID {
				payment = r
			}
		}
		rate, amount, rateInput, err := domain.LoanRuleTerms(account.ID, charge, payment)
		if err != nil {
			return nil, huma.Error409Conflict(err.Error())
		}
		// Preserve exact descriptors and input aliases when their terms did
		// not change. Name-only edits cannot rewrite financial behavior.
		if input.Body.AnnualRate == rate {
			bundle.Schedules[0].Amount = charge.Amount
		} else {
			binding := charge.Amount.Inputs[rateInput]
			binding.Arguments["annualRate"] = input.Body.AnnualRate
			charge.Amount.Inputs[rateInput] = binding
			bundle.Schedules[0].Amount = charge.Amount
		}
		if input.Body.Payment == amount {
			bundle.Schedules[1].Amount = payment.Amount
		}
		if !input.Body.RecordBalances {
			bundle.Checkpoints = nil
		}
		return s.saveLoan(bundle, false)
	}
	// Adopt a plain existing account as principal when it carries a
	// passthrough display and is not already a loan component. The existing
	// account ID stays the principal/visible ID; fresh UUIDs back the
	// interest account and the two rules. Existing checkpoints and history
	// survive via upsert; the display linkage and names follow BuildLoan
	// conventions.
	for _, existing := range model.Accounts {
		if existing.ID != input.ID {
			continue
		}
		if existing.Display != nil && !types.IsPassthroughDisplay(existing.Display, existing.ID) {
			break
		}
		if err := requireOrdinaryAccount(model, input.ID); err != nil {
			return nil, err
		}
		ids := make([]string, 3)
		for i := range ids {
			id, err := uuid.NewV7()
			if err != nil {
				return nil, huma.Error500InternalServerError(err.Error())
			}
			ids[i] = id.String()
		}
		bundle, err := domain.BuildLoan(existing.ID, ids[0], ids[1], ids[2], input.Body)
		if err != nil {
			return nil, huma.Error422UnprocessableEntity(err.Error())
		}
		for _, prior := range model.Accounts {
			if prior.ID == bundle.Accounts[0].ID {
				bundle.Accounts[0].MinBalance = prior.MinBalance
				bundle.Accounts[0].Color = prior.Color
			}
		}
		// Adoption always records the principal and interest pair at
		// observedAt: a converted cash account may carry a positive
		// checkpoint, and the debt principal needs its negative
		// observation even when the magnitude is unchanged.
		return s.saveLoan(bundle, false)
	}
	return nil, huma.Error404NotFound("Loan not found")
}

func (s *handler) saveLoan(bundle types.LoanBundle, create bool) (*accountOutput, error) {
	row, issues, saved, revision, err := runFinanceRowWrite(s, func(model *types.FinancialModel) {
		maximum := -1
		for _, existing := range model.Schedules {
			if existing.Priority > maximum {
				maximum = existing.Priority
			}
		}
		for i := range bundle.Schedules {
			if create {
				bundle.Schedules[i].Priority = maximum + i + 1
			} else {
				matched := false
				for _, existing := range model.Schedules {
					if existing.ID == bundle.Schedules[i].ID {
						bundle.Schedules[i].Priority = existing.Priority
						matched = true
						break
					}
				}
				if !matched {
					maximum++
					bundle.Schedules[i].Priority = maximum
				}
			}
		}
		for _, a := range bundle.Accounts {
			model.Accounts = replaceByID(model.Accounts, a.ID, accountID, a)
		}
		for _, r := range bundle.Schedules {
			model.Schedules = replaceByID(model.Schedules, r.ID, scheduleID, r)
		}
		for _, c := range bundle.Checkpoints {
			model.Checkpoints = replaceByID(model.Checkpoints, checkpointKey(c), checkpointKey, c)
		}
	}, func() (types.Account, error) { return s.store.SaveLoan(bundle, create) })
	if err != nil {
		return nil, err
	}
	return &accountOutput{Body: writeResult[types.Account]{Result: row, Issues: issues, Saved: saved, Revision: revision}}, nil
}

func requireOrdinaryAccount(model *types.FinancialModel, id string) error {
	if model == nil {
		return nil
	}
	for _, a := range model.Accounts {
		if a.Display == nil || types.IsPassthroughDisplay(a.Display, a.ID) {
			continue
		}
		for _, c := range a.Display.Components {
			if c.AccountID == id {
				return huma.Error409Conflict("Edit this account through its loan form so principal, interest, and rules stay consistent.")
			}
		}
	}
	return nil
}
