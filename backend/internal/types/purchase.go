package types

// PlannedPurchase is a standalone planned-purchase row, separated from
// postings. Lower Priority executes first; document order breaks ties.
// EarliestDate is the earliest buy day; Cost is the fixed positive cost.
type PlannedPurchase struct {
	ID               string  `json:"id"`
	Name             string  `json:"name"`
	FundingAccountID *string `json:"fundingAccountId,omitempty"`
	Cost             float64 `json:"cost"`
	EarliestDate     IsoDate `json:"earliestDate"`
	Enabled          bool    `json:"enabled"`
	Priority         int     `json:"priority"`
}
