package types

// RecurringLinkAssignment maps one recorded bank movement onto one scheduled
// occurrence of an existing forecast rule. Dates are UTC calendar days.
type RecurringLinkAssignment struct {
	PostingID string `json:"postingId"`
	Date      string `json:"date"`
	Amount    string `json:"amount"`
}

// RecurringLinkPreview describes how one confirmed recurring pattern would
// claim occurrences of an existing rule. Linkable is false with a
// plain-language reason when the pattern cannot be linked yet.
type RecurringLinkPreview struct {
	FindingID   string                    `json:"findingId"`
	PatternKey  string                    `json:"patternKey"`
	RuleID      string                    `json:"ruleId"`
	RuleName    string                    `json:"ruleName"`
	Merchant    string                    `json:"merchant"`
	Cadence     string                    `json:"cadence"`
	AccountID   string                    `json:"accountId"`
	Linkable    bool                      `json:"linkable"`
	Reason      string                    `json:"reason,omitempty"`
	Assignments []RecurringLinkAssignment `json:"assignments,omitempty"`
}

// PostingClaimUpdate sets one posting's occurrence claim. The rule and date
// must name a real scheduled occurrence; validation rejects anything else.
type PostingClaimUpdate struct {
	PostingID string       `json:"postingId"`
	Claim     PostingClaim `json:"claim"`
}
