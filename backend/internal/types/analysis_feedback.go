package types

// AnalysisDuration records the user's total plan term, not a repayment count
// or a remaining balance. It never supplies a simulation schedule.
type AnalysisDuration struct {
	Count int    `json:"count" minimum:"1" maximum:"5200"`
	Unit  string `json:"unit" enum:"weeks,months"`
}

type AnalysisReview struct {
	Decision   string            `json:"decision"`
	Provider   string            `json:"provider"`
	Duration   *AnalysisDuration `json:"duration,omitempty"`
	AnsweredAt int64             `json:"answeredAt"`
}

type AnalysisFeedbackInput struct {
	RequestID string            `json:"requestId" minLength:"36" maxLength:"36"`
	RunID     string            `json:"runId" minLength:"36" maxLength:"36"`
	Revision  int64             `json:"revision" minimum:"0"`
	Action    string            `json:"action" enum:"confirm,reject,set-duration,hide,restore"`
	Duration  *AnalysisDuration `json:"duration,omitempty"`
	// Actor comes from the verified request context, never the request body.
	Actor string `json:"-"`
}

// AnalysisFeedback is an immutable labeled example tied to the prediction the
// user reviewed. Hide/restore events are not positive or negative labels.
type AnalysisFeedback struct {
	ID              string                `json:"id"`
	FindingID       string                `json:"findingId"`
	PostingID       string                `json:"postingId"`
	AnalysisType    string                `json:"analysisType"`
	RunID           string                `json:"runId"`
	AnalyzerVersion string                `json:"analyzerVersion"`
	InputRevision   int64                 `json:"inputRevision"`
	CreatedAt       int64                 `json:"createdAt"`
	Actor           string                `json:"actor"`
	Request         AnalysisFeedbackInput `json:"request"`
	Prediction      AnalysisDetection     `json:"prediction"`
	Review          *AnalysisReview       `json:"review,omitempty"`
	Dismissed       bool                  `json:"dismissed"`
	Revision        int64                 `json:"revision"`
}

type AnalysisFeedbackFilter struct {
	FindingID string
	Cursor    string
	Limit     int
}
