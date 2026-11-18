package types

// ProposedNewSchedule is the forecast schedule a confirmed pattern would create. It
// is a constrained view of Schedule: the ordinary schedule shape with a
// single expression amount, so approval saves exactly what the preview
// showed. Use ProposedNewScheduleToSchedule for the one conversion.
type ProposedNewSchedule struct {
	Name            string    `json:"name"`
	SourceAccountID *string   `json:"sourceAccountId,omitempty"`
	Destinations    []string  `json:"destinations,omitempty"`
	Amount          string    `json:"amount"`
	Frequency       Frequency `json:"frequency"`
	StartDate       IsoDate   `json:"startDate"`
	Enabled         bool      `json:"enabled"`
}

// ProposedNewScheduleToSchedule converts a preview proposal into the
// ordinary schedule row approval saves. Amount becomes the single
// expression resolution; Enabled stays true.
func ProposedNewScheduleToSchedule(proposal ProposedNewSchedule, id string) Schedule {
	return Schedule{
		ID:              id,
		Name:            proposal.Name,
		SourceAccountID: proposal.SourceAccountID,
		Destinations:    append([]string(nil), proposal.Destinations...),
		Amount:          ExpressionAmountResolution(proposal.Amount),
		Frequency:       proposal.Frequency,
		StartDate:       proposal.StartDate,
		Enabled:         true,
	}
}

// PatternToNewSchedulePreview describes the schedule a confirmed recurring pattern
// would create plus the forecast movements behind it. Creatable is false
// with a plain-language reason when the pattern cannot become a schedule yet.
// Reason is present only when Creatable is false; Occurrences and Upcoming
// are always arrays, never null.
type PatternToNewSchedulePreview struct {
	PatternPreviewHeader
	TypicalAmount      string               `json:"typicalAmount"`
	Currency           string               `json:"currency"`
	Direction          string               `json:"direction"`
	Creatable          bool                 `json:"creatable"`
	Reason             string               `json:"reason,omitempty"`
	Occurrences        []PatternOccurrence  `json:"occurrences"`
	Schedule           *ProposedNewSchedule `json:"schedule,omitempty"`
	Upcoming           []PatternDatedAmount `json:"upcoming"`
	ExistingScheduleID string               `json:"existingScheduleId,omitempty"`
}

// PatternToNewSchedule records that one generated forecast schedule came from one
// confirmed source pattern. It lives in the established analysis_promotions table.
// The pattern and its evidence stay untouched:
// disabling or deleting the schedule never removes findings or feedback. The
// storage table keeps its established name.
type PatternToNewSchedule struct {
	PatternKey  string `json:"patternKey"`
	ScheduleID  string `json:"scheduleId"`
	CreatedAt   int64  `json:"createdAt"`
	MerchantKey string `json:"merchantKey"`
}
