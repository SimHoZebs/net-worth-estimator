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
	Name          string                 `json:"name"`
	Status        EvaluationResultStatus `json:"status"`
	Deterministic JsonValue              `json:"deterministic"`
	Probabilistic JsonValue              `json:"probabilistic"`
	Diagnostics   []EvaluationDiagnostic `json:"diagnostics"`
}

type EvaluationResultTables struct {
	FinancialIndependence []EvaluationResultEnvelope `json:"financialIndependence"`
	NetWorthThreshold     []EvaluationResultEnvelope `json:"netWorthThreshold"`
	AccountBalance        []EvaluationResultEnvelope `json:"accountBalance"`
	PostingFulfillment    []EvaluationResultEnvelope `json:"postingFulfillment"`
	CycleFulfillment      []EvaluationResultEnvelope `json:"cycleFulfillment"`
	PlannedPurchases      []EvaluationResultEnvelope `json:"plannedPurchases,omitempty"`
}

type EvaluationResultCollection struct {
	Evaluations EvaluationResultTables `json:"evaluations"`
}

// ByType returns the result rows for an evaluation type, or nil when the
// type names no result table.
func (t *EvaluationResultTables) ByType(evaluationType string) *[]EvaluationResultEnvelope {
	for _, table := range t.Tables() {
		if table.Type == evaluationType {
			return table.Rows
		}
	}
	return nil
}

// Model validation diagnostics.

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
