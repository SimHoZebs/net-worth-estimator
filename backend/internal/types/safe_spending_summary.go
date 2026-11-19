package types

// SafeSpendingSummary is a factual cash cut plus conditional outstanding bills.
// It is not a projection: future income and simulated fulfillment never enter it.
type SafeSpendingSummary struct {
	Revision              string                 `json:"revision"`
	Start                 string                 `json:"start"`
	End                   string                 `json:"end"`
	CashAsOf              string                 `json:"cashAsOf" doc:"UTC calendar date of the cash evidence cut"`
	Status                string                 `json:"status"`
	Reasons               []string               `json:"reasons"`
	SelectedAccountIDs    []string               `json:"selectedAccountIds"`
	Baselines             []SafeSpendingBaseline `json:"baselines"`
	CheckingAvailable     *float64               `json:"checkingAvailable"`
	ConfirmedMovements    []SafeSpendingMovement `json:"confirmedMovements"`
	Bills                 []SafeSpendingBill     `json:"bills"`
	OutstandingBillsTotal *float64               `json:"outstandingBillsTotal"`
	CashAfterBills        *float64               `json:"cashAfterBills"`
}

type SafeSpendingBaseline struct {
	AccountID        string   `json:"accountId"`
	AccountName      string   `json:"accountName"`
	ObservedAt       *int64   `json:"observedAt"`
	PostedBalance    *float64 `json:"postedBalance"`
	AvailableBalance *float64 `json:"availableBalance"`
	Basis            string   `json:"basis"`
	Status           string   `json:"status"`
	Reasons          []string `json:"reasons"`
}

type SafeSpendingMovement struct {
	TransactionID string  `json:"transactionId"`
	AccountID     string  `json:"accountId"`
	Name          string  `json:"name"`
	PostedAt      int64   `json:"postedAt"`
	EffectiveAt   int64   `json:"effectiveAt"`
	Amount        float64 `json:"amount"`
}

type SafeSpendingBill struct {
	ID            string   `json:"id"`
	TransactionID *string  `json:"transactionId"`
	ScheduleID    *string  `json:"scheduleId"`
	AccountID     string   `json:"accountId"`
	Name          string   `json:"name"`
	Date          string   `json:"date"`
	Amount        *float64 `json:"amount"`
	Status        string   `json:"status" enum:"paid,unpaid,pending,unknown"`
}
