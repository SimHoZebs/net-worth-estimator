package analysis

import (
	"context"
	"math"
	"strconv"

	"github.com/simhozebs/net-worth-estimator/backend/internal/types"
)

// Match the Transfer detector's USD opposite-leg rule. Index by amount and
// day so unrelated transactions never enter the matching loop.
func incomeTransferIDs(ctx context.Context, transactions []types.AnalysisTransaction) (map[string]bool, error) {
	type leg struct {
		id, account string
		cents, day  int64
	}
	type key struct{ cents, day int64 }
	inflows := map[key][]leg{}
	var outflows []leg
	for _, tx := range transactions {
		if err := ctx.Err(); err != nil {
			return nil, err
		}
		if tx.Pending || tx.Void || tx.Facts.Currency != "USD" {
			continue
		}
		amount, err := strconv.ParseFloat(tx.Facts.Amount, 64)
		if err != nil || math.IsNaN(amount) || math.IsInf(amount, 0) || amount == 0 || math.Abs(amount) > 1e10 {
			continue
		}
		stamp := incomeStamp(tx.Facts)
		if stamp <= 0 {
			continue
		}
		l := leg{tx.TransactionID, tx.AccountID, int64(math.Round(math.Abs(amount) * 100)), stamp / 86400}
		if l.cents == 0 {
			continue
		}
		if amount < 0 {
			outflows = append(outflows, l)
		} else {
			inflows[key{l.cents, l.day}] = append(inflows[key{l.cents, l.day}], l)
		}
	}
	matched := map[string]bool{}
	for _, o := range outflows {
		if err := ctx.Err(); err != nil {
			return nil, err
		}
		for day := o.day - 7; day <= o.day+7; day++ {
			for _, i := range inflows[key{o.cents, day}] {
				if err := ctx.Err(); err != nil {
					return nil, err
				}
				if o.account != i.account {
					matched[o.id], matched[i.id] = true, true
				}
			}
		}
	}
	return matched, nil
}
