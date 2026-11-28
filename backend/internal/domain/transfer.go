package domain

import (
	"math"

	"github.com/simhozebs/net-worth-estimator/backend/internal/types"
)

// TransferMatchWindowDays is the product-decided maximum calendar-day gap
// between opposite legs of one transfer (VIS-03).
const TransferMatchWindowDays = 7

// TransferLegFacts is the normalized matching key for one bank leg. Settled is
// supplied by the caller because model pending/void state is separate from the
// preserved bank facts used by incremental analysis.
type TransferLegFacts struct {
	AccountID string
	Currency  string
	Cents     int64
	Day       int64
	Outflow   bool
	Settled   bool
}

// TransferLegKey normalizes the amount and timestamp shared by every transfer
// matching path. It deliberately does not apply pending/void eligibility so a
// cached or deleted fact can still name the legs it used to pair with.
func TransferLegKey(facts types.TransactionFacts) (TransferLegFacts, bool) {
	amount, err := ParseNumericAmount(facts.Amount)
	if err != nil || amount.Value == 0 || math.Abs(amount.Value) > 1e10 {
		return TransferLegFacts{}, false
	}
	stamp := facts.OccurredAt
	if stamp <= 0 {
		stamp = facts.PostedTime
	}
	if stamp <= 0 {
		return TransferLegFacts{}, false
	}
	cents := int64(math.Round(math.Abs(amount.Value) * 100))
	if cents == 0 {
		return TransferLegFacts{}, false
	}
	return TransferLegFacts{
		Currency: facts.Currency,
		Cents:    cents,
		Day:      stamp / 86400,
		Outflow:  amount.Value < 0,
	}, true
}

// TransferMatchProblem identifies the first failed shared leg rule. The store
// maps these values to its existing owner-facing validation errors.
type TransferMatchProblem int

const (
	TransferMatchOK TransferMatchProblem = iota
	TransferMatchAccount
	TransferMatchUnsettled
	TransferMatchCurrency
	TransferMatchCents
	TransferMatchDirection
	TransferMatchWindow
)

// CheckTransferLegPair is the single facts-level predicate for opposite legs:
// settled USD rows, different accounts, exact absolute cents, opposite
// directions, and a posting gap no larger than TransferMatchWindowDays.
func CheckTransferLegPair(first, second TransferLegFacts) TransferMatchProblem {
	switch {
	case first.AccountID == "" || second.AccountID == "" || first.AccountID == second.AccountID:
		return TransferMatchAccount
	case !first.Settled || !second.Settled:
		return TransferMatchUnsettled
	case first.Currency != "USD" || second.Currency != "USD":
		return TransferMatchCurrency
	case first.Cents != second.Cents:
		return TransferMatchCents
	case first.Outflow == second.Outflow:
		return TransferMatchDirection
	}
	gap := first.Day - second.Day
	if gap < -TransferMatchWindowDays || gap > TransferMatchWindowDays {
		return TransferMatchWindow
	}
	return TransferMatchOK
}

func TransferLegsMatch(first, second TransferLegFacts) bool {
	return CheckTransferLegPair(first, second) == TransferMatchOK
}

// ExternalTransferLinkDirections identifies the external outflow and external
// inflow orientation of a confirmed link. Same-route and internal pairs stay
// split because netting them would not remove a duplicate external count.
func ExternalTransferLinkDirections(first, second *types.Transaction) (outflow, inflow *types.Transaction, ok bool) {
	switch {
	case IsExternalOutflow(first) && IsExternalInflow(second):
		return first, second, true
	case IsExternalInflow(first) && IsExternalOutflow(second):
		return second, first, true
	default:
		return nil, nil, false
	}
}

// NettableTransferLink is the shared confirmed-link predicate used by row
// netting, flow-graph netting, and link validation. Amounts are the realized
// sums for the two supplied legs; the returned amount uses the projection's
// established rounded-currency comparison.
func NettableTransferLink(first, second *types.Transaction, firstAmount, secondAmount float64) (outflow, inflow *types.Transaction, amount float64, ok bool) {
	outflow, inflow, ok = ExternalTransferLinkDirections(first, second)
	if !ok {
		return nil, nil, 0, false
	}
	outAmount, inAmount := firstAmount, secondAmount
	if outflow == second {
		outAmount, inAmount = secondAmount, firstAmount
	}
	outRounded, inRounded := roundCurrency(outAmount), roundCurrency(inAmount)
	if outRounded <= 0 || outRounded != inRounded {
		return nil, nil, 0, false
	}
	return outflow, inflow, outRounded, true
}
