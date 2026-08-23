package domain

import (
	"fmt"
	"math"
	"sort"
	"sync"

	"github.com/simhozebs/net-worth-estimator/backend/internal/types"
)

// Stochastic session ported from analysis/projectStochastic.ts.
//
// Concurrency: sample simulation runs on a bounded goroutine pool; the LCG is
// owned by the sampler and only touched by the coordinator goroutine when
// building samples (mirroring the single-threaded TS sampler), so seeded runs
// are deterministic and bit-identical to sequential execution.

const (
	stochasticProgressBatch         = 50
	stochasticProgressTargetUpdates = 200
)

// GetStochasticProgressUpdateRunInterval mirrors the lightweight progress cadence.
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

func buildSampleCountsByPostingId(postings []types.Posting, horizonYears int, startDate, endDate string, includeStartDateEvents bool) map[string]int {
	sampleCounts := map[string]int{}
	for _, posting := range postings {
		if posting.Enabled && posting.Volatility > 0 {
			sampleCounts[posting.ID] = horizonYears
		}
	}
	occurrencesByDate := map[string][]DatedPostingOccurrence{}
	AddOccurrences(postings, occurrencesByDate, startDate, endDate, includeStartDateEvents)
	for date, occurrences := range occurrencesByDate {
		requiredCount := ProjectionYearIndex(startDate, date) + 1
		for _, occurrence := range occurrences {
			if occurrence.Posting.Volatility <= 0 {
				continue
			}
			if current, ok := sampleCounts[occurrence.Posting.ID]; !ok || requiredCount > current {
				sampleCounts[occurrence.Posting.ID] = requiredCount
			}
		}
	}
	return sampleCounts
}

func buildStochasticRates(postings []types.Posting, sampleCounts map[string]int, sampler StochasticSampler) map[string][]float64 {
	rates := map[string][]float64{}
	for index := range postings {
		posting := &postings[index]
		if posting.Volatility <= 0 || !posting.Enabled {
			continue
		}
		count := sampleCounts[posting.ID]
		samples := make([]float64, count)
		for i := 0; i < count; i++ {
			samples[i] = sampler(posting.AnnualRate, posting.Volatility)
		}
		rates[posting.ID] = samples
	}
	return rates
}

func newStochasticSession(document *types.FinancialModelDocument, settings *types.ProjectionRuntimeSettings, overrides types.ModelOverrides, config types.StochasticConfig, onProgress StochasticProgressCallback, incomeData *types.IncomeDataSnapshot) (*stochasticSession, error) {
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
	prepared, err := PrepareSimulationRequest(document, settings, overrides, nil, incomeData)
	if err != nil {
		return nil, err
	}
	session.prepared = prepared
	run, err := Simulate(prepared.Request)
	if err != nil {
		return nil, err
	}
	path, result := AdaptSimulationRun(prepared, &run)
	session.deterministicPath = path

	session.sampleCountsByPostingID = buildSampleCountsByPostingId(
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
	session.deterministic = result
	session.deterministic.Evaluations = session.runtimes.Result().Evaluations
	session.sortedDates = make([]string, len(session.deterministic.Timeline.Rows))
	for index, row := range session.deterministic.Timeline.Rows {
		session.sortedDates[index] = row.Date
	}
	return session, nil
}

func (s *stochasticSession) createSample() *types.MonteCarloSample {
	return &types.MonteCarloSample{
		AnnualRatesByPostingID: buildStochasticRates(s.prepared.Request.Model.Postings, s.sampleCountsByPostingID, s.sampler),
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
	run, err := Simulate(request)
	if err != nil {
		return nil, err
	}
	return BuildProjectionPath(s.prepared, &run), nil
}

func (s *stochasticSession) consumeSample(path *types.ProjectionPath) error {
	s.valuesMutex.Lock()
	defer s.valuesMutex.Unlock()
	if s.completedRuns >= s.config.RunCount {
		return ErrTooManyPaths
	}
	s.runtimes.Consume(&EvaluationContext{
		Path:             path,
		Document:         &path.EffectiveDocument,
		MonteCarloSample: pathSampleOf(path),
		DetailLevel:      "summary",
	})
	for _, row := range path.Rows {
		s.pendingValuesByDate[row.Date] = append(s.pendingValuesByDate[row.Date], math.Round(row.NetWorth))
		if _, ok := s.isHistoricalByDate[row.Date]; !ok {
			s.isHistoricalByDate[row.Date] = row.IsHistorical
		}
	}
	s.completedRuns++
	batchComplete := s.completedRuns%stochasticProgressBatch == 0 || s.completedRuns == s.config.RunCount
	if batchComplete {
		s.flushBatchLocked()
		return nil
	}
	if s.completedRuns == 1 || s.completedRuns%s.progressUpdateRuns == 0 {
		if s.onProgress != nil {
			s.onProgress(s.progress(types.PhaseStochasticRuns), nil)
		}
	}
	return nil
}

// pathSampleOf recovers nothing; the coordinator passes the sample explicitly.
func pathSampleOf(*types.ProjectionPath) *types.MonteCarloSample { return nil }

func (s *stochasticSession) flushBatchLocked() {
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
	if s.onProgress != nil {
		s.onProgress(s.progress(types.PhaseStochasticRuns), s.buildResult())
	}
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
		Config:        s.config,
		Deterministic: *s.deterministic,
		Bands:         bands,
		Evaluations:   s.runtimes.Result().Evaluations,
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
