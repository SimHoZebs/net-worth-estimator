package types

// PatternToExistingSchedulePreview describes how one confirmed recurring pattern
// would claim occurrences of an existing schedule. Claimable is false with a
// plain-language reason when the pattern cannot be added yet.
type PatternToExistingSchedulePreview struct {
	FindingID    string              `json:"findingId"`
	PatternKey   string              `json:"patternKey"`
	ScheduleID   string              `json:"scheduleId"`
	ScheduleName string              `json:"scheduleName"`
	Merchant     string              `json:"merchant"`
	Cadence      string              `json:"cadence"`
	AccountID    string              `json:"accountId"`
	Claimable    bool                `json:"claimable"`
	Reason       string              `json:"reason,omitempty"`
	Assignments  []PatternOccurrence `json:"assignments,omitempty"`
}

// PostingClaimUpdate sets one posting's occurrence claim. The schedule and date
// must name a real scheduled occurrence; validation rejects anything else.
type PostingClaimUpdate struct {
	PostingID string       `json:"postingId"`
	Claim     PostingClaim `json:"claim"`
}
