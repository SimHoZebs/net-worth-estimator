package domain

import (
	"context"
	"errors"
	"fmt"
	"sync"

	"github.com/simhozebs/net-worth-estimator/backend/internal/types"
)

// StochasticProjection runs the full Monte Carlo projection with progress.
//
// The coordinator goroutine builds samples sequentially (LCG order parity),
// simulates paths on a bounded worker pool, and consumes results in
// submission order. Evaluation accumulators and percentile buffers are only
// touched by the coordinator, matching TS single-threaded accumulation.
func StochasticProjection(
	ctx context.Context,
	document *types.FinancialModelDocument,
	settings *types.ProjectionRuntimeSettings,
	overrides types.ModelOverrides,
	config types.StochasticConfig,
	onProgress StochasticProgressCallback,
	incomeData *types.IncomeDataSnapshot,
) (*types.StochasticProjectionResult, error) {
	session, err := newStochasticSession(document, settings, overrides, config, onProgress, incomeData)
	if err != nil {
		return nil, err
	}

	const workerCount = 4
	type sampleJob struct {
		sample *types.MonteCarloSample
		index  int
	}
	type pathResult struct {
		index int
		path  *types.ProjectionPath
		err   error
	}

	jobs := make(chan sampleJob)
	results := make(chan pathResult, workerCount*2)
	var workers sync.WaitGroup
	for worker := 0; worker < workerCount; worker++ {
		workers.Add(1)
		go func() {
			defer workers.Done()
			for job := range jobs {
				if ctx.Err() != nil {
					results <- pathResult{index: job.index, err: ctx.Err()}
					continue
				}
				path, err := session.projectSample(job.sample)
				results <- pathResult{index: job.index, path: path, err: err}
			}
		}()
	}
	defer func() {
		close(jobs)
		workers.Wait()
	}()

	go func() {
		for run := 0; run < session.config.RunCount; run++ {
			select {
			case <-ctx.Done():
				return
			default:
			}
			jobs <- sampleJob{sample: session.createSample(), index: run}
		}
	}()

	pending := make(map[int]*types.ProjectionPath)
	nextIndex := 0
	for nextIndex < session.config.RunCount {
		result := <-results
		if result.err != nil {
			if errors.Is(result.err, ErrTooManyPaths) {
				return nil, result.err
			}
			return nil, fmt.Errorf("stochastic run %d: %w", result.index, result.err)
		}
		pending[result.index] = result.path
		for {
			path, ok := pending[nextIndex]
			if !ok {
				break
			}
			delete(pending, nextIndex)
			// Accumulation happens in submission order for exact parity with
			// the sequential TS implementation (sorted merges + counters).
			if err := consumeOrdered(session, path); err != nil {
				return nil, err
			}
			nextIndex++
		}
	}
	return session.result()
}

func consumeOrdered(session *stochasticSession, path *types.ProjectionPath) error {
	session.valuesMutex.Lock()
	defer session.valuesMutex.Unlock()
	session.runtimes.Consume(&EvaluationContext{
		Path:        path,
		Document:    &path.EffectiveDocument,
		DetailLevel: "summary",
	})
	for _, row := range path.Rows {
		session.pendingValuesByDate[row.Date] = append(session.pendingValuesByDate[row.Date], mathRound(row.NetWorth))
		if _, ok := session.isHistoricalByDate[row.Date]; !ok {
			session.isHistoricalByDate[row.Date] = row.IsHistorical
		}
	}
	session.completedRuns++
	batchComplete := session.completedRuns%stochasticProgressBatch == 0 || session.completedRuns == session.config.RunCount
	if batchComplete {
		session.flushBatchLocked()
		return nil
	}
	if session.completedRuns == 1 || session.completedRuns%session.progressUpdateRuns == 0 {
		if session.onProgress != nil {
			session.onProgress(session.progress(types.PhaseStochasticRuns), nil)
		}
	}
	return nil
}

func mathRound(value float64) float64 { return float64(int64(value + copysignOne(value))) }

func copysignOne(value float64) float64 {
	if value < 0 {
		return -0.5
	}
	return 0.5
}

// ErrTooManyPaths mirrors the TS over-consumption guard.
var ErrTooManyPaths = errors.New("Stochastic projection received too many paths.")
