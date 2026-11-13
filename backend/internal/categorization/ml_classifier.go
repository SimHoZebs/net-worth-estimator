package categorization

import (
	"context"

	"github.com/simhozebs/net-worth-estimator/backend/internal/judgment"
	"github.com/simhozebs/net-worth-estimator/backend/internal/types"
)

// categoryFeedbackSource opens judgment sessions without training feedback. The
// v1 category learner is evaluation-only: user overrides never travel back as
// training events, so every page is immediately complete.
type categoryFeedbackSource struct{}

func (categoryFeedbackSource) Owner() string { return "categorization" }

func (categoryFeedbackSource) Page(after string, limit int) (judgment.FeedbackPage, error) {
	return judgment.FeedbackPage{Cursor: after}, nil
}

// MLClassifier judges category hypotheses through a judgment provider. It
// returns an entry only for a ready, strong, supported judgment; anything
// else leaves the transaction uncategorized for the keyword fallback.
//
// Feedback is an optional journal-backed training source, set per tick by
// the worker from the scoped store. Nil keeps the original behavior: the
// session opens with an immediately-complete empty source and user labels
// never train.
type MLClassifier struct {
	provider judgment.Provider
	Feedback judgment.FeedbackSource
}

// SetFeedbackSource replaces the training source for subsequent Classify
// calls. The worker owns the classifier and calls Classify
// single-threaded, so per-tick replacement is safe.
func (m *MLClassifier) SetFeedbackSource(source judgment.FeedbackSource) {
	m.Feedback = source
}

// FeedbackSetter is the per-tick training-source wiring. Both the learner
// and the keyword-first composite satisfy it; keyword-only compositions
// simply do not implement it and never train.
type FeedbackSetter interface {
	SetFeedbackSource(judgment.FeedbackSource)
}

// NewMLClassifier composes the learner-backed classifier over a provider.
func NewMLClassifier(provider judgment.Provider) *MLClassifier {
	return &MLClassifier{provider: provider}
}

// Version identifies the classifier composition in stored assignments.
func (m *MLClassifier) Version() string { return "ml-categories-v1" }

type pendingCategoryRequest struct {
	transactionID string
	category      string
}

// Classify judges every direction-eligible category hypothesis for the batch.
// A provider error fails the whole call so the caller can fall back.
func (m *MLClassifier) Classify(ctx context.Context, inputs []Input) (map[string]Classified, error) {
	byRequest := map[string]pendingCategoryRequest{}
	var batch []types.AnalysisJudgmentInput
	for _, input := range inputs {
		if err := ctx.Err(); err != nil {
			return nil, err
		}
		for _, request := range CategoryJudgmentRequests(input) {
			byRequest[request.ID] = pendingCategoryRequest{transactionID: input.TransactionID, category: request.Kind[len("category:"):]}
			batch = append(batch, request)
		}
	}
	if len(batch) == 0 {
		return map[string]Classified{}, nil
	}
	source := m.Feedback
	if source == nil {
		source = categoryFeedbackSource{}
	}
	session, err := m.provider.Open(ctx, source)
	if err != nil {
		return nil, err
	}
	supported := map[string]map[string]bool{}
	for start := 0; start < len(batch); start += 100 {
		if err := ctx.Err(); err != nil {
			return nil, err
		}
		end := min(start+100, len(batch))
		judgments, err := session.Evaluate(ctx, batch[start:end])
		if err != nil {
			return nil, err
		}
		for _, item := range judgments {
			pending, ok := byRequest[item.RequestID]
			if !ok {
				continue
			}
			if item.Status != "ready" || item.Decision != "supported" || item.Strength != "strong" {
				continue
			}
			if supported[pending.transactionID] == nil {
				supported[pending.transactionID] = map[string]bool{}
			}
			supported[pending.transactionID][pending.category] = true
		}
	}
	results := map[string]Classified{}
	for transactionID, kinds := range supported {
		for _, key := range types.CategoryKeys {
			if kinds[key] {
				results[transactionID] = Classified{Category: key, Producer: m.Version()}
				break
			}
		}
	}
	return results, nil
}

// CompositeClassifier runs the deterministic keyword classifier first and
// backfills only what keywords skip with the learner. Keyword-first is
// deliberate: the learner may only add labels, never replace a keyword
// answer, so a confident-but-wrong model judgment cannot flip a correct
// keyword assignment. The version names the composition; each stored
// assignment still records the producer that made it.
type CompositeClassifier struct {
	ML      *MLClassifier
	Keyword KeywordClassifier
}

// Version identifies the classifier composition in stored assignments.
func (c CompositeClassifier) Version() string { return "composite/ml-categories-v1+keyword-v1" }

// SetFeedbackSource wires the training source into the learner half. A nil
// learner keeps keyword-only behavior: there is nothing to train.
func (c CompositeClassifier) SetFeedbackSource(source judgment.FeedbackSource) {
	if c.ML != nil {
		c.ML.SetFeedbackSource(source)
	}
}

// Classify fills keyword answers first, then judges the skipped
// transactions with the learner. A learner error keeps the keyword answers
// and leaves the rest uncategorized instead of failing the batch.
func (c CompositeClassifier) Classify(ctx context.Context, inputs []Input) (map[string]Classified, error) {
	results, err := c.Keyword.Classify(ctx, inputs)
	if err != nil {
		return nil, err
	}
	if c.ML == nil {
		return results, nil
	}
	remaining := make([]Input, 0, len(inputs))
	for _, input := range inputs {
		if _, ok := results[input.TransactionID]; !ok {
			remaining = append(remaining, input)
		}
	}
	if len(remaining) == 0 {
		return results, nil
	}
	backfill, err := c.ML.Classify(ctx, remaining)
	if err != nil {
		return results, nil
	}
	for transactionID, classified := range backfill {
		results[transactionID] = classified
	}
	return results, nil
}
