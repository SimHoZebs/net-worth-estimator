// Package evaluationworker runs asynchronous evaluation-reader execution
// independent of the request path. It mirrors the background analysis worker:
// durable discovery, bounded leases, revision-gated publish, and a passive
// status read. Evaluation readers that need a projection may run with an
// optional path; missing projection data yields indeterminate results
// instead of blocking.
package evaluationworker

import (
	"context"
	"fmt"
	"time"

	"github.com/simhozebs/net-worth-estimator/backend/internal/domain"
	"github.com/simhozebs/net-worth-estimator/backend/internal/store"
	"github.com/simhozebs/net-worth-estimator/backend/internal/types"
)

const (
	Version      = "v1"
	defaultLease = 60 // seconds
)

type Database interface {
	ListEvaluationWorkerUsers() ([]string, error)
	User(string) (store.Store, error)
}

type Runner struct {
	database Database
}

func NewRunner(database Database) (*Runner, error) {
	if database == nil {
		return nil, fmt.Errorf("evaluation worker requires a database")
	}
	return &Runner{database: database}, nil
}

// RunOnce is the deterministic test seam. Failed users do not block others.
func (r *Runner) RunOnce(ctx context.Context) error {
	users, err := r.database.ListEvaluationWorkerUsers()
	if err != nil {
		return err
	}
	var firstError error
	for _, user := range users {
		if err := ctx.Err(); err != nil {
			return err
		}
		scoped, err := r.database.User(user)
		if err != nil {
			if firstError == nil {
				firstError = err
			}
			continue
		}
		if err := r.run(ctx, scoped); err != nil && firstError == nil {
			firstError = err
		}
	}
	return firstError
}

func (r *Runner) run(ctx context.Context, scoped store.Store) error {
	run, snapshot, claimed, err := scoped.ClaimEvaluationWorkerRun()
	if err != nil || !claimed {
		return err
	}
	work, cancel := context.WithTimeout(ctx, 20*time.Second)
	defer cancel()
	problem := evaluate(work, scoped, snapshot)
	if problem != "" && work.Err() != nil {
		problem = "evaluation-failed"
	}
	return scoped.CompleteEvaluationWorkerRun(run, problem)
}

func evaluate(ctx context.Context, scoped store.Store, snapshot types.EvaluationSnapshot) string {
	defer func() {
		if recover() != nil {
			// Recover to a completed run rather than an infinite retry.
		}
	}()
	if err := ctx.Err(); err != nil {
		return "evaluation-failed"
	}
	model, err := scoped.LoadModel()
	if err != nil {
		return "evaluation-failed"
	}
	if model == nil {
		return ""
	}
	// Build an optional projection path. The worker must not require
	// projection data: if the model cannot project, evaluators that need
	// a path report indeterminate via the runtime guard.
	settings := types.ProjectionRuntimeSettings{Evaluations: model.Evaluations}
	path, _, err := domain.ProjectWithPath(model, &settings, types.ModelOverrides{}, nil)
	if err != nil {
		path = nil
	}
	// Evaluate all configured evaluators with an optional path. Results
	// are discarded here — the unified projection builder owns persistence
	// to *_outputs; the worker owns scheduling + durability assurance.
	_ = domain.EvaluateProjectionPathOptional(path, model, &settings, nil)
	return ""
}

// Start owns its goroutine and waits for it on stop.
func (r *Runner) Start(parent context.Context, interval time.Duration, onError func(error)) func() {
	ctx, cancel := context.WithCancel(parent)
	done := make(chan struct{})
	go func() {
		defer close(done)
		ticker := time.NewTicker(interval)
		defer ticker.Stop()
		for {
			if err := r.RunOnce(ctx); err != nil && ctx.Err() == nil && onError != nil {
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
