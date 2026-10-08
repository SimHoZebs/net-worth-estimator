package domain

import (
	"github.com/simhozebs/net-worth-estimator/backend/internal/types"
)

// External counterparty classification. A nil source means the external
// counterparty funds the movement; nil destinations mean it receives it.
// This file is the single definition of that meaning. Call sites classify
// through these helpers instead of re-deriving nil semantics, while
// execution clamps and presence checks keep their direct pointer tests.

// PostingSourceAccount returns the funding account when the posting is
// account-sourced. False means the external counterparty funds it.
func PostingSourceAccount(posting *types.Posting) (string, bool) {
	if posting.SourceAccountID == nil {
		return "", false
	}
	return *posting.SourceAccountID, true
}

// HasExternalSource reports whether the external counterparty funds the
// posting.
func HasExternalSource(posting *types.Posting) bool {
	return posting.SourceAccountID == nil
}

// HasExternalDestination reports whether the external counterparty receives
// the posting.
func HasExternalDestination(posting *types.Posting) bool {
	return posting.Destinations == nil
}

// IsExternalInflow reports money arriving from outside.
func IsExternalInflow(posting *types.Posting) bool {
	return HasExternalSource(posting) && !HasExternalDestination(posting)
}

// IsExternalOutflow reports money leaving to outside.
func IsExternalOutflow(posting *types.Posting) bool {
	return !HasExternalSource(posting) && HasExternalDestination(posting)
}

// IsInternalTransfer reports money moving between accounts.
func IsInternalTransfer(posting *types.Posting) bool {
	return !HasExternalSource(posting) && !HasExternalDestination(posting)
}
