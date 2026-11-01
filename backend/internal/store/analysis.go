package store

import "github.com/simhozebs/net-worth-estimator/backend/internal/types"

// AnalysisStore owns evidence and derived results, never financial-model writes.
// Claim takes a consistent snapshot and a bounded durable lease atomically.
// Promotion previews and pattern-to-rule links are analysis-side records:
// they never create, change, or remove financial rows.
type AnalysisStore interface {
	ClaimAnalysis(kind, version string) (types.AnalysisRun, types.AnalysisSnapshot, bool, error)
	CompleteAnalysis(run types.AnalysisRun, findings []types.AnalysisDetection, problem string) error
	ListAnalysisRuns() ([]types.AnalysisRun, int64, error)
	ListAnalysisFindings(filter types.AnalysisFindingFilter) ([]types.AnalysisFinding, error)
	DismissAnalysisFinding(id string, dismissed bool, actor string) error
	ReviewAnalysisFinding(id string, input types.AnalysisFeedbackInput) (types.AnalysisFeedback, error)
	ListAnalysisFeedback(filter types.AnalysisFeedbackFilter) ([]types.AnalysisFeedback, error)
	PreviewRecurringPromotion(findingID string) (types.RecurringPromotionPreview, error)
	FindRecurringPromotion(patternKey string) (types.RecurringPromotion, error)
	RecordRecurringPromotion(link types.RecurringPromotion) error
	RemoveRecurringPromotion(patternKey, ruleID string) error
}

// BankObservation refreshes evidence for an already mapped bank transaction.
// Its exact keys resolve ownership. It never rewrites the financial posting.
type BankObservation struct {
	Keys  []BankKey
	Facts types.TransactionFacts
}
