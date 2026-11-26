package categorization

import (
	"context"

	"github.com/simhozebs/net-worth-estimator/backend/internal/judgment"
	"github.com/simhozebs/net-worth-estimator/backend/internal/types"
)

// MLClassifier judges category hypotheses through a judgment provider. It
// returns an assigned outcome only for a ready, strong, supported judgment;
// no-request, uncertain, and unsupported inputs are terminal evaluated outcomes,
// and provider failures are deferred outcomes.
//
// Feedback is the journal-backed training source, set per tick by the
// worker from the scoped store before Classify opens the session.
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
// Every input receives an explicit outcome: no-request, uncertain, and
// unsupported results are terminal evaluated outcomes; provider failures are
// deferred with a sanitized problem code. Context cancellation remains an error.
func (m *MLClassifier) Classify(ctx context.Context, inputs []Input) (map[string]Classified, error) {
	if err := ctx.Err(); err != nil {
		return nil, err
	}
	results := make(map[string]Classified, len(inputs))
	requested := make(map[string]bool)
	byRequest := map[string]pendingCategoryRequest{}
	var batch []types.AnalysisJudgmentInput
	for _, input := range inputs {
		if err := ctx.Err(); err != nil {
			return nil, err
		}
		results[input.TransactionID] = Classified{Outcome: OutcomeEvaluated}
		for _, request := range CategoryJudgmentRequests(input) {
			requested[input.TransactionID] = true
			byRequest[request.ID] = pendingCategoryRequest{transactionID: input.TransactionID, category: request.Kind[len("category:"):]}
			batch = append(batch, request)
		}
	}
	if len(batch) == 0 {
		return results, nil
	}
	if m.provider == nil {
		return deferredProviderResults(results, requested), nil
	}
	session, err := m.provider.Open(ctx, m.Feedback)
	if err != nil {
		if err := categoryContextError(ctx, err); err != nil {
			return nil, err
		}
		return deferredProviderResults(results, requested), nil
	}
	if err := ctx.Err(); err != nil {
		return nil, err
	}
	if session == nil {
		return deferredProviderResults(results, requested), nil
	}
	supported := map[string]map[string]bool{}
	for start := 0; start < len(batch); start += 100 {
		if err := ctx.Err(); err != nil {
			return nil, err
		}
		end := min(start+100, len(batch))
		judgments, err := session.Evaluate(ctx, batch[start:end])
		if err != nil {
			if err := categoryContextError(ctx, err); err != nil {
				return nil, err
			}
			return deferredProviderResults(results, requested), nil
		}
		if err := ctx.Err(); err != nil {
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
	for transactionID, kinds := range supported {
		for _, key := range types.CategoryKeys {
			if kinds[key] {
				results[transactionID] = Classified{Category: key, Producer: m.Version(), Outcome: OutcomeAssigned}
				break
			}
		}
	}
	if err := ctx.Err(); err != nil {
		return nil, err
	}
	return results, nil
}

func deferredProviderResults(results map[string]Classified, requested map[string]bool) map[string]Classified {
	for transactionID := range requested {
		results[transactionID] = Classified{
			Outcome:     OutcomeDeferred,
			ProblemCode: types.TransactionCategoryProblemProvider,
		}
	}
	return results
}

// categoryContextError preserves cancellation of the caller's context without
// returning a provider's wrapped error, which may carry request evidence. A
// provider-owned timeout is a transient provider failure and is deferred.
func categoryContextError(ctx context.Context, _ error) error {
	return ctx.Err()
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
// transactions with the learner. Provider failures become deferred outcomes for
// the skipped transactions while keyword assignments stay assigned. Context
// cancellation remains an error.
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
		if results[input.TransactionID].Outcome != OutcomeAssigned {
			remaining = append(remaining, input)
		}
	}
	if len(remaining) == 0 {
		return results, nil
	}
	backfill, err := c.ML.Classify(ctx, remaining)
	if err != nil {
		return nil, err
	}
	for transactionID, classified := range backfill {
		results[transactionID] = classified
	}
	for _, input := range remaining {
		if _, ok := results[input.TransactionID]; !ok {
			results[input.TransactionID] = Classified{Outcome: OutcomeEvaluated}
		}
	}
	return results, nil
}
