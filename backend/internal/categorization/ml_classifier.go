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
type MLClassifier struct {
	provider judgment.Provider
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
	session, err := m.provider.Open(ctx, categoryFeedbackSource{})
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

// CompositeClassifier prefers the learner and fills the gaps it leaves with
// the deterministic keyword classifier. The version names the composition;
// each stored assignment still records the producer that made it.
type CompositeClassifier struct {
	ML      *MLClassifier
	Keyword KeywordClassifier
}

// Version identifies the classifier composition in stored assignments.
func (c CompositeClassifier) Version() string { return "composite/ml-categories-v1+keyword-v1" }

// Classify tries the learner first and backfills skipped transactions with
// keywords. A learner error falls back to keywords for the whole batch.
func (c CompositeClassifier) Classify(ctx context.Context, inputs []Input) (map[string]Classified, error) {
	if c.ML != nil {
		if results, err := c.ML.Classify(ctx, inputs); err == nil {
			remaining := make([]Input, 0, len(inputs))
			for _, input := range inputs {
				if _, ok := results[input.TransactionID]; !ok {
					remaining = append(remaining, input)
				}
			}
			if len(remaining) == 0 {
				return results, nil
			}
			backfill, err := c.Keyword.Classify(ctx, remaining)
			if err != nil {
				return nil, err
			}
			for transactionID, classified := range backfill {
				results[transactionID] = classified
			}
			return results, nil
		}
	}
	return c.Keyword.Classify(ctx, inputs)
}
