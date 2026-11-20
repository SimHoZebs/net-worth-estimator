package model

import (
	"context"

	"github.com/danielgtaylor/huma/v2"
	"github.com/simhozebs/net-worth-estimator/backend/internal/api/internal/modelstate"
	"github.com/simhozebs/net-worth-estimator/backend/internal/domain"
	"github.com/simhozebs/net-worth-estimator/backend/internal/types"
)

func (s *handler) actorFrom(ctx context.Context) string {
	if s.actor == nil {
		return ""
	}
	return s.actor(ctx)
}

// cardHasLiveAllocations reports whether an account's recorded statements are
// still backing confirmed allocations. Account edits or removals that would
// strand those allocations are rejected instead of silently invalidating them.
func (s *handler) cardHasLiveAllocations(accountID string) (bool, error) {
	statements, err := s.store.ListCardStatements(accountID)
	if err != nil {
		return false, err
	}
	if len(statements) == 0 {
		return false, nil
	}
	ids := make(map[string]bool, len(statements))
	for _, statement := range statements {
		ids[statement.ID] = true
	}
	allocations, err := s.store.ListStatementAllocations("")
	if err != nil {
		return false, err
	}
	for _, allocation := range allocations {
		if ids[allocation.StatementID] && allocation.State == "confirmed" {
			return true, nil
		}
	}
	return false, nil
}

// Recorded statements and their payment allocations are evidence. They never
// enter the financial model, never mark the projection dirty, and never turn a
// replay estimate into a confirmed statement. The payment transactions stay
// cash transfers; an allocation only records which statement they settle.

// cardStatementBody is the write shape: identity and creation time are owned
// by the server, so they are optional on input even though the stored record
// always carries them.
type cardStatementBody struct {
	ID          *string       `json:"id,omitempty" format:"uuid"`
	AccountID   string        `json:"accountId"`
	ClosingDate types.IsoDate `json:"closingDate"`
	DueDate     types.IsoDate `json:"dueDate"`
	Balance     float64       `json:"balance"`
	Currency    string        `json:"currency,omitempty" maxLength:"3"`
	Source      string        `json:"source,omitempty"`
	Note        string        `json:"note,omitempty" maxLength:"500"`
}

type cardStatementInput struct {
	Body cardStatementBody `json:"body"`
}

type cardStatementOutput struct {
	Body struct {
		Statement types.CardStatement `json:"statement"`
		Revision  string              `json:"revision"`
	} `json:"body"`
}

func (s *handler) saveCardStatement(ctx context.Context, input *cardStatementInput) (*cardStatementOutput, error) {
	statement := types.CardStatement{
		AccountID: input.Body.AccountID, ClosingDate: input.Body.ClosingDate,
		DueDate: input.Body.DueDate, Balance: input.Body.Balance,
		Currency: domain.NormalizeCardStatementCurrency(input.Body.Currency),
		Source:   input.Body.Source, Note: input.Body.Note,
	}
	if input.Body.ID != nil {
		statement.ID = *input.Body.ID
	}
	model, err := s.store.LoadModel()
	if err != nil {
		return nil, modelstate.WriteError(err)
	}
	if err := domain.ValidateCardStatement(statement, model.Accounts); err != nil {
		return nil, huma.Error422UnprocessableEntity(err.Error())
	}
	if statement.Source == "" {
		statement.Source = "user"
	}
	saved, err := s.store.SaveCardStatement(statement)
	if err != nil {
		return nil, modelstate.WriteError(err)
	}
	revision, err := modelstate.CurrentRevision(s.store)
	if err != nil {
		return nil, modelstate.WriteError(err)
	}
	output := &cardStatementOutput{}
	output.Body.Statement, output.Body.Revision = saved, revision
	return output, nil
}

type cardStatementsOutput struct {
	CacheControl string `header:"Cache-Control"`
	Body         struct {
		Statements []types.StatementAllocationRead `json:"statements"`
		Revision   string                          `json:"revision"`
	} `json:"body"`
}

// statementReads builds one view per recorded statement and the payment-to-
// statement index used to reject a second allocation of the same payment.
func (s *handler) statementReads(accountID string) ([]types.StatementAllocationRead, map[string]string, error) {
	statements, err := s.store.ListCardStatements(accountID)
	if err != nil {
		return nil, nil, err
	}
	all, err := s.store.ListStatementAllocations("")
	if err != nil {
		return nil, nil, err
	}
	byStatement := make(map[string][]types.StatementAllocation, len(statements))
	taken := make(map[string]string, len(all))
	for _, allocation := range all {
		byStatement[allocation.StatementID] = append(byStatement[allocation.StatementID], allocation)
		// A dismissed allocation no longer claims the payment: undo must let
		// the owner apply it again.
		if allocation.State == "confirmed" {
			taken[allocation.TransactionID] = allocation.StatementID
		}
	}
	reads := make([]types.StatementAllocationRead, 0, len(statements))
	for _, statement := range statements {
		allocations := byStatement[statement.ID]
		balanceCents := domain.MoneyCents(statement.Balance)
		allocatedCents := int64(0)
		for _, allocation := range allocations {
			if allocation.State == "confirmed" {
				allocatedCents += domain.MoneyCents(allocation.Amount)
			}
		}
		remainingCents := balanceCents - allocatedCents
		if remainingCents < 0 {
			remainingCents = 0
		}
		reads = append(reads, types.StatementAllocationRead{
			Statement: statement, Allocations: allocations,
			Allocated: domain.MoneyFromCents(allocatedCents),
			Remaining: domain.MoneyFromCents(remainingCents),
		})
	}
	return reads, taken, nil
}

func (s *handler) listCardStatements(_ context.Context, input *struct {
	AccountID string `query:"accountId"`
}) (*cardStatementsOutput, error) {
	reads, _, err := s.statementReads(input.AccountID)
	if err != nil {
		return nil, modelstate.WriteError(err)
	}
	revision, err := modelstate.CurrentRevision(s.store)
	if err != nil {
		return nil, modelstate.WriteError(err)
	}
	output := &cardStatementsOutput{CacheControl: "private, no-store"}
	output.Body.Statements, output.Body.Revision = reads, revision
	return output, nil
}

type statementPaymentSuggestionsOutput struct {
	CacheControl string `header:"Cache-Control"`
	Body         struct {
		TransactionID string                                 `json:"transactionId"`
		Matches       []types.StatementPaymentSuggestion     `json:"matches"`
		Current       *types.StatementAllocation             `json:"current,omitempty"`
		Result        types.StatementPaymentSuggestionResult `json:"result"`
		Revision      string                                 `json:"revision"`
	} `json:"body"`
}

// listTransactionStatementPaymentSuggestions answers the Suggestions modal in
// one call. The input transaction may be the manual transfer into the card or
// one leg of a confirmed transfer link; the server resolves the card identity
// and ranks every statement against its remaining balance.
func (s *handler) listTransactionStatementPaymentSuggestions(_ context.Context, input *struct {
	ID string `path:"id"`
}) (*statementPaymentSuggestionsOutput, error) {
	model, err := s.store.LoadModel()
	if err != nil {
		return nil, modelstate.WriteError(err)
	}
	reads, taken, err := s.statementReads("")
	if err != nil {
		return nil, modelstate.WriteError(err)
	}
	links, err := s.store.ListTransferLinks()
	if err != nil {
		return nil, modelstate.WriteError(err)
	}
	matches, canonicalID := domain.StatementPaymentSuggestions(model, links, input.ID, reads, taken)
	var current *types.StatementAllocation
	result := types.StatementPaymentSuggestionResult{Status: "unallocated"}
	all, err := s.store.ListStatementAllocations("")
	if err != nil {
		return nil, modelstate.WriteError(err)
	}
	for i := range all {
		if all[i].TransactionID == canonicalID {
			copy := all[i]
			current = &copy
			result.Status = "applied"
			result.StatementID = copy.StatementID
			result.Amount = copy.Amount
			if copy.State == "dismissed" {
				result.Status = "dismissed"
			}
			break
		}
	}
	revision, err := modelstate.CurrentRevision(s.store)
	if err != nil {
		return nil, modelstate.WriteError(err)
	}
	output := &statementPaymentSuggestionsOutput{CacheControl: "private, no-store"}
	output.Body.TransactionID, output.Body.Matches = input.ID, matches
	output.Body.Current, output.Body.Result, output.Body.Revision = current, result, revision
	return output, nil
}

func (s *handler) deleteCardStatement(_ context.Context, input *struct {
	ID string `path:"id"`
}) (*modelstate.ReorderOutput, error) {
	if err := s.store.DeleteCardStatement(input.ID); err != nil {
		return nil, modelstate.WriteError(err)
	}
	revision, err := modelstate.CurrentRevision(s.store)
	if err != nil {
		return nil, modelstate.WriteError(err)
	}
	return &modelstate.ReorderOutput{Body: struct {
		Revision string `json:"revision"`
	}{Revision: revision}}, nil
}

type paymentCandidatesOutput struct {
	CacheControl string `header:"Cache-Control"`
	Body         struct {
		StatementID string                   `json:"statementId"`
		Candidates  []types.PaymentCandidate `json:"candidates"`
		Revision    string                   `json:"revision"`
	} `json:"body"`
}

func (s *handler) listPaymentCandidates(_ context.Context, input *struct {
	ID string `path:"id"`
}) (*paymentCandidatesOutput, error) {
	statement, err := s.store.GetCardStatement(input.ID)
	if err != nil {
		return nil, modelstate.WriteError(err)
	}
	model, err := s.store.LoadModel()
	if err != nil {
		return nil, modelstate.WriteError(err)
	}
	all, err := s.store.ListStatementAllocations("")
	if err != nil {
		return nil, modelstate.WriteError(err)
	}
	taken := make(map[string]string, len(all))
	for _, allocation := range all {
		if allocation.State == "confirmed" {
			taken[allocation.TransactionID] = allocation.StatementID
		}
	}
	links, err := s.store.ListTransferLinks()
	if err != nil {
		return nil, modelstate.WriteError(err)
	}
	candidates := domain.StatementPaymentCandidates(model, links, statement, taken)
	revision, err := modelstate.CurrentRevision(s.store)
	if err != nil {
		return nil, modelstate.WriteError(err)
	}
	output := &paymentCandidatesOutput{CacheControl: "private, no-store"}
	output.Body.StatementID, output.Body.Candidates, output.Body.Revision = statement.ID, candidates, revision
	return output, nil
}

type statementAllocationInput struct {
	ID   string `path:"id"`
	Body struct {
		TransactionID string  `json:"transactionId" maxLength:"100"`
		Amount        float64 `json:"amount"`
		Evidence      string  `json:"evidence" maxLength:"500"`
	}
}

type statementAllocationOutput struct {
	Body struct {
		Allocation types.StatementAllocation `json:"allocation"`
		Revision   string                    `json:"revision"`
	} `json:"body"`
}

func (s *handler) saveStatementAllocation(ctx context.Context, input *statementAllocationInput) (*statementAllocationOutput, error) {
	statement, err := s.store.GetCardStatement(input.ID)
	if err != nil {
		return nil, modelstate.WriteError(err)
	}
	model, err := s.store.LoadModel()
	if err != nil {
		return nil, modelstate.WriteError(err)
	}
	all, err := s.store.ListStatementAllocations("")
	if err != nil {
		return nil, modelstate.WriteError(err)
	}
	statements, err := s.store.ListCardStatements("")
	if err != nil {
		return nil, modelstate.WriteError(err)
	}
	links, err := s.store.ListTransferLinks()
	if err != nil {
		return nil, modelstate.WriteError(err)
	}
	statementAccounts := make(map[string]bool, len(statements))
	for _, item := range statements {
		statementAccounts[item.AccountID] = true
	}
	// Both modal lookups and apply use one stable canonical leg ID, even when
	// the payment came from two confirmed transfer-link legs.
	canonicalID := domain.ResolveCanonicalPaymentID(model, links, input.Body.TransactionID, statementAccounts)
	taken := make(map[string]string, len(all))
	for _, allocation := range all {
		if allocation.State == "confirmed" {
			taken[allocation.TransactionID] = allocation.StatementID
		}
	}
	// The server-side matcher decides whether the named transaction is a posted
	// payment to this card. Amount similarity never creates or proves a claim.
	match := domain.StatementPaymentCandidate(model, links, statement, canonicalID, taken)
	if match == nil {
		return nil, huma.Error422UnprocessableEntity("transaction is not a posted payment to this statement's card")
	}
	var existing *types.StatementAllocation
	for i := range all {
		if all[i].TransactionID == canonicalID {
			copy := all[i]
			existing = &copy
			break
		}
	}
	if existing != nil && existing.State == "confirmed" {
		return nil, huma.Error409Conflict("this payment already backs a statement allocation")
	}
	allocatedCents := int64(0)
	for _, allocation := range all {
		if allocation.StatementID == statement.ID && allocation.State == "confirmed" {
			allocatedCents += domain.MoneyCents(allocation.Amount)
		}
	}
	remainingCents := domain.MoneyCents(statement.Balance) - allocatedCents
	if remainingCents < 0 {
		remainingCents = 0
	}
	remaining := domain.MoneyFromCents(remainingCents)
	if err := domain.ValidateStatementAllocation(statement, match.PostedDate, match.Currency, match.Amount, input.Body.Amount, remaining); err != nil {
		return nil, huma.Error422UnprocessableEntity(err.Error())
	}
	actor := s.actorFrom(ctx)
	var allocation types.StatementAllocation
	if existing != nil {
		// Undo dismisses but keeps the row and its audit trail, so applying
		// the payment again restores it instead of colliding with itself.
		allocation, err = s.store.ReactivateStatementAllocation(existing.ID, statement.ID, input.Body.Amount, input.Body.Evidence, actor)
	} else {
		allocation, err = s.store.SaveStatementAllocation(types.StatementAllocation{
			StatementID:   statement.ID,
			TransactionID: canonicalID,
			Amount:        input.Body.Amount,
			State:         "confirmed",
			Evidence:      input.Body.Evidence,
			Actor:         actor,
		})
	}
	if err != nil {
		return nil, modelstate.WriteError(err)
	}
	revision, err := modelstate.CurrentRevision(s.store)
	if err != nil {
		return nil, modelstate.WriteError(err)
	}
	output := &statementAllocationOutput{}
	output.Body.Allocation, output.Body.Revision = allocation, revision
	return output, nil
}

func (s *handler) setStatementAllocationState(ctx context.Context, input *struct {
	ID   string `path:"id"`
	Body struct {
		State string `json:"state" enum:"dismissed,confirmed"`
	}
}) (*statementAllocationOutput, error) {
	state := input.Body.State
	if state != "dismissed" && state != "confirmed" {
		return nil, huma.Error422UnprocessableEntity("state must be dismissed or confirmed")
	}
	allocation, err := s.store.SetStatementAllocationState(input.ID, state, s.actorFrom(ctx))
	if err != nil {
		return nil, modelstate.WriteError(err)
	}
	revision, err := modelstate.CurrentRevision(s.store)
	if err != nil {
		return nil, modelstate.WriteError(err)
	}
	output := &statementAllocationOutput{}
	output.Body.Allocation, output.Body.Revision = allocation, revision
	return output, nil
}

type statementAllocationEventsOutput struct {
	CacheControl string `header:"Cache-Control"`
	Body         struct {
		Events []types.StatementAllocationEvent `json:"events"`
	} `json:"body"`
}

func (s *handler) listStatementAllocationEvents(_ context.Context, input *struct {
	ID string `path:"id"`
}) (*statementAllocationEventsOutput, error) {
	events, err := s.store.ListStatementAllocationEvents(input.ID)
	if err != nil {
		return nil, modelstate.WriteError(err)
	}
	output := &statementAllocationEventsOutput{CacheControl: "private, no-store"}
	output.Body.Events = events
	return output, nil
}
