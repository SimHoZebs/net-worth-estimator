package types

// AccountDisplay identifies one visible account backed by model accounts.
// Its identity is the primary backing account ID, never an extra balance.
type AccountDisplay struct {
	Name               string             `json:"name"`
	Components         []AccountComponent `json:"components"`
	InterestScheduleID string             `json:"interestScheduleId"`
	PaymentScheduleID  string             `json:"paymentScheduleId"`
}

type AccountComponent struct {
	AccountID string `json:"accountId"`
	Role      string `json:"role"`
}

// LoanTerms owns the account pair, observations, and recurrence rules.
type LoanTerms struct {
	Name              string    `json:"name" minLength:"1" maxLength:"100"`
	Principal         float64   `json:"principal" minimum:"0" maximum:"10000000000"`
	AccruedInterest   float64   `json:"accruedInterest" minimum:"0" maximum:"10000000000"`
	ObservedAt        int64     `json:"observedAt" minimum:"1"`
	RecordBalances    bool      `json:"recordBalances" doc:"On update, record principal and interest observations at observedAt only when true"`
	AnnualRate        float64   `json:"annualRate" minimum:"0" maximum:"1"`
	InterestFrequency Frequency `json:"interestFrequency"`
	InterestStartDate IsoDate   `json:"interestStartDate"`
	Payment           float64   `json:"payment" minimum:"0" maximum:"10000000000"`
	PaymentFrequency  Frequency `json:"paymentFrequency"`
	PaymentStartDate  IsoDate   `json:"paymentStartDate"`
	FundingAccountID  string    `json:"fundingAccountId" doc:"Empty means dormant: the payment rule carries no source until funding is set"`
	Enabled           bool      `json:"enabled"`
}

type LoanBundle struct {
	Accounts    []Account
	Checkpoints []Checkpoint
	Schedules   []Schedule
}
