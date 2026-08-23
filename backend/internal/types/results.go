package types

// Evaluation result types shared by deterministic and stochastic flows.

type EvaluationResultStatus string

const (
	StatusSatisfied     EvaluationResultStatus = "satisfied"
	StatusNotSatisfied  EvaluationResultStatus = "not-satisfied"
	StatusWarning       EvaluationResultStatus = "warning"
	StatusIndeterminate EvaluationResultStatus = "indeterminate"
)

type EvaluationDiagnostic struct {
	Code              string   `json:"code"`
	Severity          string   `json:"severity"` // info | warning | error
	Message           string   `json:"message"`
	Date              *IsoDate `json:"date,omitempty"`
	RelatedAccountIDs []string `json:"relatedAccountIds,omitempty"`
	RelatedPostingIDs []string `json:"relatedPostingIds,omitempty"`
}

type EvaluationResultEnvelope struct {
	InstanceID    string                 `json:"instanceId"`
	Label         string                 `json:"label"`
	Status        EvaluationResultStatus `json:"status"`
	Deterministic JsonValue              `json:"deterministic"`
	Probabilistic JsonValue              `json:"probabilistic"`
	Diagnostics   []EvaluationDiagnostic `json:"diagnostics"`
}

type EvaluationResultTables struct {
	FinancialIndependence []EvaluationResultEnvelope `json:"financialIndependence"`
	NetWorthThreshold     []EvaluationResultEnvelope `json:"netWorthThreshold"`
	PostingFulfillment    []EvaluationResultEnvelope `json:"postingFulfillment"`
}

type EvaluationResultCollection struct {
	Evaluations EvaluationResultTables `json:"evaluations"`
}

// Model validation diagnostics (types/validation.ts).

type ValidationSeverity string

const (
	SeverityError   ValidationSeverity = "error"
	SeverityWarning ValidationSeverity = "warning"
)

type ModelValidationIssue struct {
	Severity ValidationSeverity `json:"severity"`
	Code     string             `json:"code"`
	Message  string             `json:"message"`
	Path     []any              `json:"path"`
}
