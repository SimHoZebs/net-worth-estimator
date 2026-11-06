package types

// PatternOccurrence is one recorded bank movement behind a confirmed
// recurring pattern. Dates are UTC calendar days derived from the movement
// time. Amount keeps the source decimal spelling. Both pattern flows share
// it: new-schedule creation lists it as evidence, adding to an existing schedule
// maps each one onto a scheduled occurrence.
type PatternOccurrence struct {
	TransactionID string `json:"transactionId"`
	Date          string `json:"date"`
	Amount        string `json:"amount"`
}

// ProposedNewSchedule is the forecast schedule a confirmed pattern would create. It
// mirrors the ordinary schedule shape so approval saves exactly what
// the preview showed.
type ProposedNewSchedule struct {
	Name            string    `json:"name"`
	SourceAccountID *string   `json:"sourceAccountId,omitempty"`
	Destinations    []string  `json:"destinations,omitempty"`
	Amount          string    `json:"amount"`
	Frequency       Frequency `json:"frequency"`
	StartDate       IsoDate   `json:"startDate"`
	Enabled         bool      `json:"enabled"`
}

// UpcomingNewScheduleOccurrence is one forecast movement the proposed schedule would
// generate. All dates fall strictly after the recorded evidence, so
// approving never duplicates bank facts as forecast movements.
type UpcomingNewScheduleOccurrence struct {
	Date   string `json:"date"`
	Amount string `json:"amount"`
}

// PatternToNewSchedulePreview describes the schedule a confirmed recurring pattern
// would create plus the forecast movements behind it. Creatable is false
// with a plain-language reason when the pattern cannot become a schedule yet.
type PatternToNewSchedulePreview struct {
	FindingID          string                          `json:"findingId"`
	PatternKey         string                          `json:"patternKey"`
	Merchant           string                          `json:"merchant"`
	Cadence            string                          `json:"cadence"`
	Occurrences        []PatternOccurrence             `json:"occurrences"`
	TypicalAmount      string                          `json:"typicalAmount"`
	Currency           string                          `json:"currency"`
	Direction          string                          `json:"direction"`
	AccountID          string                          `json:"accountId"`
	Creatable          bool                            `json:"creatable"`
	Reason             string                          `json:"reason"`
	Schedule           *ProposedNewSchedule            `json:"schedule,omitempty"`
	Upcoming           []UpcomingNewScheduleOccurrence `json:"upcoming,omitempty"`
	ExistingScheduleID string                          `json:"existingScheduleId,omitempty"`
}

// PatternToNewSchedule records that one generated forecast schedule came from one
// confirmed source pattern. It lives in the established analysis_promotions table.
// The pattern and its evidence stay untouched:
// disabling or deleting the schedule never removes findings or feedback. The
// storage table keeps its established name.
type PatternToNewSchedule struct {
	PatternKey string `json:"patternKey"`
	ScheduleID string `json:"scheduleId"`
	CreatedAt  int64  `json:"createdAt"`
}
