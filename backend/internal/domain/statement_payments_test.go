package domain

import (
	"testing"
	"time"

	"github.com/simhozebs/net-worth-estimator/backend/internal/types"
)

func statementTestTime(t *testing.T, date string) int64 {
	t.Helper()
	parsed, err := time.Parse(time.DateOnly, date)
	if err != nil {
		t.Fatal(err)
	}
	return parsed.Unix()
}

func statementTestAmount(value string) types.TransactionAmountResolution {
	return types.TransactionAmountResolution{
		Resolver: "expression",
		Config:   map[string]any{"expression": value},
		Inputs:   map[string]types.AmountInputBinding{},
	}
}

func TestStatementPaymentSuggestionsWithConfirmedTransferLink(t *testing.T) {
	checking, card := "checking", "card"
	posted := statementTestTime(t, "2026-01-31")
	model := &types.FinancialModel{
		Accounts: []types.Account{
			{ID: checking, Kind: types.AccountKindCash, Enabled: true},
			{ID: card, Kind: types.AccountKindCreditCard, Enabled: true},
		},
		Transactions: []types.Transaction{
			// External cash outflow: source, no destination.
			{ID: "cash-out", Name: "Card payment", SourceAccountID: &checking,
				Amount: statementTestAmount("500"), PostedTime: posted, TransactionTime: posted, Enabled: true},
			// External card inflow: no source, one destination on the card.
			{ID: "card-in", Name: "Card payment", Destinations: []string{card},
				Amount: statementTestAmount("500"), PostedTime: posted, TransactionTime: posted, Enabled: true},
		},
	}
	statement := types.CardStatement{
		ID: "stmt", AccountID: card, ClosingDate: "2026-01-31", DueDate: "2026-02-20", Balance: 500,
		Currency: "USD",
	}
	reads := []types.StatementAllocationRead{{
		Statement: statement, Allocations: []types.StatementAllocation{},
		Allocated: 0, Remaining: 500,
	}}
	links := []types.TransferLink{{LegA: "card-in", LegB: "cash-out", FindingID: "finding"}}

	for _, named := range []string{"cash-out", "card-in"} {
		matches, canonicalID := StatementPaymentSuggestions(model, links, named, reads, map[string]string{})
		if len(matches) != 1 {
			t.Fatalf("lookup %s: matches = %+v, want one", named, matches)
		}
		if canonicalID != "cash-out" {
			t.Fatalf("lookup %s: canonical = %q, want cash-out", named, canonicalID)
		}
		if matches[0].Read.Statement.ID != "stmt" || matches[0].Payment.Amount != 500 {
			t.Fatalf("lookup %s: match = %+v", named, matches[0])
		}
		if ResolveCanonicalPaymentID(model, links, named, map[string]bool{card: true}) != "cash-out" {
			t.Fatalf("lookup %s: canonical resolution disagrees", named)
		}
	}

	// Without the confirmed link neither synced leg alone proves the card.
	matches, _ := StatementPaymentSuggestions(model, nil, "card-in", reads, map[string]string{})
	if len(matches) != 0 {
		t.Fatalf("unlinked inflow produced matches = %+v, want none", matches)
	}
}

func TestStatementPaymentSuggestionsRankAgainstRemainingAndFilterByDate(t *testing.T) {
	checking, card := "checking", "card"
	preClose := statementTestTime(t, "2026-01-10")
	onClose := statementTestTime(t, "2026-01-31")
	model := &types.FinancialModel{
		Accounts: []types.Account{
			{ID: checking, Kind: types.AccountKindCash, Enabled: true},
			{ID: card, Kind: types.AccountKindCreditCard, Enabled: true},
		},
		Transactions: []types.Transaction{
			{ID: "early", SourceAccountID: &checking, Destinations: []string{card},
				Amount: statementTestAmount("60.20"), PostedTime: preClose, TransactionTime: preClose, Enabled: true},
			{ID: "later", SourceAccountID: &checking, Destinations: []string{card},
				Amount: statementTestAmount("60.20"), PostedTime: onClose, TransactionTime: onClose, Enabled: true},
		},
	}
	statement := types.CardStatement{
		ID: "stmt", AccountID: card, ClosingDate: "2026-01-31", DueDate: "2026-02-20", Balance: 100.30,
		Currency: "USD",
	}
	// 100.30 billed minus 40.10 confirmed leaves exactly 60.20 cents worth.
	reads := []types.StatementAllocationRead{{
		Statement:   statement,
		Allocations: []types.StatementAllocation{{ID: "a", StatementID: "stmt", TransactionID: "other", Amount: 40.10, State: "confirmed"}},
		Allocated:   40.10, Remaining: MoneyFromCents(MoneyCents(100.30) - MoneyCents(40.10)),
	}}
	if reads[0].Remaining != 60.20 {
		t.Fatalf("remaining = %v, want 60.20", reads[0].Remaining)
	}
	matches, _ := StatementPaymentSuggestions(model, nil, "later", reads, map[string]string{})
	if len(matches) != 1 {
		t.Fatalf("matches = %+v, want the on-close payment only", matches)
	}
	if !hasEvidence(matches[0].Payment.Evidence, "amount-exact") {
		t.Fatalf("payment should be ranked as exact against remaining: %+v", matches[0].Payment.Evidence)
	}
	early, _ := StatementPaymentSuggestions(model, nil, "early", reads, map[string]string{})
	if len(early) != 0 {
		t.Fatalf("pre-close payment should be filtered: %+v", early)
	}
}

func TestIntegerCentValidation(t *testing.T) {
	if HasSubCent(60.20) {
		t.Fatal("an exact cent amount should not be flagged")
	}
	if !HasSubCent(60.201) {
		t.Fatal("sub-cent detection should flag a fractional cent")
	}
	accounts := []types.Account{{ID: "card", Kind: types.AccountKindCreditCard, Enabled: true}}
	statement := types.CardStatement{ID: "s", AccountID: "card", ClosingDate: "2026-01-31", DueDate: "2026-02-20", Balance: 100.30, Currency: "USD"}
	if err := ValidateCardStatement(statement, accounts); err != nil {
		t.Fatalf("valid statement rejected: %v", err)
	}
	statement.Balance = 100.305
	if err := ValidateCardStatement(statement, accounts); err == nil {
		t.Fatal("sub-cent balance should be rejected")
	}
	if err := ValidateStatementAllocation(statement, "2026-02-01", "USD", 60.20, 60.20, 60.20); err == nil {
		t.Fatal("allocation against a sub-cent statement should be rejected")
	}
	statement.Balance = 100.30
	if err := ValidateStatementAllocation(statement, "2026-02-01", "USD", 60.20, 60.20, 60.20); err != nil {
		t.Fatalf("exact cent allocation rejected: %v", err)
	}
}
