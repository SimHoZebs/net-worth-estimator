package types

// PurchasePolicy marks an input to the isolated planned-purchases evaluation.
// Main projections and history never execute it. Lower priorities execute
// first; document order breaks ties. Transaction day is the earliest buy day.
//
// Deprecated: new code uses PlannedPurchase rows. Posting.Purchase remains
// as a legacy read path so existing documents and tests keep working.
type PurchasePolicy struct {
	Priority int `json:"priority"`
}

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
