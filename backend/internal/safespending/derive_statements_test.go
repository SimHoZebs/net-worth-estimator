package safespending

import (
	"testing"

	"github.com/simhozebs/net-worth-estimator/backend/internal/domain"
	"github.com/simhozebs/net-worth-estimator/backend/internal/types"
)

func TestDeriveStatementsFromCheckpointsAndTerms(t *testing.T) {
	card := types.Account{ID: "card", Name: "Card", Kind: types.AccountKindCreditCard, Enabled: true, StatementClosingDay: 31}
	model := &types.FinancialModel{
		Accounts: []types.Account{card},
		Checkpoints: []types.Checkpoint{
			{AccountID: card.ID, Balance: -100.30, ObservedAt: domain.DayCloseUnix("2026-09-30")},
			{AccountID: card.ID, Balance: -250, ObservedAt: domain.DayCloseUnix("2026-10-31")},
		},
		PaymentTerms: []types.PaymentTerms{{AccountID: card.ID, MinimumFixed: 25, DueDay: 20}},
	}
	cut := domain.DayCloseUnix("2026-11-20")
	statements := DeriveStatements(model, nil, cut)

	byClose := map[string]types.DerivedStatement{}
	for _, statement := range statements {
		byClose[statement.ClosingDate] = statement
		if statement.ID != types.DerivedStatementID(card.ID, statement.ClosingDate) {
			t.Fatalf("id = %q, want derived identity", statement.ID)
		}
		if statement.Currency != "USD" {
			t.Fatalf("currency = %q, want USD", statement.Currency)
		}
	}

	sep := byClose["2026-09-30"]
	if sep.Balance == nil || *sep.Balance != 100.30 || sep.Kind != "closed" {
		t.Fatalf("september statement = %+v, want 100.30 closed", sep)
	}
	if sep.DueDate == nil || *sep.DueDate != "2026-10-20" {
		t.Fatalf("september due date = %v, want 2026-10-20", sep.DueDate)
	}

	oct := byClose["2026-10-31"]
	if oct.Balance == nil || *oct.Balance != 250 || oct.Kind != "closed" {
		t.Fatalf("october statement = %+v, want 250 closed", oct)
	}
	if oct.DueDate == nil || *oct.DueDate != "2026-11-20" {
		t.Fatalf("october due date = %v, want 2026-11-20", oct.DueDate)
	}

	open := byClose["2026-11-30"]
	if open.Kind != "estimated" || open.Balance == nil {
		t.Fatalf("open statement = %+v, want estimated with an amount", open)
	}

	// A payment posting after the September close must not reduce the billed
	// amount recorded at that close: the observation is authoritative.
	payment := types.Transaction{
		ID: "pay", SourceAccountID: stringPtr("checking"), Destinations: []string{card.ID},
		Amount: amount("60.20"), PostedTime: domain.DayCloseUnix("2026-10-05"),
		TransactionTime: domain.DayCloseUnix("2026-10-05"), Enabled: true,
	}
	model.Accounts = append(model.Accounts, types.Account{ID: "checking", Kind: types.AccountKindCash, Enabled: true})
	model.Transactions = []types.Transaction{payment}
	again := DeriveStatements(model, nil, cut)
	for _, statement := range again {
		if statement.ClosingDate == "2026-09-30" && (statement.Balance == nil || *statement.Balance != 100.30) {
			t.Fatalf("billed amount changed after a later payment: %+v", statement)
		}
	}
}

func TestDeriveStatementsMarksUnknownAndNullDueDate(t *testing.T) {
	card := types.Account{ID: "card", Name: "Card", Kind: types.AccountKindCreditCard, Enabled: true, StatementClosingDay: 19}
	model := &types.FinancialModel{Accounts: []types.Account{card}}
	statements := DeriveStatements(model, nil, domain.DayCloseUnix("2026-11-20"))
	if len(statements) == 0 {
		t.Fatal("expected at least one enumerated close")
	}
	for _, statement := range statements {
		if statement.Kind != "unknown" || statement.Balance != nil {
			t.Fatalf("unobserved statement = %+v, want unknown with null balance", statement)
		}
		if statement.DueDate != nil {
			t.Fatalf("unobserved statement has invented due date %v", statement.DueDate)
		}
	}
}

func TestDeriveStatementsSkipsNonCardAccounts(t *testing.T) {
	model := &types.FinancialModel{Accounts: []types.Account{
		{ID: "cash", Kind: types.AccountKindCash, Enabled: true},
		{ID: "card", Kind: types.AccountKindCreditCard, Enabled: true, StatementClosingDay: 19},
	}}
	statements := DeriveStatements(model, nil, domain.DayCloseUnix("2026-11-20"))
	for _, statement := range statements {
		if statement.AccountID != "card" {
			t.Fatalf("derived statement for non-card account: %+v", statement)
		}
	}
}

func stringPtr(value string) *string { return &value }

func amount(value string) types.TransactionAmountResolution {
	return types.TransactionAmountResolution{
		Resolver: "expression",
		Config:   map[string]any{"expression": value},
		Inputs:   map[string]types.AmountInputBinding{},
	}
}
