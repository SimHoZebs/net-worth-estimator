// Package judgment is the implementation-independent boundary for assessments
// of saved bank patterns. Providers may use rules, models, or human reviewers.
package judgment

import (
	"context"
	"errors"
	"os"
	"strings"
	"time"

	"github.com/simhozebs/net-worth-estimator/backend/internal/types"
)

var ErrUnavailable = errors.New("judgment unavailable")
var ErrPending = errors.New("judgment pending")

// FeedbackQuarantine is the minimum age of a user review before it may
// train the learner. Fresh reviews stay deliverable-but-held so a hasty
// correction, duplicate tap, or mislabeled row never becomes a weight
// before the owner has lived with it. Both the payment and the category
// feedback paths enforce the same bound; the store stays dumb and each
// FeedbackSource applies it at Page time.
const FeedbackQuarantine = 14 * 24 * time.Hour

// TrainingEnabled reports whether matured feedback may train the learner.
// ML_TRAINING=0 pauses all training delivery: every feedback source
// behaves as an immediately-complete empty source while the gate is off.
// The default (unset or any other value) trains. This gates learning;
// ML_CATEGORIES=0 separately forces keyword-only judging.
func TrainingEnabled() bool {
	return strings.TrimSpace(os.Getenv("ML_TRAINING")) != "0"
}

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
