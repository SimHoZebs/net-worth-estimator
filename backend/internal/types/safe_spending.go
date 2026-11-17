package types

// SafeSpendingSettings configures the plan's budget display, outside model math.
type SafeSpendingSettings struct {
	StatementDay int     `json:"statementDay" minimum:"1" maximum:"28"`
	Reserve      float64 `json:"reserve" minimum:"0"`
	// AccountIDs is the frontend-owned selection of tracked cards. The cash
	// summary ignores it; it is persisted in this blob so the choice survives.
	AccountIDs         []string `json:"accountIds" nullable:"true"`
	SpendingAccountIDs []string `json:"spendingAccountIds" nullable:"true"`
	IncomeScheduleIDs  []string `json:"incomeScheduleIds"`
	TransactionIDs     []string `json:"transactionIds" nullable:"true"`
	StatementDaySet    bool     `json:"statementDaySet"`
}
