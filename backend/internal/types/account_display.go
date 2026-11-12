package types

import "strings"

// AccountDisplay identifies one visible account backed by model accounts.
// Its identity is the primary backing account ID, never an extra balance.
type AccountDisplay struct {
	Name               string             `json:"name"`
	Components         []AccountComponent `json:"components"`
	InterestScheduleID string             `json:"interestScheduleId"`
	PaymentScheduleID  string             `json:"paymentScheduleId"`
}

// AccountComponent is one backing account in a visible account.
type AccountComponent struct {
	AccountID string `json:"accountId"`
	Role      string `json:"role"`
}

// PassthroughDisplay builds the stored display for an ordinary account:
// a single self component with the primary role and empty rule IDs.
func PassthroughDisplay(accountID, name string) *AccountDisplay {
	return &AccountDisplay{
		Name:               name,
		Components:         []AccountComponent{{AccountID: accountID, Role: "primary"}},
		InterestScheduleID: "",
		PaymentScheduleID:  "",
	}
}

// IsPassthroughDisplay reports whether display is the passthrough shape
// owned by ownerID: a single self component with the primary role,
// empty rule IDs, and a non-empty name.
func IsPassthroughDisplay(display *AccountDisplay, ownerID string) bool {
	if display == nil || len(display.Components) != 1 {
		return false
	}
	if display.InterestScheduleID != "" || display.PaymentScheduleID != "" {
		return false
	}
	component := display.Components[0]
	if component.AccountID != ownerID || component.Role != "primary" {
		return false
	}
	return len(strings.TrimSpace(display.Name)) > 0
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
