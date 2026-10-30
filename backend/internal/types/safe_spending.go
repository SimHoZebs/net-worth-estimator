package types

// SafeSpendingSettings configures the plan's budget display, outside model math.
type SafeSpendingSettings struct {
	StatementDay       int      `json:"statementDay" minimum:"1" maximum:"28"`
	Reserve            float64  `json:"reserve" minimum:"0"`
	AccountIDs         []string `json:"accountIds" nullable:"true"`
	SpendingAccountIDs []string `json:"spendingAccountIds" nullable:"true"`
	IncomeAccountIDs   []string `json:"incomeAccountIds" nullable:"true"`
	IncomeRuleIDs      []string `json:"incomeRuleIds"`
	TransactionIDs     []string `json:"transactionIds" nullable:"true"`
	StatementDaySet    bool     `json:"statementDaySet"`
}
