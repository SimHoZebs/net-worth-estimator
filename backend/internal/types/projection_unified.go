package types

// Unified projection wire types. Source decides fact versus output.
// Facts use user or banksync. Engine output uses projected.
// Stored rows predate this enum and use simplefin for bank facts.
// Readers treat simplefin as a bank fact until the one-time migration
// renames it to banksync. New writes use banksync only.

const (
	TransactionSourceUser      = "user"
	TransactionSourceBankSync  = "banksync"
	TransactionSourceProjected = "projected"
	// TransactionSourceSimpleFIN is the legacy bank spelling in stored rows.
	TransactionSourceSimpleFIN = "simplefin"
)

// IsBankFactSource reports whether a stored source means a bank fact.
func IsBankFactSource(source string) bool {
	return source == TransactionSourceBankSync || source == TransactionSourceSimpleFIN
}

// IsFactSource reports whether a stored source means a historical fact.
func IsFactSource(source string) bool {
	return source == TransactionSourceUser || IsBankFactSource(source)
}

// ProviderConnection tracks one bank bridge connection per scope.
type ProviderConnection struct {
	ID           string `json:"id"`
	ProviderKey  string `json:"providerKey"`
	Status       string `json:"status"`
	SyncCursor   string `json:"syncCursor"`
	LastSyncedAt string `json:"lastSyncedAt"`
}

// ProjectionState owns one scope projection build.
type ProjectionState struct {
	ID                string `json:"id"`
	ScopeID           string `json:"scopeId"`
	Revision          int64  `json:"revision"`
	PublishedRevision int64  `json:"publishedRevision"`
	DirtyFrom         string `json:"dirtyFrom"`
	ProjectionStart   string `json:"projectionStart"`
	HorizonEnd        string `json:"horizonEnd"`
	CalendarTimezone  string `json:"calendarTimezone"`
	EngineVersion     string `json:"engineVersion"`
	TrialCount        int    `json:"trialCount"`
	StochasticSeed    *int64 `json:"stochasticSeed,omitempty"`
}

// ProjectionSlice is one contiguous date range in a state build.
type ProjectionSlice struct {
	ID                string `json:"id"`
	ProjectionStateID string `json:"projectionStateId"`
	FromAt            string `json:"fromAt"`
	ToAt              string `json:"toAt"`
	BuiltRevision     int64  `json:"builtRevision"`
	Status            string `json:"status"`
}

// MonteCarloStatistic is one per account per instant band summary.
type MonteCarloStatistic struct {
	ID                   string  `json:"id"`
	ProjectionSliceID    string  `json:"projectionSliceId"`
	AccountID            string  `json:"accountId"`
	AsOfAt               string  `json:"asOfAt"`
	SampleCount          int     `json:"sampleCount"`
	Mean                 float64 `json:"mean"`
	Median               float64 `json:"median"`
	P10                  float64 `json:"p10"`
	P90                  float64 `json:"p90"`
	StdDev               float64 `json:"stdDev"`
	ProbabilityBelowZero float64 `json:"probabilityBelowZero"`
}

// UnifiedProjectionDefaults owns assumed defaults for fresh states.
func UnifiedProjectionDefaults() ProjectionState {
	return ProjectionState{
		CalendarTimezone: "UTC",
		EngineVersion:    "v1",
		TrialCount:       1000,
	}
}
