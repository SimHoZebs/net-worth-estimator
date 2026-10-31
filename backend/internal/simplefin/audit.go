package simplefin

import (
	"github.com/simhozebs/net-worth-estimator/backend/internal/store"
)

// HistoricalVoidPair is one void bank row with exactly one tip-bounded
// settled sibling on the same model account: the pair the live lifecycle
// would have converted had both sides arrived in one feed. The operator
// reviews the list; it never writes. Ambiguous voids are never flagged,
// mirroring the reconciler's uniqueness guard.
type HistoricalVoidPair struct {
	VoidID        string `json:"voidId"`
	SettledID     string `json:"settledId"`
	Name          string `json:"name"`
	VoidAmount    string `json:"voidAmount"`
	SettledAmount string `json:"settledAmount"`
	VoidTime      int64  `json:"voidTime"`
	SettledTime   int64  `json:"settledTime"`
}

// AuditHistoricalVoids scans loaded bank rows for phantom voids on one
// model account: voids with exactly one settled sibling under the same
// tip-bounded join the reconciler uses for pending-to-posted transitions.
// Only this provider's rows participate. No writes; the listing is the
// whole operation.
func AuditHistoricalVoids(bank []store.BankRow, modelAccountID string) []HistoricalVoidPair {
	var settled []store.BankRow
	for _, row := range bank {
		if row.Posting.Source != store.SourceSimpleFIN || row.Posting.Pending || row.Posting.Void {
			continue
		}
		if account, ok := rowAccount(row.Posting); !ok || account != modelAccountID {
			continue
		}
		settled = append(settled, row)
	}
	var pairs []HistoricalVoidPair
	for _, row := range bank {
		if row.Posting.Source != store.SourceSimpleFIN || !row.Posting.Void {
			continue
		}
		if account, ok := rowAccount(row.Posting); !ok || account != modelAccountID {
			continue
		}
		var match *store.BankRow
		ambiguous := false
		for i := range settled {
			candidate := store.SyncPosting{Posting: settled[i].Posting}
			if !settleMatchTolerant(row.Posting, candidate) {
				continue
			}
			if match != nil {
				ambiguous = true
				break
			}
			match = &settled[i]
		}
		if match == nil || ambiguous {
			continue
		}
		voidAmount, _ := row.Posting.Amount.Config["expression"].(string)
		settledAmount, _ := match.Posting.Amount.Config["expression"].(string)
		pairs = append(pairs, HistoricalVoidPair{
			VoidID:        row.Posting.ID,
			SettledID:     match.Posting.ID,
			Name:          match.Posting.Name,
			VoidAmount:    voidAmount,
			SettledAmount: settledAmount,
			VoidTime:      row.Posting.TransactionTime,
			SettledTime:   match.Posting.PostedTime,
		})
	}
	return pairs
}
