package types

// PatternOccurrence is one recorded bank movement behind a confirmed
// recurring pattern. Dates are UTC calendar days derived from the movement
// time. Amount keeps the source decimal spelling. Both pattern flows share
// it: new-rule creation lists it as evidence, adding to an existing rule
// maps each one onto a scheduled occurrence.
type PatternOccurrence struct {
	PostingID string `json:"postingId"`
	Date      string `json:"date"`
	Amount    string `json:"amount"`
}

// ProposedNewRule is the forecast rule a confirmed pattern would create. It
// mirrors the ordinary recurrence-rule shape so approval saves exactly what
// the preview showed.
type ProposedNewRule struct {
	Name            string              `json:"name"`
	SourceAccountID *string             `json:"sourceAccountId,omitempty"`
	Destinations    []string            `json:"destinations,omitempty"`
	Amount          string              `json:"amount"`
	Frequency       RecurrenceFrequency `json:"frequency"`
	StartDate       IsoDate             `json:"startDate"`
	Enabled         bool                `json:"enabled"`
}

// UpcomingNewRuleOccurrence is one forecast movement the proposed rule would
// generate. All dates fall strictly after the recorded evidence, so
// approving never duplicates bank facts as forecast movements.
type UpcomingNewRuleOccurrence struct {
	Date   string `json:"date"`
	Amount string `json:"amount"`
}

// PatternToNewRulePreview describes the rule a confirmed recurring pattern
// would create plus the forecast movements behind it. Creatable is false
// with a plain-language reason when the pattern cannot become a rule yet.
type PatternToNewRulePreview struct {
	FindingID      string                      `json:"findingId"`
	PatternKey     string                      `json:"patternKey"`
	Merchant       string                      `json:"merchant"`
	Cadence        string                      `json:"cadence"`
	Occurrences    []PatternOccurrence         `json:"occurrences"`
	TypicalAmount  string                      `json:"typicalAmount"`
	Currency       string                      `json:"currency"`
	Direction      string                      `json:"direction"`
	AccountID      string                      `json:"accountId"`
	Creatable      bool                        `json:"creatable"`
	Reason         string                      `json:"reason"`
	Rule           *ProposedNewRule            `json:"rule,omitempty"`
	Upcoming       []UpcomingNewRuleOccurrence `json:"upcoming,omitempty"`
	ExistingRuleID string                      `json:"existingRuleId,omitempty"`
}

// PatternToNewRule records that one generated forecast rule came from one
// confirmed source pattern. It lives in the established analysis_promotions table.
// The pattern and its evidence stay untouched:
// disabling or deleting the rule never removes findings or feedback. The
// storage table keeps its established name.
type PatternToNewRule struct {
	PatternKey string `json:"patternKey"`
	RuleID     string `json:"ruleId"`
	CreatedAt  int64  `json:"createdAt"`
}
