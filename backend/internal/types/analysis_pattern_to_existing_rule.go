package types

// PatternToExistingRulePreview describes how one confirmed recurring pattern
// would claim occurrences of an existing rule. Claimable is false with a
// plain-language reason when the pattern cannot be added yet.
type PatternToExistingRulePreview struct {
	FindingID   string              `json:"findingId"`
	PatternKey  string              `json:"patternKey"`
	RuleID      string              `json:"ruleId"`
	RuleName    string              `json:"ruleName"`
	Merchant    string              `json:"merchant"`
	Cadence     string              `json:"cadence"`
	AccountID   string              `json:"accountId"`
	Claimable   bool                `json:"claimable"`
	Reason      string              `json:"reason,omitempty"`
	Assignments []PatternOccurrence `json:"assignments,omitempty"`
}

// PostingClaimUpdate sets one posting's occurrence claim. The rule and date
// must name a real scheduled occurrence; validation rejects anything else.
type PostingClaimUpdate struct {
	PostingID string       `json:"postingId"`
	Claim     PostingClaim `json:"claim"`
}
