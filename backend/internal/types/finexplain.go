package types

// Data-sufficiency and recommendation explainability (FIN-05). This layer
// wraps a FinancialHealthReport (FIN-03) with the evidence quality behind
// it: where each balance came from, how fresh it is, what the flow window
// covered, and which records are missing. It never recomputes verdicts and
// never claims complete fitness from incomplete records: partial coverage
// reads as incomplete, never as failure.

// FinancialHealthCompleteness grades the evidence behind a health report,
// not the finances themselves.
type FinancialHealthCompleteness string

const (
	// FinancialHealthComplete means every enabled account has a balance
	// observation at or before the cut, no check reports insufficient
	// data, every carried debt balance has payment terms, and no account
	// observation is stale. Only then may a consumer present an overall
	// passing assessment.
	FinancialHealthComplete FinancialHealthCompleteness = "complete"
	// FinancialHealthIncomplete means the report is usable but limited:
	// some records are missing, stale, or unresolvable. Consumers must
	// present this as incomplete, never as failure.
	FinancialHealthIncomplete FinancialHealthCompleteness = "incomplete"
	// FinancialHealthInsufficient means there is no usable saved state at
	// the as-of cut, so no assessment is possible at all.
	FinancialHealthInsufficient FinancialHealthCompleteness = "insufficient"
)

// Financial-health explanation origin values for one account balance.
const (
	FinancialHealthOriginManual = "manual"
	FinancialHealthOriginSync   = "sync"
	FinancialHealthOriginNone   = "none"
)

// FinancialHealthAccountSource reports where one enabled account's balance
// came from and how fresh it is. Origin is "manual" for owner-authored
// observations, "sync" for bank-reported ones, and "none" when the account
// has no observation at or before the cut. Source echoes the raw author
// name and is empty when Origin is "none".
type FinancialHealthAccountSource struct {
	AccountID      string      `json:"accountId"`
	AccountName    string      `json:"accountName"`
	Kind           AccountKind `json:"kind"`
	Origin         string      `json:"origin"`
	Source         string      `json:"source"`
	LastObservedAt *int64      `json:"lastObservedAt,omitempty"`
	AgeDays        *float64    `json:"ageDays,omitempty"`
	Stale          bool        `json:"stale"`
}

// FinancialHealthFreshness summarizes observation recency at the cut.
// Ages are cut-relative days; nil when no enabled account has an
// observation in range. StaleAfterDays echoes the applied recency
// guideline so presentation can show it as a configured value.
type FinancialHealthFreshness struct {
	AsOfDate                 IsoDate  `json:"asOfDate"`
	StaleAfterDays           int      `json:"staleAfterDays"`
	NewestObservationAgeDays *float64 `json:"newestObservationAgeDays,omitempty"`
	OldestObservationAgeDays *float64 `json:"oldestObservationAgeDays,omitempty"`
	StaleAccountIDs          []string `json:"staleAccountIds"`
	UnobservedAccountIDs     []string `json:"unobservedAccountIds"`
}

// FinancialHealthCoverage summarizes what the flow window could use.
// UnknownLiabilityAccountIDs names enabled debt accounts with a carried
// balance (or an unconfirmed balance) and no payment terms, so their
// required minimums cannot be computed. Paid-off debt needs no terms.
// window flow postings by raw author name, with owner rows (including the
// empty author used before authorship is assigned) grouped as "manual".
type FinancialHealthCoverage struct {
	WindowPostings             int            `json:"windowPostings"`
	ResolvedPostings           int            `json:"resolvedPostings"`
	ExcludedPostings           int            `json:"excludedPostings"`
	ExcludedIDs                []string       `json:"excludedIds"`
	MissingIncome              bool           `json:"missingIncome"`
	MissingOutflow             bool           `json:"missingOutflow"`
	UnknownLiabilityAccountIDs []string       `json:"unknownLiabilityAccountIds"`
	FlowSources                map[string]int `json:"flowSources"`
}

// FinancialHealthDataSufficiency is the FIN-05 evidence-quality report:
// per-account sources, cut-relative freshness, and window coverage.
type FinancialHealthDataSufficiency struct {
	Completeness FinancialHealthCompleteness    `json:"completeness"`
	Sources      []FinancialHealthAccountSource `json:"sources"`
	Freshness    FinancialHealthFreshness       `json:"freshness"`
	Coverage     FinancialHealthCoverage        `json:"coverage"`
}

// FinancialHealthProposedAction is one next step tied to its evidence and
// to the user-configurable targets it moves. CheckIDs names the health
// checks behind the action; Evidence carries the inspectable facts;
// Targets echoes the applied guideline values (thresholds, lookback
// window, recency limit) the user can change.
type FinancialHealthProposedAction struct {
	ID       string                        `json:"id"`
	Title    string                        `json:"title"`
	Detail   string                        `json:"detail"`
	CheckIDs []string                      `json:"checkIds"`
	Evidence []FinancialHealthEvidenceItem `json:"evidence"`
	Targets  map[string]float64            `json:"targets"`
}

// FinancialHealthExplanation wraps a FIN-03 report with its sufficiency
// grade and the actions its evidence supports. Summary describes the
// overall state in plain language and must state incompleteness whenever
// Completeness is not complete.
type FinancialHealthExplanation struct {
	AsOfDate     IsoDate                         `json:"asOfDate"`
	Completeness FinancialHealthCompleteness     `json:"completeness"`
	Summary      string                          `json:"summary"`
	Sufficiency  FinancialHealthDataSufficiency  `json:"sufficiency"`
	Actions      []FinancialHealthProposedAction `json:"actions"`
}

// FinancialHealthExplanationOptions carries the user-configurable inputs
// behind an explanation beyond the health standards echoed by the report:
// the recency limit that marks an observation stale.
type FinancialHealthExplanationOptions struct {
	// StaleAfterDays marks an account observation stale when it is older
	// than this many days at the cut. Values below 1 normalize to the
	// default.
	StaleAfterDays int `json:"staleAfterDays"`
}

// DefaultFinancialHealthExplanationOptions returns the adjustable starting
// points for an explanation. Like the health standards, these are
// configured guidelines, not universal requirements.
func DefaultFinancialHealthExplanationOptions() FinancialHealthExplanationOptions {
	return FinancialHealthExplanationOptions{StaleAfterDays: 14}
}
