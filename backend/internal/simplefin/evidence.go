package simplefin

import (
	"encoding/json"

	"github.com/simhozebs/net-worth-estimator/backend/internal/types"
)

// transactionFacts retains source text before display truncation. Optional
// enrichment fields are allowlisted and remain source assertions, not facts
// established by our own classifier.
func transactionFacts(transaction Transaction, currency string) *types.TransactionFacts {
	facts := &types.TransactionFacts{
		Description: transaction.Description, Payee: transaction.Payee, Memo: transaction.Memo,
		Amount: transaction.Amount, Currency: currency, PostedTime: transaction.Posted,
		Metadata: map[string]string{},
	}
	if facts.Currency == "" {
		facts.Currency = "USD"
	}
	if transaction.TransactedAt != nil {
		facts.OccurredAt = *transaction.TransactedAt
	}
	for _, key := range []string{"category", "merchant_name", "payment_product", "order_reference"} {
		var value string
		if json.Unmarshal(transaction.Extra[key], &value) == nil && len(value) <= 500 {
			facts.Metadata[key] = value
		}
	}
	return facts
}
