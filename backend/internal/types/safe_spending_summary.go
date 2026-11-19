package types

// SafeSpendingSummary combines observed cash with obligations through the next selected payday.
type SafeSpendingSummary struct {
	Revision           string                  `json:"revision"`
	CashAsOf           string                  `json:"cashAsOf" doc:"UTC calendar date of the cash evidence cut"`
	Status             string                  `json:"status"`
	Reasons            []string                `json:"reasons"`
	SelectedAccountIDs []string                `json:"selectedAccountIds"`
	Baselines          []SafeSpendingBaseline  `json:"baselines"`
	CheckingAvailable  *float64                `json:"checkingAvailable"`
	ConfirmedMovements []SafeSpendingMovement  `json:"confirmedMovements"`
	Bills              []SafeSpendingBill      `json:"bills"`
	Payday             *string                 `json:"payday"`
	ExpectedPay        *float64                `json:"expectedPay"`
	PrePaydayBills     *float64                `json:"prePaydayBills"`
	PaydayBills        *float64                `json:"paydayBills"`
	StatementReserve   *float64                `json:"statementReserve"`
	Reserve            float64                 `json:"reserve"`
	PrePaydayRoom      *float64                `json:"prePaydayRoom"`
	PostIncomeRoom     *float64                `json:"postIncomeRoom"`
	SafeToSpend        *float64                `json:"safeToSpend"`
	Statements         []SafeSpendingStatement `json:"statements"`
}

type SafeSpendingStatement struct {
	AccountID   string   `json:"accountId"`
	Name        string   `json:"name"`
	ClosingDate string   `json:"closingDate"`
	Kind        string   `json:"kind" enum:"closed,estimated"`
	Amount      *float64 `json:"amount"`
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
