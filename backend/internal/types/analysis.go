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
	Pending     bool              `json:"pending"`
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

// AnalysisAccount is the account-level evidence attached to one bridge
// account that owns analyzed transactions. It carries only signals used to
// decide whether an account-kind suggestion is worth surfacing. The declared
// kind stays authoritative; analysis never writes it.
type AnalysisAccount struct {
	// AccountID is the bridge account ID that also appears on the account's
	// analyzed transactions.
	AccountID string `json:"accountId"`
	// LinkedID is the model account ID from the account link. It is the ID the
	// owner sees in the account editor and empty when the bridge account has
	// no surviving link.
	LinkedID string `json:"linkedId,omitempty"`
	Name     string `json:"name"`
	// Institution is the bridge organization name, a name signal only.
	Institution string `json:"institution"`
	// Kind is the declared account kind, read from the saved model.
	Kind string `json:"kind"`
	// ExtraType is the bridge's own account type hint. It is a source-supplied
	// type, not a name, and never overrides the declared kind.
	ExtraType string `json:"extraType"`
	// DebtLike reports debt-like balance behavior observed from bank balance
	// evidence. It is a non-name signal.
	DebtLike bool `json:"debtLike"`
}

type AnalysisSnapshot struct {
	Revision     int64
	UserID       string
	Transactions []AnalysisTransaction
	Accounts     []AnalysisAccount
}

type AnalysisEvidence struct {
	Code           string   `json:"code"`
	Reason         string   `json:"reason"`
	TransactionIDs []string `json:"transactionIds"`
}

type AnalysisDetection struct {
	StreamID      string `json:"streamId,omitempty"`
	TransactionID string `json:"transactionId"`
	// AccountID is optional. Transaction findings leave it empty. Account-kind
	// suggestions carry the linked model account ID so the existing findings
	// read can expose the linkage without a second endpoint.
	AccountID     string                  `json:"accountId,omitempty"`
	Kind          string                  `json:"kind"`
	Provider      string                  `json:"provider"`
	Product       string                  `json:"product"`
	Role          string                  `json:"role"`
	Strength      string                  `json:"strength"`
	Evidence      []AnalysisEvidence      `json:"evidence"`
	JudgmentInput *AnalysisJudgmentInput  `json:"judgmentInput,omitempty"`
	Judgment      *AnalysisJudgment       `json:"judgment,omitempty"`
	Pattern       *AnalysisPaymentPattern `json:"pattern,omitempty"`
}

// AnalysisPaymentPattern is the source-currency summary of one detected pattern.
// Display amounts remain separate from external assessment results.
// AnnualizedEstimate is internal-only ranking input; json:"-" keeps it off the wire.
type AnalysisPaymentPattern struct {
	PatternID          string `json:"patternId"`
	Currency           string `json:"currency"`
	TypicalAmount      string `json:"typicalAmount"`
	AnnualizedEstimate string `json:"-"`
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
	// AccountIDs selects findings whose optional accountId matches. It exists
	// for account-scoped findings such as card-kind and leaves transaction
	// findings untouched.
	AccountIDs []string
	Cursor     string
	Limit      int
}

// TransferLink is one user-confirmed transfer pair: two settled bank
// transactions the detector ranked as opposite legs of one internal money
// movement, wired by explicit review to render count-once. LegA and LegB
// are the two transaction IDs in lexicographic order. The link names the
// finding that proposed the pair and the verified actor who confirmed it.
type TransferLink struct {
	LegA      string `json:"legA"`
	LegB      string `json:"legB"`
	FindingID string `json:"findingId"`
	Actor     string `json:"actor"`
	CreatedAt int64  `json:"createdAt"`
}
