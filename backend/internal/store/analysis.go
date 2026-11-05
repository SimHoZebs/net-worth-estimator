package store

import "github.com/simhozebs/net-worth-estimator/backend/internal/types"

// AnalysisStore owns evidence and derived results, never financial-model writes.
// Claim takes a consistent snapshot and a bounded durable lease atomically.
// New-rule creation previews and pattern-to-rule records are analysis-side:
// they never create, change, or remove financial rows.
type AnalysisStore interface {
	ClaimAnalysis(kind, version string) (types.AnalysisRun, types.AnalysisSnapshot, bool, error)
	CompleteAnalysis(run types.AnalysisRun, findings []types.AnalysisDetection, problem string) error
	ListAnalysisRuns() ([]types.AnalysisRun, int64, error)
	ListAnalysisFindings(filter types.AnalysisFindingFilter) ([]types.AnalysisFinding, error)
	DismissAnalysisFinding(id string, dismissed bool, actor string) error
	ReviewAnalysisFinding(id string, input types.AnalysisFeedbackInput) (types.AnalysisFeedback, error)
	ListAnalysisFeedback(filter types.AnalysisFeedbackFilter) ([]types.AnalysisFeedback, error)
	PreviewPatternToNewSchedule(findingID string) (types.PatternToNewSchedulePreview, error)
	FindPatternToNewSchedule(patternKey string) (types.PatternToNewSchedule, error)
	RecordPatternToNewSchedule(record types.PatternToNewSchedule) error
	RemovePatternToNewSchedule(patternKey, ruleID string) error
	PreviewPatternToExistingSchedule(findingID, ruleID string) (types.PatternToExistingSchedulePreview, error)
}

// BankObservation refreshes evidence for an already mapped bank transaction.
// Its exact keys resolve ownership. It never rewrites the financial posting.
type BankObservation struct {
	Keys  []BankKey
	Facts types.TransactionFacts
}
