package analysis

import (
	"context"
	"fmt"
	"os"
	"strings"
	"time"

	"github.com/simhozebs/net-worth-estimator/backend/internal/judgment"
	"github.com/simhozebs/net-worth-estimator/backend/internal/store"
	"github.com/simhozebs/net-worth-estimator/backend/internal/types"
)

// NewPaymentPatterns is the composition seam. The feature knows only Provider and the
// domain evidence/decision contract; no algorithm or training API is selected here.
func NewPaymentPatterns(provider judgment.Provider) Definition {
	if provider == nil {
		return PaymentPatterns{}
	}
	return paymentProviderDefinition{provider: provider}
}

// WithProviders attaches a lazy provider catalog while keeping the prepared
// judgment provider. It shadows the embedded PaymentPatterns method so the
// composition keeps its session instead of degrading to a bare value.
func (d paymentProviderDefinition) WithProviders(r ProviderResolver) Definition {
	d.Providers = r
	return d
}

func defaultPaymentPatterns() Definition {
	endpoint := strings.TrimSpace(os.Getenv("ML_JUDGMENT_URL"))
	if endpoint == "" {
		return NewPaymentPatterns(nil)
	}
	return NewPaymentPatterns(judgment.NewHTTPProvider(endpoint, 5*time.Second))
}

type paymentProviderDefinition struct {
	PaymentPatterns
	provider judgment.Provider
}

func (d paymentProviderDefinition) Prepare(ctx context.Context, scoped store.AnalysisStore, owner string) (Definition, error) {
	session, err := d.provider.Open(ctx, paymentFeedbackSource{scoped: scoped, owner: owner, now: time.Now})
	var base PaymentPatterns
	if err != nil || session == nil {
		if ctx.Err() != nil {
			return nil, ctx.Err()
		}
		base = PaymentPatterns{Classifications: d.Classifications, Providers: d.Providers, version: d.PaymentPatterns.Version() + "/unavailable", preparationErr: judgment.ErrUnavailable}
	} else {
		if session.Revision() == "" {
			return nil, fmt.Errorf("judgment provider returned an empty revision")
		}
		base = PaymentPatterns{Classifications: d.Classifications, Providers: d.Providers, Judge: session, version: d.PaymentPatterns.Version() + "/" + session.Revision()}
	}
	// Idle ticks skip the heavy prior-findings load: when the cached streams
	// already consumed the current input revision, the base definition runs
	// and ClaimAnalysis declines, without dirty, cache, or prior loads.
	if incrementalCacheCurrent(scoped) {
		return base, nil
	}
	// Incremental state rides along when available; otherwise the resolved
	// base still runs full recompute.
	if dirty, cached, prior, ok := prepareIncremental(scoped); ok {
		return &paymentIncrementalDefinition{base: base, scoped: scoped, owner: owner, dirty: dirty, cached: cached, prior: prior, forceRebuild: paymentsAnalyzerVersionChanged(scoped, base)}, nil
	}
	return base, nil
}

type paymentFeedbackSource struct {
	scoped store.AnalysisStore
	owner  string
	now    func() time.Time
}

func (s paymentFeedbackSource) Owner() string { return s.owner }

// Page delivers reviewed payments answers as training feedback. Fresh
// answers wait out the shared feedback quarantine: the page holds its
// cursor behind them instead of training on day-zero reviews. When several
// reviews name the same judgment request, only the newest trains; payment
// answers are single-shot immutable, so that rule is a safeguard, not a
// behavior change. Reviews of other analysis types, hides, and restores
// are never labels: the cursor advances past them exactly like before.
// While ML_TRAINING=0 the page is an immediately-complete empty source.
func (s paymentFeedbackSource) Page(after string, limit int) (judgment.FeedbackPage, error) {
	page := judgment.FeedbackPage{Cursor: after, Feedback: []judgment.Feedback{}}
	if !judgment.TrainingEnabled() {
		return page, nil
	}
	if limit <= 0 {
		limit = 200
	}
	// Latest-wins needs the tail past the page, so collect everything
	// after the cursor first. Review volume is small; chunk the read.
	var events []types.AnalysisFeedback
	cursor := after
	for {
		batch, err := s.scoped.ListAnalysisFeedback(types.AnalysisFeedbackFilter{Cursor: cursor, Limit: 200})
		if err != nil {
			return judgment.FeedbackPage{}, err
		}
		events = append(events, batch...)
		if len(batch) < 200 {
			break
		}
		cursor = batch[len(batch)-1].ID
	}
	now := time.Now()
	if s.now != nil {
		now = s.now()
	}
	cutoff := now.Add(-judgment.FeedbackQuarantine).Unix()
	for _, event := range events {
		if event.AnalysisType != "payments" || (event.Request.Action != "confirm" && event.Request.Action != "reject") {
			page.Cursor = event.ID
			continue
		}
		if event.Prediction.JudgmentInput == nil {
			return page, fmt.Errorf("payment feedback %s is missing its reviewed evidence", event.ID)
		}
	}
	latest := map[string]string{}
	for _, event := range events {
		if event.AnalysisType != "payments" || (event.Request.Action != "confirm" && event.Request.Action != "reject") {
			continue
		}
		key := event.Prediction.JudgmentInput.ID
		if event.ID > latest[key] {
			latest[key] = event.ID
		}
	}
	for _, event := range events {
		if event.AnalysisType != "payments" || (event.Request.Action != "confirm" && event.Request.Action != "reject") {
			continue
		}
		if event.ID != latest[event.Prediction.JudgmentInput.ID] {
			// Superseded by a newer review of the same request.
			page.Cursor = event.ID
			continue
		}
		if event.CreatedAt > cutoff {
			// Fresh answers hold here: event IDs and creation times
			// both grow at review time, so everything after this is
			// fresh too and the cursor must stay behind it.
			break
		}
		page.Feedback = append(page.Feedback, judgment.Feedback{EventID: event.ID, RunID: event.RunID, Action: event.Request.Action, Request: *event.Prediction.JudgmentInput})
		page.Cursor = event.ID
		if len(page.Feedback) >= limit {
			break
		}
	}
	return page, nil
}
