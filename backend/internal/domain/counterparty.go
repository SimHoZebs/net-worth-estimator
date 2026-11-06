package domain

import (
	"github.com/simhozebs/net-worth-estimator/backend/internal/types"
)

// External counterparty classification. A nil source means the external
// counterparty funds the transaction; nil destinations mean it receives it.
// This file is the single definition of that meaning. Call sites classify
// through these helpers instead of re-deriving nil semantics, while
// execution clamps and presence checks keep their direct pointer tests.

// TransactionSourceAccount returns the funding account when the transaction is
// account-sourced. False means the external counterparty funds it.
func TransactionSourceAccount(transaction *types.Transaction) (string, bool) {
	if transaction.SourceAccountID == nil {
		return "", false
	}
	return *transaction.SourceAccountID, true
}

// HasExternalSource reports whether the external counterparty funds the
// transaction.
func HasExternalSource(transaction *types.Transaction) bool {
	return transaction.SourceAccountID == nil
}

// HasExternalDestination reports whether the external counterparty receives
// the transaction.
func HasExternalDestination(transaction *types.Transaction) bool {
	return transaction.Destinations == nil
}

// IsExternalInflow reports money arriving from outside.
func IsExternalInflow(transaction *types.Transaction) bool {
	return HasExternalSource(transaction) && !HasExternalDestination(transaction)
}

// IsExternalOutflow reports money leaving to outside.
func IsExternalOutflow(transaction *types.Transaction) bool {
	return !HasExternalSource(transaction) && HasExternalDestination(transaction)
}

// IsInternalTransfer reports money moving between accounts.
func IsInternalTransfer(transaction *types.Transaction) bool {
	return !HasExternalSource(transaction) && !HasExternalDestination(transaction)
}
