package simplefin

import "github.com/simhozebs/net-worth-estimator/backend/internal/store"

// HistoricalVoidPair is one void bank row with exactly one merchant-profile
// matched settled sibling on the same model account: the pair the live lifecycle
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
// merchant-profile join the reconciler uses for pending-to-posted
// transitions.
// Only this provider's rows participate. No writes; the listing is the
// whole operation.
func AuditHistoricalVoids(bank []store.BankRow, modelAccountID string) []HistoricalVoidPair {
	var pairs []HistoricalVoidPair
	for _, row := range bank {
		if row.Transaction.Source != store.SourceBankSync || !row.Transaction.Void || !hasSimpleFINKey(row) {
			continue
		}
		if account, ok := rowAccount(row.Transaction); !ok || account != modelAccountID {
			continue
		}
		if !profileForTransaction(row.Transaction).AutoConvert {
			continue
		}
		candidates := SettleCandidates(row, bank)
		if len(candidates) != 1 {
			continue
		}
		match := candidates[0]
		voidAmount, _ := row.Transaction.Amount.Config["expression"].(string)
		settledAmount, _ := match.Transaction.Amount.Config["expression"].(string)
		pairs = append(pairs, HistoricalVoidPair{
			VoidID:        row.Transaction.ID,
			SettledID:     match.Transaction.ID,
			Name:          match.Transaction.Name,
			VoidAmount:    voidAmount,
			SettledAmount: settledAmount,
			VoidTime:      row.Transaction.TransactionTime,
			SettledTime:   match.Transaction.PostedTime,
		})
	}
	return pairs
}
