package analysis

import (
	"context"

	"github.com/simhozebs/net-worth-estimator/backend/internal/domain"
	"github.com/simhozebs/net-worth-estimator/backend/internal/types"
)

// paymentLegKeyFacts reads the opposite-leg matching key from bank facts
// without any pending/void eligibility check, so a flipped or deleted fact
// still names the legs it used to pair with. Currency, amount, and stamp
// validity match the transfer detector exactly.
func paymentLegKeyFacts(facts types.TransactionFacts) (cents, day int64, outflow bool, ok bool) {
	if facts.Currency != "USD" {
		return 0, 0, false, false
	}
	key, ok := domain.TransferLegKey(facts)
	if !ok {
		return 0, 0, false, false
	}
	return key.Cents, key.Day, key.Outflow, true
}

// Match the Transfer detector's USD opposite-leg rule. Index by amount and
// day so unrelated transactions never enter the matching loop.
func paymentTransferIDs(ctx context.Context, transactions []types.AnalysisTransaction) (map[string]bool, error) {
	pairs, err := paymentTransferPairs(ctx, transactions)
	if err != nil {
		return nil, err
	}
	matched := map[string]bool{}
	for id := range pairs {
		matched[id] = true
	}
	return matched, nil
}

// paymentTransferPairs applies the same opposite-leg rule but keeps both
// sides of every pair. The incremental path recomputes both sides of any
// touched pair, since a new leg can change exclusion in the stream holding
// the other leg.
func paymentTransferPairs(ctx context.Context, transactions []types.AnalysisTransaction) (map[string]map[string]bool, error) {
	type leg struct {
		id  string
		key domain.TransferLegFacts
	}
	type key struct{ cents, day int64 }
	inflows := map[key][]leg{}
	var outflows []leg
	for _, tx := range transactions {
		if err := ctx.Err(); err != nil {
			return nil, err
		}
		if tx.Pending || tx.Void {
			continue
		}
		cents, day, outflow, ok := paymentLegKeyFacts(tx.Facts)
		if !ok {
			continue
		}
		legKey := domain.TransferLegFacts{AccountID: tx.AccountID, Currency: tx.Facts.Currency, Cents: cents, Day: day, Outflow: outflow, Settled: true}
		l := leg{id: tx.TransactionID, key: legKey}
		if outflow {
			outflows = append(outflows, l)
		} else {
			inflows[key{cents, day}] = append(inflows[key{cents, day}], l)
		}
	}
	partners := map[string]map[string]bool{}
	for _, o := range outflows {
		if err := ctx.Err(); err != nil {
			return nil, err
		}
		for day := o.key.Day - domain.TransferMatchWindowDays; day <= o.key.Day+domain.TransferMatchWindowDays; day++ {
			for _, i := range inflows[key{o.key.Cents, day}] {
				if err := ctx.Err(); err != nil {
					return nil, err
				}
				if !domain.TransferLegsMatch(o.key, i.key) {
					continue
				}
				if partners[o.id] == nil {
					partners[o.id] = map[string]bool{}
				}
				if partners[i.id] == nil {
					partners[i.id] = map[string]bool{}
				}
				partners[o.id][i.id], partners[i.id][o.id] = true, true
			}
		}
	}
	return partners, nil
}
