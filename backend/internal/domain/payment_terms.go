package domain

import (
	"fmt"
	"math"

	"github.com/simhozebs/net-worth-estimator/backend/internal/types"
)

// Payment-terms linkage. Terms point at accounts by ID; accounts hold no
// back-pointer. The reverse direction (account to terms) is always derived
// through PaymentTermsByAccount, so the two can never drift out of sync.

// PaymentTermsByAccount indexes a document's terms rows by account ID.
func PaymentTermsByAccount(document *types.FinancialModelDocument) map[string]types.PaymentTerms {
	return paymentTermsByAccount(document.PaymentTerms)
}

func paymentTermsByAccount(terms []types.PaymentTerms) map[string]types.PaymentTerms {
	byAccount := make(map[string]types.PaymentTerms, len(terms))
	for _, term := range terms {
		byAccount[term.AccountID] = term
	}
	return byAccount
}

func validatePaymentTerms(issues *[]types.ModelValidationIssue, document *types.FinancialModelDocument, accountIDs map[string]bool) {
	seen := map[string]bool{}
	accountsByID := map[string]types.Account{}
	for _, account := range document.Accounts {
		accountsByID[account.ID] = account
	}
	for index, terms := range document.PaymentTerms {
		path := []any{"paymentTerms", index}
		if seen[terms.AccountID] {
			addIssue(issues, types.SeverityError, "terms.account.duplicate",
				fmt.Sprintf("Account '%s' has more than one payment-terms row.", terms.AccountID),
				append(path, "accountId")...)
			continue
		}
		seen[terms.AccountID] = true
		if !accountIDs[terms.AccountID] {
			addIssue(issues, types.SeverityError, "terms.account.missing",
				fmt.Sprintf("Payment terms reference account '%s', which does not exist.", terms.AccountID),
				append(path, "accountId")...)
			continue
		}
		if accountsByID[terms.AccountID].Kind != types.AccountKindDebt {
			addIssue(issues, types.SeverityError, "terms.account.kind",
				fmt.Sprintf("Payment terms reference account '%s', which is not a debt account.", terms.AccountID),
				append(path, "accountId")...)
		}
		if terms.MinimumFixed < 0 || isNonFinite(terms.MinimumFixed) {
			addIssue(issues, types.SeverityError, "terms.minimum.invalid",
				fmt.Sprintf("Payment terms for '%s' need a fixed minimum at or above zero.", terms.AccountID),
				append(path, "minimumFixed")...)
		}
		if terms.MinimumPercent != nil && (*terms.MinimumPercent < 0 || *terms.MinimumPercent > 1 || isNonFinite(*terms.MinimumPercent)) {
			addIssue(issues, types.SeverityError, "terms.minimum.invalid",
				fmt.Sprintf("Payment terms for '%s' need a percent minimum between 0 and 1.", terms.AccountID),
				append(path, "minimumPercent")...)
		}
		if terms.DueDay < 1 || terms.DueDay > 28 {
			addIssue(issues, types.SeverityError, "terms.dueDay.invalid",
				fmt.Sprintf("Payment terms for '%s' need a due day between 1 and 28.", terms.AccountID),
				append(path, "dueDay")...)
		}
		if terms.StatementDay != nil && (*terms.StatementDay < 1 || *terms.StatementDay > 28) {
			addIssue(issues, types.SeverityError, "terms.statementDay.invalid",
				fmt.Sprintf("Payment terms for '%s' need a statement day between 1 and 28.", terms.AccountID),
				append(path, "statementDay")...)
		}
	}
}

func isNonFinite(value float64) bool {
	return math.IsNaN(value) || math.IsInf(value, 0)
}

// validatePaymentTermsCoverage warns when a termed account has no enabled
// recurring payment shell behind it. Terms declare what is owed; an enabled
// non-once posting naming the account as a destination moves it. The warning
// keeps half-configured terms saveable while refusing silent no-ops.
func validatePaymentTermsCoverage(issues *[]types.ModelValidationIssue, document *types.FinancialModelDocument) {
	covered := map[string]bool{}
	for _, posting := range document.Postings {
		if !posting.Enabled || posting.Frequency == types.FrequencyOnce {
			continue
		}
		for _, destination := range posting.Destinations {
			covered[destination] = true
		}
	}
	for index, terms := range document.PaymentTerms {
		if covered[terms.AccountID] {
			continue
		}
		addIssue(issues, types.SeverityWarning, "terms.payment.missing",
			fmt.Sprintf("Payment terms for '%s' have no enabled payment behind them.", terms.AccountID),
			[]any{"paymentTerms", index, "accountId"}...)
	}
}
