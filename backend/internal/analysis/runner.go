// Package analysis runs versioned inferences over saved bank evidence. It has
// no dependency on sync, simulation, or financial-model write operations.
package analysis

import (
	"context"
	"fmt"
	"time"

	"github.com/simhozebs/net-worth-estimator/backend/internal/store"
	"github.com/simhozebs/net-worth-estimator/backend/internal/types"
)

type Definition interface {
	Type() string
	Version() string
	Analyze(context.Context, types.AnalysisSnapshot) ([]types.AnalysisDetection, error)
}

// Definitions is the composition point for built-in analyses. Definitions share
// a lifecycle, not a classification switch or financial-model mutation path.
func Definitions() []Definition { return []Definition{BNPL{}} }

type Database interface {
	ListAnalysisUsers() ([]string, error)
	User(string) (store.Store, error)
}

type Runner struct {
	database    Database
	definitions []Definition
}

func NewRunner(database Database, definitions ...Definition) (*Runner, error) {
	if database == nil {
		return nil, fmt.Errorf("analysis requires a database")
	}
	seen := map[string]bool{}
	for _, definition := range definitions {
		if definition == nil || definition.Type() == "" || definition.Version() == "" || seen[definition.Type()] {
			return nil, fmt.Errorf("analysis definitions require unique types and versions")
		}
		seen[definition.Type()] = true
	}
	return &Runner{database: database, definitions: definitions}, nil
}

// RunOnce is also the deterministic test seam. Failed users do not block others.
func (r *Runner) RunOnce(ctx context.Context) error {
	users, err := r.database.ListAnalysisUsers()
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
		for _, definition := range r.definitions {
			if err := r.run(ctx, scoped, definition); err != nil && firstError == nil {
				firstError = err
			}
		}
	}
	return firstError
}

func (r *Runner) run(ctx context.Context, scoped store.AnalysisStore, definition Definition) error {
	run, input, claimed, err := scoped.ClaimAnalysis(definition.Type(), definition.Version())
	if err != nil || !claimed {
		return err
	}
	work, cancel := context.WithTimeout(ctx, 20*time.Second)
	defer cancel()
	findings, analyzeErr := analyze(work, definition, input)
	problem := ""
	if analyzeErr != nil || work.Err() != nil {
		problem = "analysis-failed"
		findings = nil
	}
	return scoped.CompleteAnalysis(run, findings, problem)
}

func analyze(ctx context.Context, definition Definition, input types.AnalysisSnapshot) (findings []types.AnalysisDetection, err error) {
	defer func() {
		if recover() != nil {
			findings, err = nil, fmt.Errorf("analysis failed")
		}
	}()
	return definition.Analyze(ctx, input)
}

// Start owns its goroutine and waits for it on stop. Revision discovery makes
// input invalidation durable, including changes made while the server was down.
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
