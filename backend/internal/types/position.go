package types

// CurrentPosition is derived from history, without a future simulation.
// The as-of cut is an instant: a "YYYY-MM-DD" date means the end of that
// UTC day (inclusive, backward compatible); an RFC 3339 timestamp means
// that exact instant. Balance is the adjusted modeled balance at the cut;
// ObservedBalance/ObservedAt carry the latest observation at or before it.
// All public balances agree at an identical cut because they share one
// chronological replay.
type CurrentPosition struct {
	AsOfDate IsoDate           `json:"asOfDate"`
	NetWorth float64           `json:"netWorth"`
	Accounts []PositionAccount `json:"accounts"`
}

type PositionAccount struct {
	AccountID string  `json:"accountId"`
	Balance   float64 `json:"balance"`
	// ObservedBalance is the latest observation at or before the cut.
	// Nil when the account has no observation in range.
	ObservedBalance *float64 `json:"observedBalance,omitempty"`
	// ObservedAt is the observation instant (Unix). Nil with
	// ObservedBalance.
	ObservedAt *int64 `json:"observedAt,omitempty"`
}
