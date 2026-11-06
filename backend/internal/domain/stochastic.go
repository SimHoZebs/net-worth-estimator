package domain

import (
	"context"
	"fmt"
	"math"
	"runtime"
	"sync"

	"github.com/simhozebs/net-worth-estimator/backend/internal/types"
)

// StochasticProjection runs the full Monte Carlo projection with progress.
//
// The coordinator goroutine builds samples sequentially (preserving LCG
// order), simulates paths on a bounded goroutine pool, and consumes results in
// submission order. Evaluation accumulators and percentile buffers are only
// touched by the coordinator, preserving deterministic accumulation.
func StochasticProjection(
	ctx context.Context,
	model *types.FinancialModel,
	settings *types.ProjectionRuntimeSettings,
	overrides types.ModelOverrides,
	config types.StochasticConfig,
	onProgress StochasticProgressCallback,
) (*types.StochasticProjectionResult, error) {
	session, err := newStochasticSession(model, settings, overrides, config, onProgress)
	if err != nil {
		return nil, err
	}
	if err := runStochasticSession(ctx, session); err != nil {
		return nil, err
	}
	return session.result()
}

// StochasticNetWorthSamples runs the full Monte Carlo projection and
// returns the result plus a copy of the per-date sorted net worth samples.
// The builder persists statistics from the samples; readers serve bands.
func StochasticNetWorthSamples(
	ctx context.Context,
	model *types.FinancialModel,
	settings *types.ProjectionRuntimeSettings,
	overrides types.ModelOverrides,
	config types.StochasticConfig,
	onProgress StochasticProgressCallback,
) (*types.StochasticProjectionResult, map[string][]float64, error) {
	session, err := newStochasticSession(model, settings, overrides, config, onProgress)
	if err != nil {
		return nil, nil, err
	}
	if err := runStochasticSession(ctx, session); err != nil {
		return nil, nil, err
	}
	result, err := session.result()
	if err != nil {
		return nil, nil, err
	}
	samples := make(map[string][]float64, len(session.sortedValuesByDate))
	for date, values := range session.sortedValuesByDate {
		copied := make([]float64, len(values))
		copy(copied, values)
		samples[date] = copied
	}
	return result, samples, nil
}

// runUnsampledSession runs the no-volatility fast path: Monte Carlo stays
// opt-in per rule, so a model with nothing to sample simulates once and
// folds that path into every trial. Percentiles of identical values equal
// the value, probabilities stay 0 or 1, and sample counts still advance, so
// the result is bit-identical to N identical trials at ~1/N the cost.
func runUnsampledSession(ctx context.Context, session *stochasticSession) error {
	sample := session.createSample()
	path, err := session.projectSample(sample)
	if err != nil {
		return err
	}
	for i := 0; i < session.config.RunCount; i++ {
		if err := ctx.Err(); err != nil {
			return err
		}
		if err := consumeOrdered(session, path, sample); err != nil {
			return err
		}
	}
	return nil
}

func runStochasticSession(ctx context.Context, session *stochasticSession) error {
	if len(session.sampleCountsByTransactionID) == 0 {
		return runUnsampledSession(ctx, session)
	}
	// Scale the pool with available CPUs: accumulation stays ordered in
	// submission order, so extra workers only add throughput, never
	// result churn.
	workerCount := runtime.NumCPU()
	if workerCount < 1 {
		workerCount = 1
	}
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
			// Production stopped before every run completed (request
			// cancellation or an earlier error return): drain without waiting.
			break consumer
		}
		if result.err != nil {
			return fmt.Errorf("stochastic run %d: %w", result.index, result.err)
		}
		pending[result.index] = pendingRun{path: result.path, sample: result.sample}
		for {
			run, ok := pending[nextIndex]
			if !ok {
				break
			}
			delete(pending, nextIndex)
			// Accumulation happens in submission order to preserve exact ordered
			// semantics for sorted merges and counters.
			if err := consumeOrdered(session, run.path, run.sample); err != nil {
				return err
			}
			nextIndex++
		}
	}
	if nextIndex < session.config.RunCount {
		return ctx.Err()
	}
	return nil
}

func consumeOrdered(
	session *stochasticSession,
	path *types.ProjectionPath,
	sample *types.MonteCarloSample,
) error {
	session.valuesMutex.Lock()
	session.runtimes.Consume(&EvaluationContext{
		Path:             path,
		Model:            &path.EffectiveModel,
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
	// while valuesMutex is held or a stalled subscriber stalls accumulation.
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

// mathRound rounds halves toward +Infinity, unlike truncation on v±0.5.
func mathRound(value float64) float64 { return math.Floor(value + 0.5) }

// RoundSampleValue rounds one net worth sample exactly as accumulation does.
func RoundSampleValue(value float64) float64 { return mathRound(value) }
