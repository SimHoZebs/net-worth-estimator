package types

// CurrentPosition is derived from history, without a future simulation.
type CurrentPosition struct {
	AsOfDate IsoDate           `json:"asOfDate"`
	NetWorth float64           `json:"netWorth"`
	Accounts []PositionAccount `json:"accounts"`
}

type PositionAccount struct {
	AccountID string  `json:"accountId"`
	Balance   float64 `json:"balance"`
}
