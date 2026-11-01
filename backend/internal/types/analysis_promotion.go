package types

// RecurringPromotionOccurrence is one recorded bank movement behind a
// confirmed recurring pattern. Dates are UTC calendar days derived from the
// movement time. Amount keeps the source decimal spelling.
type RecurringPromotionOccurrence struct {
	PostingID string `json:"postingId"`
	Date      string `json:"date"`
	Amount    string `json:"amount"`
}

// ProposedRecurringRule is the forecast rule a confirmed pattern would
// create. It mirrors the ordinary recurrence-rule shape so approval saves
// exactly what the preview showed.
type ProposedRecurringRule struct {
	Name            string              `json:"name"`
	SourceAccountID *string             `json:"sourceAccountId,omitempty"`
	Destinations    []string            `json:"destinations,omitempty"`
	Amount          string              `json:"amount"`
	Frequency       RecurrenceFrequency `json:"frequency"`
	StartDate       IsoDate             `json:"startDate"`
	Enabled         bool                `json:"enabled"`
}

// UpcomingRecurringOccurrence is one forecast movement the proposed rule
// would generate. All dates fall strictly after the recorded evidence, so
// approving never duplicates bank facts as forecast movements.
type UpcomingRecurringOccurrence struct {
	Date   string `json:"date"`
	Amount string `json:"amount"`
}

// RecurringPromotionPreview describes the rule a confirmed recurring pattern
// would create plus the forecast movements behind it. Promotable is false
// with a plain-language reason when the pattern cannot become a rule yet.
type RecurringPromotionPreview struct {
	FindingID      string                         `json:"findingId"`
	PatternKey     string                         `json:"patternKey"`
	Merchant       string                         `json:"merchant"`
	Cadence        string                         `json:"cadence"`
	Occurrences    []RecurringPromotionOccurrence `json:"occurrences"`
	TypicalAmount  string                         `json:"typicalAmount"`
	Currency       string                         `json:"currency"`
	Direction      string                         `json:"direction"`
	AccountID      string                         `json:"accountId"`
	Promotable     bool                           `json:"promotable"`
	Reason         string                         `json:"reason"`
	Rule           *ProposedRecurringRule         `json:"rule,omitempty"`
	Upcoming       []UpcomingRecurringOccurrence  `json:"upcoming,omitempty"`
	ExistingRuleID string                         `json:"existingRuleId,omitempty"`
}

// RecurringPromotion records that one generated forecast rule came from one
// confirmed source pattern. The pattern and its evidence stay untouched:
// disabling or deleting the rule never removes findings or feedback.
type RecurringPromotion struct {
	PatternKey string `json:"patternKey"`
	RuleID     string `json:"ruleId"`
	CreatedAt  int64  `json:"createdAt"`
}
