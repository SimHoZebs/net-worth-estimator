package simplefin

import (
	"encoding/json"

	"github.com/simhozebs/net-worth-estimator/backend/internal/types"
)

// accountTypeMetadata is the allowlisted fact metadata key that carries the
// bridge's own account type hint. It is a source assertion, no more authoritative
// than the descriptor, and analysis never writes the declared account kind.
const accountTypeMetadata = "account_type"

// transactionFacts retains source text before display truncation. Optional
// enrichment fields are allowlisted and remain source assertions, not facts
// established by our own classifier.
func transactionFacts(transaction Transaction, currency, accountType string) *types.TransactionFacts {
	facts := &types.TransactionFacts{
		Description: transaction.Description, Payee: transaction.Payee, Memo: transaction.Memo,
		Amount: transaction.Amount, Currency: currency, Pending: transaction.IsPending(), PostedTime: transaction.Posted,
		Metadata: map[string]string{},
	}
	if facts.Currency == "" {
		facts.Currency = "USD"
	}
	if transaction.TransactedAt != nil {
		facts.OccurredAt = *transaction.TransactedAt
	}
	for _, key := range []string{"category", "merchant_name", "payment_product"} {
		var value string
		if json.Unmarshal(transaction.Extra[key], &value) == nil && len(value) <= 500 {
			facts.Metadata[key] = value
		}
	}
	if accountType != "" {
		facts.Metadata[accountTypeMetadata] = accountType
	}
	return facts
}

// accountTypeHint decodes the bridge's optional free-form account type. An
// absent, malformed, or oversized value stays unknown rather than becoming a
// signal. Other extra fields are never copied into stored facts.
func accountTypeHint(account Account) string {
	raw := account.Extra["type"]
	var value string
	if len(raw) == 0 || json.Unmarshal(raw, &value) != nil || len(value) > 100 {
		return ""
	}
	return value
}
