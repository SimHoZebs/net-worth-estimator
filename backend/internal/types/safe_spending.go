package types

const (
	DefaultSafeSpendingCycleStartDay = 20
	DefaultSafeSpendingPaydayDay     = 30
)

// SafeSpendingSettings configures the plan's budget display, outside model math.
type SafeSpendingSettings struct {
	Reserve            float64  `json:"reserve" minimum:"0"`
	CycleStartDay      int      `json:"cycleStartDay" minimum:"1" maximum:"31" default:"20" required:"false"`
	PaydayDay          int      `json:"paydayDay" minimum:"1" maximum:"31" default:"30" required:"false"`
	SavingsTarget      float64  `json:"savingsTarget" minimum:"0" default:"0" required:"false"`
	AccountIDs         []string `json:"accountIds" nullable:"true"`
	SpendingAccountIDs []string `json:"spendingAccountIds" nullable:"true"`
	IncomeScheduleIDs  []string `json:"incomeScheduleIds"`
	TransactionIDs     []string `json:"transactionIds" nullable:"true"`
}
