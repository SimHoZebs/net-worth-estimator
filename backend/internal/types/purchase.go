package types

// PurchasePolicy marks an input to the isolated planned-purchases evaluation.
// Main projections and history never execute it. Lower priorities execute
// first; document order breaks ties. Transaction day is the earliest buy day.
type PurchasePolicy struct {
	Priority int `json:"priority"`
}
