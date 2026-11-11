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
	session, err := d.provider.Open(ctx, paymentFeedbackSource{scoped, owner})
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
}

func (s paymentFeedbackSource) Owner() string { return s.owner }
func (s paymentFeedbackSource) Page(after string, limit int) (judgment.FeedbackPage, error) {
	events, err := s.scoped.ListAnalysisFeedback(types.AnalysisFeedbackFilter{Cursor: after, Limit: limit})
	if err != nil {
		return judgment.FeedbackPage{}, err
	}
	page := judgment.FeedbackPage{Cursor: after, Feedback: []judgment.Feedback{}}
	for _, event := range events {
		page.Cursor = event.ID
		if event.AnalysisType != "payments" || (event.Request.Action != "confirm" && event.Request.Action != "reject") {
			continue
		}
		if event.Prediction.JudgmentInput == nil {
			return page, fmt.Errorf("payment feedback %s is missing its reviewed evidence", event.ID)
		}
		page.Feedback = append(page.Feedback, judgment.Feedback{EventID: event.ID, RunID: event.RunID, Action: event.Request.Action, Request: *event.Prediction.JudgmentInput})
	}
	return page, nil
}
