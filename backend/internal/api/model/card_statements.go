package model

import (
	"context"
	"time"

	"github.com/danielgtaylor/huma/v2"
	"github.com/simhozebs/net-worth-estimator/backend/internal/api/internal/modelstate"
	"github.com/simhozebs/net-worth-estimator/backend/internal/domain"
	"github.com/simhozebs/net-worth-estimator/backend/internal/safespending"
	"github.com/simhozebs/net-worth-estimator/backend/internal/types"
)

func (s *handler) actorFrom(ctx context.Context) string {
	if s.actor == nil {
		return ""
	}
	return s.actor(ctx)
}

// derivedStatements reconstructs the current statement history from the model
// and bank evidence. An empty accountID returns every card's statements.
func (s *handler) derivedStatements(accountID string) ([]types.DerivedStatement, error) {
	model, err := s.store.LoadModel()
	if err != nil {
		return nil, err
	}
	settings, err := s.store.GetSafeSpendingSettings()
	if err != nil {
		return nil, err
	}
	statements := safespending.DeriveStatements(model, settings, time.Now().Unix())
	if accountID == "" {
		return statements, nil
	}
	filtered := []types.DerivedStatement{}
	for _, statement := range statements {
		if statement.AccountID == accountID {
			filtered = append(filtered, statement)
		}
	}
	return filtered, nil
}

// statementContext resolves a derived statement ID into the model and the
// statement it names. A missing or stale ID is a 404: there is no longer a
// stored row to resurrect, the statement must exist in the current history.
func (s *handler) statementContext(id string) (*types.FinancialModel, types.DerivedStatement, error) {
	accountID, closingDate, ok := types.ParseDerivedStatementID(id)
	if !ok {
		return nil, types.DerivedStatement{}, huma.Error404NotFound("statement not found")
	}
	model, err := s.store.LoadModel()
	if err != nil {
		return nil, types.DerivedStatement{}, modelstate.WriteError(err)
	}
	settings, err := s.store.GetSafeSpendingSettings()
	if err != nil {
		return nil, types.DerivedStatement{}, modelstate.WriteError(err)
	}
	for _, statement := range safespending.DeriveStatements(model, settings, time.Now().Unix()) {
		if statement.AccountID == accountID && statement.ClosingDate == closingDate {
			return model, statement, nil
		}
	}
	return nil, types.DerivedStatement{}, huma.Error404NotFound("statement not found")
}

// cardHasLiveAllocations reports whether an account's derived statements are
// still backing confirmed allocations. Account edits or removals that would
// strand those allocations are rejected instead of silently invalidating them.
func (s *handler) cardHasLiveAllocations(accountID string) (bool, error) {
	statements, err := s.derivedStatements(accountID)
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

// Derived statements and their payment allocations are evidence. They never
// enter the financial model, never mark the projection dirty, and never turn a
// history-application estimate into a confirmed statement. The payment transactions stay
// cash transfers; an allocation only records which statement they settle.

type cardStatementsOutput struct {
	CacheControl string `header:"Cache-Control"`
	Body         struct {
		Statements []types.StatementAllocationRead `json:"statements"`
		Revision   string                          `json:"revision"`
	} `json:"body"`
}

// statementReads builds one view per derived statement and the payment-to-
// statement index used to reject a second allocation of the same payment.
func (s *handler) statementReads(accountID string) ([]types.StatementAllocationRead, map[string]string, error) {
	statements, err := s.derivedStatements(accountID)
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
		balanceCents := int64(0)
		if statement.Balance != nil {
			balanceCents = domain.MoneyCents(*statement.Balance)
		}
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
		TransactionID string                             `json:"transactionId"`
		Matches       []types.StatementPaymentSuggestion `json:"matches"`
		Current       *types.StatementAllocation         `json:"current,omitempty"`
		Revision      string                             `json:"revision"`
	} `json:"body"`
}

// listTransactionStatementPaymentSuggestions answers the Suggestions modal in
// one call. The input transaction may be the manual transfer into the card or
// one leg of a confirmed transfer link; the server resolves the card identity
// and ranks every derived statement against its remaining balance.
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
	all, err := s.store.ListStatementAllocations("")
	if err != nil {
		return nil, modelstate.WriteError(err)
	}
	for i := range all {
		if all[i].TransactionID == canonicalID {
			copy := all[i]
			current = &copy
			break
		}
	}
	revision, err := modelstate.CurrentRevision(s.store)
	if err != nil {
		return nil, modelstate.WriteError(err)
	}
	output := &statementPaymentSuggestionsOutput{CacheControl: "private, no-store"}
	output.Body.TransactionID, output.Body.Matches = input.ID, matches
	output.Body.Current, output.Body.Revision = current, revision
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
	model, statement, err := s.statementContext(input.ID)
	if err != nil {
		return nil, err
	}
	all, err := s.store.ListStatementAllocations("")
	if err != nil {
		return nil, modelstate.WriteError(err)
	}
	derived, err := s.derivedStatements("")
	if err != nil {
		return nil, modelstate.WriteError(err)
	}
	links, err := s.store.ListTransferLinks()
	if err != nil {
		return nil, modelstate.WriteError(err)
	}
	statementAccounts := make(map[string]bool, len(derived))
	for _, item := range derived {
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
	// payment to this statement's card. Amount similarity never creates or
	// proves a claim.
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
	remainingCents := int64(0)
	if statement.Balance != nil {
		remainingCents = domain.MoneyCents(*statement.Balance) - allocatedCents
	}
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
