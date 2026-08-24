package domain

import (
	"context"
	"fmt"
	"math"
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
		index  int
		path   *types.ProjectionPath
		sample *types.MonteCarloSample
		err    error
	}
	type pendingRun struct {
		path   *types.ProjectionPath
		sample *types.MonteCarloSample
	}

	jobs := make(chan sampleJob)
	results := make(chan pathResult, workerCount*2)
	var workers sync.WaitGroup
	runCtx, cancel := context.WithCancel(ctx)
	defer func() {
		cancel()
		workers.Wait()
	}()

	for worker := 0; worker < workerCount; worker++ {
		workers.Add(1)
		go func() {
			defer workers.Done()
			for job := range jobs {
				if runCtx.Err() != nil {
					return
				}
				path, err := session.projectSample(job.sample)
				// Never block forever on results: after an early consumer
				// return the deferred cancel fires and workers must be able
				// to exit or workers.Wait() deadlocks.
				select {
				case results <- pathResult{index: job.index, path: path, sample: job.sample, err: err}:
				case <-runCtx.Done():
					return
				}
			}
		}()
	}

	// The producer goroutine owns closing `jobs` so a blocked send can never
	// race the close ("send on closed channel" would otherwise crash the
	// process from outside the handler's recover scope). Cancelling the
	// derived context on early return stops production instead.
	go func() {
		defer close(jobs)
		for run := 0; run < session.config.RunCount; run++ {
			select {
			case <-runCtx.Done():
				return
			case jobs <- sampleJob{sample: session.createSample(), index: run}:
			}
		}
	}()

	pending := make(map[int]pendingRun)
	nextIndex := 0
consumer:
	for nextIndex < session.config.RunCount {
		var result pathResult
		select {
		case result = <-results:
		case <-runCtx.Done():
			// Production stopped before every run completed (client
			// disconnect or an earlier error return): drain without waiting.
			break consumer
		}
		if result.err != nil {
			return nil, fmt.Errorf("stochastic run %d: %w", result.index, result.err)
		}
		pending[result.index] = pendingRun{path: result.path, sample: result.sample}
		for {
			run, ok := pending[nextIndex]
			if !ok {
				break
			}
			delete(pending, nextIndex)
			// Accumulation happens in submission order for exact parity with
			// the sequential TS implementation (sorted merges + counters).
			if err := consumeOrdered(session, run.path, run.sample); err != nil {
				return nil, err
			}
			nextIndex++
		}
	}
	if nextIndex < session.config.RunCount {
		return nil, ctx.Err()
	}
	return session.result()
}

func consumeOrdered(
	session *stochasticSession,
	path *types.ProjectionPath,
	sample *types.MonteCarloSample,
) error {
	session.valuesMutex.Lock()
	session.runtimes.Consume(&EvaluationContext{
		Path:             path,
		Document:         &path.EffectiveDocument,
		MonteCarloSample: sample,
		DetailLevel:      "summary",
	})
	for _, row := range path.Rows {
		session.pendingValuesByDate[row.Date] = append(session.pendingValuesByDate[row.Date], mathRound(row.NetWorth))
		if _, ok := session.isHistoricalByDate[row.Date]; !ok {
			session.isHistoricalByDate[row.Date] = row.IsHistorical
		}
	}
	session.completedRuns++
	batchComplete := session.completedRuns%stochasticProgressBatch == 0 || session.completedRuns == session.config.RunCount
	progressSnapshot := session.progress(types.PhaseStochasticRuns)
	var partialResult *types.StochasticProjectionResult
	if batchComplete {
		partialResult = session.flushBatchLocked()
	}
	session.valuesMutex.Unlock()

	// Progress callbacks write to the HTTP response; they must never run
	// while valuesMutex is held or a stalled client stalls accumulation.
	if batchComplete {
		if session.onProgress != nil {
			session.onProgress(progressSnapshot, partialResult)
		}
		return nil
	}
	if session.completedRuns == 1 || session.completedRuns%session.progressUpdateRuns == 0 {
		if session.onProgress != nil {
			session.onProgress(progressSnapshot, nil)
		}
	}
	return nil
}

// mathRound matches JavaScript Math.round: half rounds toward +Infinity
// (Math.round(-2.5) === -2), unlike truncation on v±0.5.
func mathRound(value float64) float64 { return math.Floor(value + 0.5) }
