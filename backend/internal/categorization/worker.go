package categorization

import (
	"context"
	"fmt"
	"time"

	"github.com/simhozebs/net-worth-estimator/backend/internal/store"
	"github.com/simhozebs/net-worth-estimator/backend/internal/types"
)

// Database discovers users with bank transactions. The worker never sees raw
// credentials or another user's scope.
type Database interface {
	ListCategoryUsers() ([]string, error)
	User(string) (store.Store, error)
}

// Worker fills uncategorized bank transactions in the background. It scans durable
// rows instead of keeping a queue: an interrupted run resumes on the next tick,
// and a deleted transaction simply stops appearing as a candidate.
type Worker struct {
	database   Database
	classifier Classifier
}

// NewWorker validates the composition before the server starts.
func NewWorker(database Database, classifier Classifier) (*Worker, error) {
	if database == nil {
		return nil, fmt.Errorf("categorization requires a database")
	}
	if classifier == nil || classifier.Version() == "" {
		return nil, fmt.Errorf("categorization requires a versioned classifier")
	}
	return &Worker{database: database, classifier: classifier}, nil
}

// RunOnce is also the deterministic test seam. One failed user or transaction does
// not block the rest.
func (w *Worker) RunOnce(ctx context.Context) error {
	users, err := w.database.ListCategoryUsers()
	if err != nil {
		return err
	}
	var firstError error
	for _, user := range users {
		if err := ctx.Err(); err != nil {
			return err
		}
		scoped, err := w.database.User(user)
		if err != nil {
			if firstError == nil {
				firstError = err
			}
			continue
		}
		if err := w.runUser(ctx, user, scoped); err != nil && firstError == nil {
			firstError = err
		}
	}
	return firstError
}

const categoryBatchSize = 100

func (w *Worker) runUser(ctx context.Context, user string, scoped store.Store) error {
	if setter, ok := w.classifier.(FeedbackSetter); ok {
		// Training delivery rides the existing session-open path: the
		// next Classify opens with the user's matured journal rows, and
		// judging proceeds in the same call. No new goroutines, and
		// keyword-only compositions (no setter) are untouched.
		setter.SetFeedbackSource(newJournalFeedbackSource(scoped, user))
	}
	candidates, err := scoped.ListTransactionCategoryCandidates(categoryBatchSize)
	if err != nil || len(candidates) == 0 {
		return err
	}
	return w.classifyAndRecord(ctx, scoped, candidates)
}

func (w *Worker) classifyAndRecord(ctx context.Context, scoped store.Store, candidates []types.TransactionCategoryCandidate) error {
	inputs := make([]Input, len(candidates))
	for index, candidate := range candidates {
		inputs[index] = Input{
			TransactionID: candidate.TransactionID,
			Name:          candidate.Name,
			Direction:     candidate.Direction,
			Facts:         candidate.Facts,
		}
	}
	work, cancel := context.WithTimeout(ctx, 10*time.Second)
	defer cancel()
	results, err := w.classifier.Classify(work, inputs)
	if err != nil {
		return err
	}
	evaluations := make([]types.TransactionCategoryEvaluation, 0, len(candidates))
	for _, candidate := range candidates {
		classified, ok := results[candidate.TransactionID]
		if !ok {
			return fmt.Errorf("categorization classifier omitted an outcome")
		}
		evaluations = append(evaluations, types.TransactionCategoryEvaluation{
			TransactionID: candidate.TransactionID,
			EvidenceHash:  candidate.EvidenceHash,
			Outcome:       classified.Outcome,
			Category:      classified.Category,
			Producer:      classified.Producer,
			ProblemCode:   classified.ProblemCode,
		})
	}
	last := candidates[len(candidates)-1]
	return scoped.RecordTransactionCategoryBatch(types.TransactionCategoryBatch{
		ClassifierVersion: w.classifier.Version(),
		Evaluations:       evaluations,
		Cursor: types.TransactionCategoryCursor{
			PostedTime:    last.PostedTime,
			TransactionID: last.TransactionID,
		},
	})
}

// Start owns its goroutine and waits for it on stop.
func (w *Worker) Start(parent context.Context, interval time.Duration, onError func(error)) func() {
	ctx, cancel := context.WithCancel(parent)
	done := make(chan struct{})
	go func() {
		defer close(done)
		ticker := time.NewTicker(interval)
		defer ticker.Stop()
		for {
			if err := w.RunOnce(ctx); err != nil && ctx.Err() == nil && onError != nil {
				onError(err)
			}
			select {
			case <-ctx.Done():
				return
			case <-ticker.C:
			}
		}
	}()
	return func() { cancel(); <-done }
}
