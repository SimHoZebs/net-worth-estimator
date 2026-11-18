package types

// PatternToExistingSchedulePreview describes how one confirmed recurring pattern
// would claim occurrences of an existing schedule. Claimable is false with a
// plain-language reason when the pattern cannot be added yet. Reason is
// present only when Claimable is false; Assignments is always an array,
// never null.
type PatternToExistingSchedulePreview struct {
	PatternPreviewHeader
	ScheduleID   string              `json:"scheduleId"`
	ScheduleName string              `json:"scheduleName"`
	Claimable    bool                `json:"claimable"`
	Reason       string              `json:"reason,omitempty"`
	Assignments  []PatternOccurrence `json:"assignments"`
}

// TransactionClaimUpdate sets one transaction's occurrence claim. The schedule and date
// must name a real scheduled occurrence; validation rejects anything else.
type TransactionClaimUpdate struct {
	TransactionID string           `json:"transactionId"`
	Claim         TransactionClaim `json:"claim"`
}
