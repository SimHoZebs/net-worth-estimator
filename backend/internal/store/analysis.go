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
	// AnalysisInputRevision reports the current input revision without loading
	// any findings, so Prepare can skip heavy loads on idle ticks.
	AnalysisInputRevision() (int64, error)
	DismissAnalysisFinding(id string, dismissed bool, actor string) error
	ReviewAnalysisFinding(id string, input types.AnalysisFeedbackInput) (types.AnalysisFeedback, error)
	ListAnalysisFeedback(filter types.AnalysisFeedbackFilter) ([]types.AnalysisFeedback, error)
	PreviewPatternToNewSchedule(findingID string) (types.PatternToNewSchedulePreview, error)
	// Pattern actions save acceptance and the finance change in one transaction.
	CreatePatternSchedule(findingID, patternKey, actor string, schedule types.Schedule) (types.Schedule, error)
	SetPatternTransactionClaims(findingID, actor string, claims []types.TransactionClaimUpdate) ([]types.Transaction, error)
	FindPatternToNewSchedule(patternKey string) (types.PatternToNewSchedule, error)
	RecordPatternToNewSchedule(record types.PatternToNewSchedule) error
	RemovePatternToNewSchedule(patternKey, ruleID string) error
	PreviewPatternToExistingSchedule(findingID, ruleID string) (types.PatternToExistingSchedulePreview, error)
	// ConfirmTransferPair wires one detector-ranked opposite-leg pair as a
	// single transfer: it validates both legs, replaces any active link
	// touching either leg, and records analysis feedback acceptance for the
	// finding in the same transaction. Confirming the same pair again
	// returns the same link. Same-sign pairs are out of scope and rejected.
	ConfirmTransferPair(findingID, peerTransactionID, actor string) (types.TransferLink, error)
	// RemoveTransferLinkByLeg deletes the active link touching one leg.
	// A leg with no active link reports ErrNotFound.
	RemoveTransferLinkByLeg(transactionID string) (types.TransferLink, error)
	// ListTransferLinks returns every active confirmed pair in leg order.
	ListTransferLinks() ([]types.TransferLink, error)
	// ListAnalysisDirtyFacts reports bank facts that changed after sinceRevision.
	// Rows are durable tombstones (including deletes) ordered by revision.
	// Consumers advance their per-stream consumed revision instead of deleting.
	ListAnalysisDirtyFacts(sinceRevision int64) ([]AnalysisDirtyFact, error)
	// ListAnalysisPaymentStreams returns every cached payment stream for the user.
	ListAnalysisPaymentStreams() ([]AnalysisPaymentStream, error)
	// GetAnalysisPaymentStream reads one cached payment stream by ID.
	GetAnalysisPaymentStream(streamID string) (AnalysisPaymentStream, error)
	// SaveAnalysisPaymentStream upserts one cached payment stream.
	SaveAnalysisPaymentStream(stream AnalysisPaymentStream) error
	// DeleteAnalysisPaymentStream removes one cached payment stream.
	DeleteAnalysisPaymentStream(streamID string) error
}

// AnalysisDirtyFact is one bank fact that changed at Revision. Kind names
// the change: added, facts-changed, amount-corrected, pending-flipped,
// void-flipped, or deleted (a tombstone surviving the row delete).
type AnalysisDirtyFact struct {
	TransactionID string
	Revision      int64
	Kind          string
}

// AnalysisPaymentStream is one durable payment-stream cache entry. StatsJSON
// is opaque stream statistics, MemberTransactionIDs names the member bank
// facts, ConsumedRevision is the analysis revision already incorporated, and
// IdentityVersion versions the stream identity logic. A version mismatch
// must mean full rebuild.
type AnalysisPaymentStream struct {
	StreamID             string
	StatsJSON            string
	MemberTransactionIDs []string
	ConsumedRevision     int64
	IdentityVersion      int64
}

// AnalysisPaymentPublish is the per-stream incremental publish payload for the
// payments analysis. Findings carries the full reconciled set (recomputed plus
// carried-forward); only RecomputedStreamIDs rows are reconciled or withdrawn,
// every other finding row stays untouched. UpsertStreams and DeleteStreamIDs
// refresh the durable stream cache; the publisher advances every cached
// consumed revision to the published run revision.
type AnalysisPaymentPublish struct {
	Findings            []types.AnalysisDetection
	RecomputedStreamIDs []string
	UpsertStreams       []AnalysisPaymentStream
	DeleteStreamIDs     []string
	Problem             string
}

// BankObservation refreshes evidence for an already mapped bank transaction.
// Its exact keys resolve ownership. It never rewrites the financial transaction.
type BankObservation struct {
	Keys  []BankKey
	Facts types.TransactionFacts
}
