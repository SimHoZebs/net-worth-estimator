package types

// BalanceAdjustment is observation evidence from historical replay, not income
// or spending. It retains the exact instant even for same-day observations.
type BalanceAdjustment struct {
	AccountID       string  `json:"accountId"`
	ObservedAt      int64   `json:"observedAt"`
	PreviousBalance float64 `json:"previousBalance"`
	Balance         float64 `json:"balance"`
	Adjustment      float64 `json:"adjustment"`
	Source          string  `json:"source"`
}
