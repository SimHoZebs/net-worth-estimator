package types

// SafeSpendingSummary combines observed cash with dated payments and the next cycle forecast.
type SafeSpendingSummary struct {
	Revision               string                  `json:"revision"`
	CashAsOf               string                  `json:"cashAsOf" doc:"UTC calendar date of the cash evidence cut"`
	Status                 string                  `json:"status"`
	Reasons                []string                `json:"reasons"`
	SelectedAccountIDs     []string                `json:"selectedAccountIds"`
	Baselines              []SafeSpendingBaseline  `json:"baselines"`
	CheckingAvailable      *float64                `json:"checkingAvailable"`
	ConfirmedMovements     []SafeSpendingMovement  `json:"confirmedMovements"`
	Bills                  []SafeSpendingBill      `json:"bills"`
	Payday                 *string                 `json:"payday"`
	CycleFundingPayday     *string                 `json:"cycleFundingPayday" doc:"Paycheck funding the active spending cycle; Payday stays the actual next income"`
	PayoffDate             string                  `json:"payoffDate"`
	ExpectedPay            *float64                `json:"expectedPay"`
	PrePaydayBills         *float64                `json:"prePaydayBills"`
	PaydayBills            *float64                `json:"paydayBills"`
	StatementReserve       *float64                `json:"statementReserve"`
	PrePaydayRoom          *float64                `json:"prePaydayRoom"`
	PostIncomeRoom         *float64                `json:"postIncomeRoom"`
	PostPaydayBalance      *float64                `json:"postPaydayBalance"`
	PaymentRoom            *float64                `json:"paymentRoom"`
	CardPayoffCapacity     *float64                `json:"cardPayoffCapacity"`
	CycleReset             string                  `json:"cycleReset"`
	DaysUntilReset         int                     `json:"daysUntilReset"`
	NextCycleEnd           string                  `json:"nextCycleEnd"`
	SpendableCash          *float64                `json:"spendableCash"`
	IncomeFunded           *float64                `json:"incomeFunded"`
	SavingsAllowance       *float64                `json:"savingsAllowance"`
	ForecastCashRoom       *float64                `json:"forecastCashRoom" doc:"Lowest projected cash balance; signed"`
	AdditionalSavings      *float64                `json:"additionalSavings"`
	FundingRoom            *float64                `json:"fundingRoom"`
	NextCycleIncome        *float64                `json:"nextCycleIncome"`
	NextCycleCarryover     *float64                `json:"nextCycleCarryover"`
	NextCycleDiscretionary *float64                `json:"nextCycleDiscretionary"`
	PaymentPeriodStart     string                  `json:"paymentPeriodStart"`
	PaidByPayday           *float64                `json:"paidByPayday"`
	UnpaidByPayday         *float64                `json:"unpaidByPayday"`
	SafeToSpend            *float64                `json:"safeToSpend"`
	Statements             []SafeSpendingStatement `json:"statements"`
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
	ActualDate    *string  `json:"actualDate"`
	ScheduleID    *string  `json:"scheduleId"`
	AccountID     string   `json:"accountId"`
	Name          string   `json:"name"`
	Date          string   `json:"date"`
	Amount        *float64 `json:"amount"`
	Status        string   `json:"status" enum:"paid,unpaid,pending,unknown"`
	UncoveredHold *float64 `json:"-"`
}
