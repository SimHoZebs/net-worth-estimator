package types

// SafeSpendingSummary combines observed cash with dated payments and the next cycle forecast.
type SafeSpendingSummary struct {
	Revision               string                  `json:"revision"`
	CashAsOf               string                  `json:"cashAsOf" doc:"UTC calendar date of the cash evidence cut"`
	Status                 string                  `json:"status"`
	Reasons                []string                `json:"reasons"`
	Baselines              []SafeSpendingBaseline  `json:"baselines"`
	CheckingAvailable      *float64                `json:"checkingAvailable"`
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
	PaymentRoom            *float64                `json:"paymentRoom"`
	CardPayoffCapacity     *float64                `json:"cardPayoffCapacity"`
	CycleReset             string                  `json:"cycleReset"`
	CycleStart             string                  `json:"cycleStart" doc:"Inclusive UTC start date of the active spending cycle, beginning on the configured reset day"`
	CycleEnd               string                  `json:"cycleEnd" doc:"Inclusive UTC end date of the active spending cycle, the day before the next reset; recorded transaction activity is also capped at cashAsOf"`
	DaysUntilReset         int                     `json:"daysUntilReset"`
	NextCycleEnd           string                  `json:"nextCycleEnd"`
	IncomeFunded           *float64                `json:"incomeFunded"`
	SavingsAllowance       *float64                `json:"savingsAllowance"`
	ForecastCashRoom       *float64                `json:"forecastCashRoom" doc:"Lowest projected cash balance; signed"`
	FundingRoom            *float64                `json:"fundingRoom"`
	NextCycleIncome        *float64                `json:"nextCycleIncome"`
	NextCycleCarryover     *float64                `json:"nextCycleCarryover"`
	NextCycleDiscretionary *float64                `json:"nextCycleDiscretionary"`
	PaymentPeriodStart     string                  `json:"paymentPeriodStart"`
	PaidByPayday           *float64                `json:"paidByPayday" doc:"Non-card cash bills paid through the payoff date; excludes card payoffs reported separately in statementReserve"`
	UnpaidByPayday         *float64                `json:"unpaidByPayday" doc:"Non-card cash bills still unpaid through the payoff date; excludes card payoffs reported separately in statementReserve and does not depend on statement estimate availability"`
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
