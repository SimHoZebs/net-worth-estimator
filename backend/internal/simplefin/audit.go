package simplefin

import (
	"strings"

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
	type settledCandidate struct {
		row             store.BankRow
		cents           int64
		name            string
		outflow         bool
		transactionTime int64
	}
	var settled []settledCandidate
	for _, row := range bank {
		if row.Posting.Source != store.SourceSimpleFIN || row.Posting.Pending || row.Posting.Void {
			continue
		}
		if account, ok := rowAccount(row.Posting); !ok || account != modelAccountID {
			continue
		}
		cents, ok := postingAmountCents(row.Posting)
		if !ok || cents <= 0 {
			continue
		}
		settled = append(settled, settledCandidate{
			row:             row,
			cents:           cents,
			name:            strings.ToUpper(strings.TrimSpace(row.Posting.Name)),
			outflow:         rowOutflow(row.Posting),
			transactionTime: row.Posting.TransactionTime,
		})
	}
	var pairs []HistoricalVoidPair
	for _, row := range bank {
		if row.Posting.Source != store.SourceSimpleFIN || !row.Posting.Void {
			continue
		}
		if account, ok := rowAccount(row.Posting); !ok || account != modelAccountID {
			continue
		}
		staleCents, ok := postingAmountCents(row.Posting)
		if !ok || staleCents <= 0 {
			continue
		}
		staleName := strings.ToUpper(strings.TrimSpace(row.Posting.Name))
		staleOutflow := rowOutflow(row.Posting)
		minCents, maxCents, ok := settleTipBounds(staleCents)
		if !ok {
			continue
		}
		var match *settledCandidate
		ambiguous := false
		for i := range settled {
			candidate := &settled[i]
			if candidate.outflow != staleOutflow {
				continue
			}
			gap := candidate.transactionTime - row.Posting.TransactionTime
			if gap < -settleMatchWindowSeconds || gap > settleMatchWindowSeconds {
				continue
			}
			if !strings.Contains(candidate.name, staleName) && !strings.Contains(staleName, candidate.name) {
				continue
			}
			if candidate.cents != staleCents && (candidate.cents < minCents || candidate.cents > maxCents) {
				continue
			}
			if match != nil {
				ambiguous = true
				break
			}
			match = candidate
		}
		if match == nil || ambiguous {
			continue
		}
		voidAmount, _ := row.Posting.Amount.Config["expression"].(string)
		settledAmount, _ := match.row.Posting.Amount.Config["expression"].(string)
		pairs = append(pairs, HistoricalVoidPair{
			VoidID:        row.Posting.ID,
			SettledID:     match.row.Posting.ID,
			Name:          match.row.Posting.Name,
			VoidAmount:    voidAmount,
			SettledAmount: settledAmount,
			VoidTime:      row.Posting.TransactionTime,
			SettledTime:   match.row.Posting.PostedTime,
		})
	}
	return pairs
}
