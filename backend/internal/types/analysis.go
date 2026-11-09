package types

// TransactionFacts preserves bank evidence independently of editable model rows.
// Amount retains the source decimal spelling. Metadata contains only selected
// transaction fields, never credentials or an arbitrary provider response.
type TransactionFacts struct {
	Description string            `json:"description"`
	Payee       string            `json:"payee"`
	Memo        string            `json:"memo"`
	Amount      string            `json:"amount"`
	Currency    string            `json:"currency"`
	PostedTime  int64             `json:"postedTime"`
	OccurredAt  int64             `json:"occurredAt"`
	Metadata    map[string]string `json:"metadata"`
}

type AnalysisTransaction struct {
	TransactionID  string           `json:"transactionId"`
	AccountID      string           `json:"accountId"`
	SourceProvider string           `json:"sourceProvider"`
	Pending        bool             `json:"pending"`
	Void           bool             `json:"void"`
	Facts          TransactionFacts `json:"facts"`
}

type AnalysisSnapshot struct {
	Revision     int64
	UserID       string
	Transactions []AnalysisTransaction
}

type AnalysisEvidence struct {
	Code           string   `json:"code"`
	Reason         string   `json:"reason"`
	TransactionIDs []string `json:"transactionIds"`
}

type AnalysisDetection struct {
	TransactionID string                 `json:"transactionId"`
	Kind          string                 `json:"kind"`
	Provider      string                 `json:"provider"`
	Product       string                 `json:"product"`
	Role          string                 `json:"role"`
	Strength      string                 `json:"strength"`
	Evidence      []AnalysisEvidence     `json:"evidence"`
	JudgmentInput *AnalysisJudgmentInput `json:"judgmentInput,omitempty"`
	Judgment      *AnalysisJudgment      `json:"judgment,omitempty"`
	Income        *AnalysisIncomePattern `json:"income,omitempty"`
}

// AnalysisIncomePattern is the source-currency summary of one detected pattern.
// Display amounts remain separate from external assessment results.
type AnalysisIncomePattern struct {
	PatternID          string `json:"patternId"`
	Currency           string `json:"currency"`
	TypicalAmount      string `json:"typicalAmount"`
	AnnualizedEstimate string `json:"annualizedEstimate"`
}

type AnalysisRun struct {
	ID            string `json:"id"`
	Type          string `json:"type"`
	Version       string `json:"version"`
	InputRevision int64  `json:"inputRevision"`
	State         string `json:"state"`
	StartedAt     int64  `json:"startedAt"`
	CompletedAt   int64  `json:"completedAt"`
	Problem       string `json:"problem"`
}

type AnalysisFinding struct {
	AnalysisDetection
	ID               string          `json:"id"`
	AnalysisType     string          `json:"analysisType"`
	RunID            string          `json:"runId"`
	AnalyzerVersion  string          `json:"analyzerVersion"`
	InputRevision    int64           `json:"inputRevision"`
	FirstDetectedAt  int64           `json:"firstDetectedAt"`
	LastCheckedAt    int64           `json:"lastCheckedAt"`
	Status           string          `json:"status"`
	Stale            bool            `json:"stale"`
	Dismissed        bool            `json:"dismissed"`
	FeedbackRevision int64           `json:"feedbackRevision"`
	Review           *AnalysisReview `json:"review,omitempty"`
}

type AnalysisFindingFilter struct {
	TransactionIDs []string
	Cursor         string
	Limit          int
}
