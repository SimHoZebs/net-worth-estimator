package types

// PatternPreviewHeader is the shared identity for both pattern previews.
// Both flows describe the same confirmed pattern and differ only in the
// action tail, so the header stays in one place.
type PatternPreviewHeader struct {
	FindingID  string `json:"findingId"`
	PatternKey string `json:"patternKey"`
	Merchant   string `json:"merchant"`
	Cadence    string `json:"cadence"`
	AccountID  string `json:"accountId"`
}

// PatternDatedAmount is the single dated-money shape shared by recorded
// evidence and forecast movements. Amount keeps the source decimal spelling
// and Date is a UTC calendar day.
type PatternDatedAmount struct {
	Date   string `json:"date"`
	Amount string `json:"amount"`
}

// PatternOccurrence is one recorded bank movement behind a confirmed
// recurring pattern. It shares the dated-money shape: both pattern flows use
// it, with new-schedule creation listing it as evidence and existing-schedule
// addition mapping each one onto a scheduled occurrence.
type PatternOccurrence struct {
	PatternDatedAmount
	TransactionID string `json:"transactionId"`
}

// ExpressionAmountResolution is the single expression-amount mapping from a
// preview proposal to a saved schedule. Approval saves exactly what the
// preview showed.
func ExpressionAmountResolution(amount string) TransactionAmountResolution {
	return TransactionAmountResolution{
		Resolver: "expression",
		Config:   map[string]any{"expression": amount},
		Inputs:   map[string]AmountInputBinding{},
	}
}
