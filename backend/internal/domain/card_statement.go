package domain

import (
	"fmt"
	"math"
	"strings"

	"github.com/simhozebs/net-worth-estimator/backend/internal/types"
)

// DefaultCardStatementCurrency is the owner-facing currency when a statement
// omits one, matching the USD-oriented financial model.
const DefaultCardStatementCurrency = "USD"

// MoneyCents converts a dollar amount to integer cents with consistent
// rounding. All remaining, cap, and sum comparisons use cents so 100.30 minus
// 40.10 yields exactly 6020 cents and accepts a 60.20 payment.
func MoneyCents(value float64) int64 {
	return int64(math.Round(value * 100))
}

// MoneyFromCents is the inverse of MoneyCents for wire values.
func MoneyFromCents(cents int64) float64 {
	return float64(cents) / 100
}

// HasSubCent reports whether an authored amount carries a fraction of a cent.
func HasSubCent(value float64) bool {
	return math.Abs(value*100-float64(MoneyCents(value))) > 1e-6
}

// NormalizeCardStatementCurrency fills an omitted currency with USD and
// uppercases an authored code so one canonical value is stored.
func NormalizeCardStatementCurrency(currency string) string {
	if strings.TrimSpace(currency) == "" {
		return DefaultCardStatementCurrency
	}
	return strings.ToUpper(strings.TrimSpace(currency))
}

// ValidateCardStatement checks an owner-entered statement before it is saved.
// The close date is an observed fact; it is never derived from a close day,
// and a close day alone never proves the billed balance.
func ValidateCardStatement(statement types.CardStatement, accounts []types.Account) error {
	accountByID := make(map[string]types.Account, len(accounts))
	for _, account := range accounts {
		accountByID[account.ID] = account
	}
	account, ok := accountByID[statement.AccountID]
	if !ok {
		return fmt.Errorf("statement account %q does not exist", statement.AccountID)
	}
	if account.Kind != types.AccountKindCreditCard {
		return fmt.Errorf("statements require a saved credit_card account")
	}
	if !IsValidIsoDate(statement.ClosingDate) {
		return fmt.Errorf("closingDate must be a YYYY-MM-DD calendar date")
	}
	if !IsValidIsoDate(statement.DueDate) {
		return fmt.Errorf("dueDate must be a YYYY-MM-DD calendar date")
	}
	if CompareIsoDates(statement.DueDate, statement.ClosingDate) < 0 {
		return fmt.Errorf("dueDate must be the same as or later than closingDate")
	}
	if statement.Balance <= 0 || math.IsInf(statement.Balance, 0) || math.IsNaN(statement.Balance) || statement.Balance > 1_000_000_000_000 {
		return fmt.Errorf("balance must be a positive finite amount")
	}
	if HasSubCent(statement.Balance) {
		return fmt.Errorf("balance must be an exact number of cents")
	}
	// The model is USD-first: receipts and transfer netting require USD, so a
	// recorded statement follows the same convention instead of introducing a
	// second currency reality for the same billed balance.
	if NormalizeCardStatementCurrency(statement.Currency) != DefaultCardStatementCurrency {
		return fmt.Errorf("only USD statements are supported")
	}
	if len(statement.Note) > 500 {
		return fmt.Errorf("note is too long")
	}
	return nil
}

// ValidateStatementAllocation gates one explicit allocation. The payment must
// be a settled transfer into the card, the amount must be a positive part of
// that payment and of the statement's remaining balance, and the payment must
// post no earlier than the recorded close. No amount-based auto-claim happens
// here: the owner has already chosen the payment and statement.
func ValidateStatementAllocation(statement types.CardStatement, postedDate, currency string, paymentAmount, amount, remaining float64) error {
	if amount <= 0 || math.IsInf(amount, 0) || math.IsNaN(amount) || amount > 1_000_000_000_000 {
		return fmt.Errorf("allocation amount must be a positive finite amount")
	}
	if HasSubCent(amount) {
		return fmt.Errorf("allocation amount must be an exact number of cents")
	}
	if HasSubCent(statement.Balance) || HasSubCent(remaining) || HasSubCent(paymentAmount) {
		return fmt.Errorf("statement and payment amounts must be exact numbers of cents")
	}
	amountCents, paymentCents, remainingCents := MoneyCents(amount), MoneyCents(paymentAmount), MoneyCents(remaining)
	if paymentCents <= 0 || amountCents > paymentCents {
		return fmt.Errorf("allocation amount must not exceed the posted payment")
	}
	if remainingCents <= 0 || amountCents > remainingCents {
		return fmt.Errorf("allocation amount must not exceed the statement's remaining balance")
	}
	if !IsValidIsoDate(postedDate) {
		return fmt.Errorf("posted payment date must be a YYYY-MM-DD calendar date")
	}
	if CompareIsoDates(postedDate, statement.ClosingDate) < 0 {
		return fmt.Errorf("a payment cannot settle a statement before it closed")
	}
	if NormalizeCardStatementCurrency(currency) != NormalizeCardStatementCurrency(statement.Currency) {
		return fmt.Errorf("payment currency does not match the statement currency")
	}
	return nil
}
