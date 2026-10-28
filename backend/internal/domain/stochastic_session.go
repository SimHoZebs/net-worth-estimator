package domain

import (
	"fmt"
	"sort"
	"sync"

	"github.com/simhozebs/net-worth-estimator/backend/internal/types"
)

// Stochastic session coordinates sample construction and ordered accumulation.
//
// Concurrency: sample simulation runs on a bounded goroutine pool; the LCG is
// owned by the sampler and only touched by the coordinator goroutine when
// building samples, so seeded runs are deterministic and bit-identical to
// sequential execution.

const (
	stochasticProgressBatch         = 50
	stochasticProgressTargetUpdates = 200
)

// GetStochasticProgressUpdateRunInterval returns the progress update cadence.
func GetStochasticProgressUpdateRunInterval(runCount int) int {
	interval := (runCount + stochasticProgressTargetUpdates - 1) / stochasticProgressTargetUpdates
	if interval < 1 {
		interval = 1
	}
	if interval > stochasticProgressBatch/2 {
		interval = stochasticProgressBatch / 2
	}
	return interval
}

// StochasticProgressCallback receives progress updates and optional partials.
type StochasticProgressCallback func(progress types.StochasticProgress, partial *types.StochasticProjectionResult)

type stochasticSession struct {
	config                  types.StochasticConfig
	prepared                *types.PreparedProjection
	deterministicPath       *types.ProjectionPath
	deterministic           *types.ProjectionResult
	runtimes                *EvaluationRuntimeSet
	sampleCountsByPostingID map[string]int
	sampler                 StochasticSampler
	sortedDates             []string
	valuesMutex             sync.Mutex
	sortedValuesByDate      map[string][]float64
	pendingValuesByDate     map[string][]float64
	isHistoricalByDate      map[string]bool
	progressUpdateRuns      int
	completedRuns           int
	onProgress              StochasticProgressCallback
}

func buildSampleCountsByPostingId(rules []types.RecurrenceRule, postings []types.Posting, horizonYears int, startDate, endDate string, includeStartDateEvents bool) map[string]int {
	sampleCounts := map[string]int{}
	// Rules first in stored order, then manual postings: the LCG is
	// order-sensitive, so discovery order is part of the seeded contract.
	// Existing models carry volatility on rules only; manuals without a
	// volatile occurrence-rate input change nothing.
	for _, rule := range rules {
		if params, ok := VolatileRateInputOf(rule.Amount); ok && rule.Enabled && params.Volatility > 0 {
			_ = params
			sampleCounts[rule.ID] = horizonYears
		}
	}
	for _, posting := range postings {
		if params, ok := VolatileRateInputOf(posting.Amount); ok && posting.Enabled && params.Volatility > 0 {
			_ = params
			if _, exists := sampleCounts[posting.ID]; !exists {
				sampleCounts[posting.ID] = horizonYears
			}
		}
	}
	// Occurrence dates extend short horizons: a movement executing in
	// projection year N needs at least N+1 samples.
	resolved := ResolveOccurrences(rules, postings, startDate, endDate, includeStartDateEvents)
	for date, occurrences := range resolved.ByDate {
		requiredCount := ProjectionYearIndex(startDate, date) + 1
		for _, occurrence := range occurrences {
			if _, ok := VolatileRateInputOf(occurrence.Posting.Amount); !ok {
				continue
			}
			if current, ok := sampleCounts[occurrence.Posting.ID]; !ok || requiredCount > current {
				sampleCounts[occurrence.Posting.ID] = requiredCount
			}
		}
	}
	return sampleCounts
}

// samplingParamsByID indexes volatile sampling parameters by movement ID:
// rules in stored order, then manual postings. The sampler draws in this
// order, so iteration order is part of the seeded contract.
func samplingParamsByID(rules []types.RecurrenceRule, postings []types.Posting) []struct {
	id     string
	params VolatileRateParams
} {
	var ordered []struct {
		id     string
		params VolatileRateParams
	}
	for index := range rules {
		rule := &rules[index]
		if !rule.Enabled {
			continue
		}
		if params, ok := VolatileRateInputOf(rule.Amount); ok {
			ordered = append(ordered, struct {
				id     string
				params VolatileRateParams
			}{id: rule.ID, params: params})
		}
	}
	for index := range postings {
		posting := &postings[index]
		if !posting.Enabled {
			continue
		}
		if params, ok := VolatileRateInputOf(posting.Amount); ok {
			ordered = append(ordered, struct {
				id     string
				params VolatileRateParams
			}{id: posting.ID, params: params})
		}
	}
	return ordered
}

func buildStochasticRates(rules []types.RecurrenceRule, postings []types.Posting, sampleCounts map[string]int, sampler StochasticSampler) map[string][]float64 {
	rates := map[string][]float64{}
	for _, entry := range samplingParamsByID(rules, postings) {
		count := sampleCounts[entry.id]
		samples := make([]float64, count)
		for i := 0; i < count; i++ {
			samples[i] = sampler(entry.params.AnnualRate, entry.params.Volatility)
		}
		rates[entry.id] = samples
	}
	return rates
}

func newStochasticSession(document *types.FinancialModelDocument, settings *types.ProjectionRuntimeSettings, overrides types.ModelOverrides, config types.StochasticConfig, onProgress StochasticProgressCallback) (*stochasticSession, error) {
	session := &stochasticSession{
		config:              NormalizeStochasticConfig(config),
		onProgress:          onProgress,
		sortedValuesByDate:  map[string][]float64{},
		pendingValuesByDate: map[string][]float64{},
		isHistoricalByDate:  map[string]bool{},
	}
	session.progressUpdateRuns = GetStochasticProgressUpdateRunInterval(session.config.RunCount)
	if onProgress != nil {
		onProgress(types.StochasticProgress{
			Phase:               types.PhasePreparing,
			CompletedRuns:       0,
			TotalRuns:           session.config.RunCount,
			Fraction:            0,
			EvaluationWorkloads: []types.StochasticEvaluationWorkload{},
		}, nil)
	}
	session.sampler = NewStochasticSampler(session.config.Seed)
	// The deterministic base path is shared with deterministic projections
	// through the base-path cache: identical base inputs never simulate twice.
	prepared, path, baseResult, err := projectBaseWithCache(document, settings, overrides, nil)
	if err != nil {
		return nil, err
	}
	session.prepared = prepared
	session.deterministicPath = path
	deterministic := *baseResult // copy the shell; evaluations attach below
	session.deterministic = &deterministic

	session.sampleCountsByPostingID = buildSampleCountsByPostingId(
		prepared.Request.Model.RecurrenceRules,
		prepared.Request.Model.Postings,
		settings.HorizonYears,
		prepared.Request.StartDate,
		prepared.Request.EndDate,
		prepared.Request.IncludeStartDateEvents,
	)
	session.runtimes = NewEvaluationRuntimeSet(&settings.Evaluations, evaluationRegistryInstance)
	session.runtimes.PrepareStochasticWork(&EvaluationContext{
		Path:        path,
		Document:    &path.EffectiveDocument,
		DetailLevel: "summary",
	})
	if onProgress != nil {
		onProgress(session.progress(types.PhaseDeterministicEvaluations), nil)
	}
	session.runtimes.EvaluateDeterministic(&EvaluationContext{
		Path:        path,
		Document:    &path.EffectiveDocument,
		DetailLevel: "summary",
	})
	session.runtimes.StartStochastic()
	if onProgress != nil {
		onProgress(session.progress(types.PhaseStochasticRuns), nil)
	}
	session.deterministic.Evaluations = session.runtimes.Result().Evaluations
	session.sortedDates = make([]string, len(session.deterministic.Timeline.Rows))
	for index, row := range session.deterministic.Timeline.Rows {
		session.sortedDates[index] = row.Date
	}
	return session, nil
}

func (s *stochasticSession) createSample() *types.MonteCarloSample {
	return &types.MonteCarloSample{
		AnnualRatesByPostingID: buildStochasticRates(s.prepared.Request.Model.RecurrenceRules, s.prepared.Request.Model.Postings, s.sampleCountsByPostingID, s.sampler),
	}
}

func (s *stochasticSession) progress(phase types.StochasticProgressPhase) types.StochasticProgress {
	fraction := float64(s.completedRuns) / float64(s.config.RunCount)
	return types.StochasticProgress{
		Phase:               phase,
		CompletedRuns:       s.completedRuns,
		TotalRuns:           s.config.RunCount,
		Fraction:            fraction,
		EvaluationWorkloads: s.runtimes.WorkloadProgress(s.completedRuns, s.config.RunCount),
	}
}

// projectSample runs one sampled path-only projection.
func (s *stochasticSession) projectSample(sample *types.MonteCarloSample) (*types.ProjectionPath, error) {
	request := s.prepared.Request
	request.MonteCarloSample = sample
	run, err := orchestratedSimulate(request)
	if err != nil {
		return nil, err
	}
	return BuildStochasticSamplePath(s.prepared, &run), nil
}

// flushBatchLocked folds this batch's per-run values into the sorted
// percentile buffers, closes evaluation accumulators for the completed runs,
// and snapshots the partial result. Callers must hold valuesMutex; the
// progress write itself happens outside the lock in the coordinator.
func (s *stochasticSession) flushBatchLocked() *types.StochasticProjectionResult {
	for date, values := range s.pendingValuesByDate {
		sort.Float64s(values)
		existing, ok := s.sortedValuesByDate[date]
		if ok {
			s.sortedValuesByDate[date] = MergeSorted(existing, values)
		} else {
			s.sortedValuesByDate[date] = values
		}
	}
	s.pendingValuesByDate = map[string][]float64{}
	s.runtimes.Finalize(&EvaluationFinalizeContext{
		Document:          &s.deterministicPath.EffectiveDocument,
		DeterministicPath: s.deterministicPath,
		RunCount:          s.completedRuns,
	})
	return s.buildResult()
}

func (s *stochasticSession) buildResult() *types.StochasticProjectionResult {
	bands := make([]types.StochasticBandRow, 0, len(s.sortedDates))
	for _, date := range s.sortedDates {
		bands = append(bands, types.StochasticBandRow{
			Date:         date,
			IsHistorical: s.isHistoricalByDate[date],
			NetWorth:     ComputePercentilesFromSorted(s.sortedValuesByDate[date]),
		})
	}
	finalBands := types.PercentileBands{}
	if len(bands) > 0 {
		finalBands = bands[len(bands)-1].NetWorth
	}
	result := &types.StochasticProjectionResult{
		Config:      s.config,
		Bands:       bands,
		Evaluations: s.runtimes.Result().Evaluations,
	}
	result.Milestones.FinalNetWorthPercentiles = finalBands
	return result
}

func (s *stochasticSession) result() (*types.StochasticProjectionResult, error) {
	if s.completedRuns != s.config.RunCount {
		return nil, fmt.Errorf("Stochastic projection expected %d paths but received %d.", s.config.RunCount, s.completedRuns)
	}
	return s.buildResult(), nil
}
