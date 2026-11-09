// Package judgment is the implementation-independent boundary for assessments
// of saved bank patterns. Providers may use rules, models, or human reviewers.
package judgment

import (
	"context"
	"errors"

	"github.com/simhozebs/net-worth-estimator/backend/internal/types"
)

var ErrUnavailable = errors.New("judgment unavailable")
var ErrPending = errors.New("judgment pending")

type Evaluator interface {
	Evaluate(context.Context, []types.AnalysisJudgmentInput) ([]types.AnalysisJudgment, error)
}

type Session interface {
	Evaluator
	// Revision is opaque and must change when decisions or provider policy change.
	Revision() string
}

type Provider interface {
	// Open owns provider preparation. Feedback is available, not mandatory:
	// non-learning implementations can ignore it without inventing training state.
	Open(context.Context, FeedbackSource) (Session, error)
}

type FeedbackSource interface {
	Owner() string
	Page(after string, limit int) (FeedbackPage, error)
}

type FeedbackPage struct {
	Cursor   string     `json:"cursor"`
	Feedback []Feedback `json:"feedback"`
}

type Feedback struct {
	EventID string                      `json:"eventId"`
	RunID   string                      `json:"runId"`
	Action  string                      `json:"action"`
	Request types.AnalysisJudgmentInput `json:"request"`
}
