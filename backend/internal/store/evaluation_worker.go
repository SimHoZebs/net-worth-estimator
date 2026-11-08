package store

import "github.com/simhozebs/net-worth-estimator/backend/internal/types"

// EvaluationWorkerStore owns asynchronous evaluation-reader execution.
// Claim captures a durable lease atomically; Complete publishes only when
// the projection revision/fingerprint still matches the claimed input.
type EvaluationWorkerStore interface {
	ClaimEvaluationWorkerRun() (types.EvaluationRun, types.EvaluationSnapshot, bool, error)
	CompleteEvaluationWorkerRun(run types.EvaluationRun, problem string) error
	ListEvaluationWorkerRuns() ([]types.EvaluationRun, int64, string, error)
}
