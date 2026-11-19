package types

// SafeSpendingSettings configures the plan's budget display, outside model math.
type SafeSpendingSettings struct {
	Reserve            float64  `json:"reserve" minimum:"0"`
	AccountIDs         []string `json:"accountIds" nullable:"true"`
	SpendingAccountIDs []string `json:"spendingAccountIds" nullable:"true"`
	IncomeScheduleIDs  []string `json:"incomeScheduleIds"`
	TransactionIDs     []string `json:"transactionIds" nullable:"true"`
}
