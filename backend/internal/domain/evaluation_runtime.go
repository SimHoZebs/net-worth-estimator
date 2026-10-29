package domain

import (
	"fmt"
	"sort"
	"strings"
	"sync"
	"sync/atomic"
	"time"

	"github.com/simhozebs/net-worth-estimator/backend/internal/types"
)

// Evaluation runtime. Definitions register by type; central coordinators
// never import evaluator-specific logic.
//
// Plugin contract: a new check adds one type plus one definition, core loop
// untouched. Two systems share this registry:
//   - Reader: answers from the cached path only. Use NewReachedDateReader
//     when the outcome is "the first date a measure crossed a target" (the
//     whole plugin is 5 arguments); otherwise fill the shared accumulator
//     wiring by hand and leave resimulation hooks nil. Core hooks (required):
//     ParseConfig parses once and returns a typed config or error;
//     EvaluatePath answers over one path; Accumulate plus Finalize aggregate
//     sampled paths; Status drives the UI verdict.
//   - Simulator: runs simulations against shared base path state (FI,
//     purchases). Requires Kind simulator PLUS AllowSimulation, DetailLevel
//     handling, and DescribeStochasticWork/MeasureStochasticWork for progress.
// Optional hooks: DescribeStochasticWork and MeasureStochasticWork only tune
// progress-bar labels and default to one unit per run; DiagnoseConfig folds
// into ParseConfig when absent.
//
// Simulation contract: rerunning the base simulation is NOT the default.
// Every definition is a reader (Kind "" or "reader") unless it
// opts into simulation with BOTH Kind "simulator" AND AllowSimulation true.
// Reader evaluations run against the cached ProjectionPath shared by all
// evaluations; while a reader EvaluatePath runs, PrepareSimulationRequest,
// Simulate, simulateScheduled, and simulatePurchases refuse to run and report
// a reader violation. Simulator evaluations (purchases, FI) reuse the shared
// base path state and run simulations only — never a fresh Prepare per eval.

// EvaluationKind states whether an evaluator may run simulations.
type EvaluationKind string

const (
	// EvaluationKindReader answers from the cached path only. This is
	// the default: the zero value ("") means reader.
	EvaluationKindReader EvaluationKind = "reader"
	// EvaluationKindSimulator runs simulations against shared base path state.
	// Requires AllowSimulation as an explicit second opt-in.
	EvaluationKindSimulator EvaluationKind = "simulator"
)

// EvaluationContext is passed to every evaluation hook.
type EvaluationContext struct {
	Path             *types.ProjectionPath
	Document         *types.FinancialModelDocument
	MonteCarloSample *types.MonteCarloSample
	DetailLevel      string // "detailed" | "summary"
}

// EvaluationFinalizeContext is passed to stochastic finalization.
type EvaluationFinalizeContext struct {
	Document          *types.FinancialModelDocument
	DeterministicPath *types.ProjectionPath
	RunCount          int
}

// EvaluationWorkloadPlan describes stochastic work units for progress reporting.
type EvaluationWorkloadPlan struct {
	UnitsPerRun         int
	UnitLabel           string
	UnitAction          string
	IntensiveUnitLabel  string
	IntensiveUnitAction string
	Description         string
}

// EvaluationWorkloadMeasurement reports completed units.
type EvaluationWorkloadMeasurement struct {
	UnitsCompleted          int
	IntensiveUnitsCompleted int
}

// PathResult is any evaluator-specific deterministic result value.
type PathResult interface {
	ToJSON() types.JsonValue
}

// Accumulator consumes per-sample path results.
type Accumulator interface{}

// EvaluationDefinition is the typed contract each evaluator implements.
type EvaluationDefinition struct {
	Type string
	Name string

	// Kind selects the simulation contract. "" defaults to reader:
	// answer from ctx.Path only. Simulator requires Kind simulator PLUS
	// AllowSimulation; one without the other is misconfigured.
	Kind            EvaluationKind
	AllowSimulation bool

	ValidateConfig func(config any) error
	ParseConfig    func(config any) (any, error)

	EvaluatePath func(ctx *EvaluationContext, config any) (PathResult, error)

	CreateAccumulator func(config any, deterministicResult PathResult) (Accumulator, error)
	Accumulate        func(accumulator Accumulator, pathResult PathResult) error
	Finalize          func(accumulator Accumulator, ctx *EvaluationFinalizeContext) (types.JsonValue, error)

	Status func(deterministic PathResult, probabilistic types.JsonValue) types.EvaluationResultStatus

	DescribeStochasticWork func(ctx *EvaluationContext, config any) *EvaluationWorkloadPlan
	MeasureStochasticWork  func(accumulator Accumulator) *EvaluationWorkloadMeasurement

	DiagnoseConfig func(ctx *EvaluationContext, config any) []types.EvaluationDiagnostic
}

// KindOrDefault resolves the zero value to reader.
func (d *EvaluationDefinition) KindOrDefault() EvaluationKind {
	if d == nil || d.Kind == "" {
		return EvaluationKindReader
	}
	return d.Kind
}

// IsSimulator reports explicit simulator opt-in: Kind simulator plus the flag.
func (d *EvaluationDefinition) IsSimulator() bool {
	return d != nil && d.Kind == EvaluationKindSimulator && d.AllowSimulation
}

// EvaluationRegistry holds registered definitions keyed by type.
type EvaluationRegistry struct {
	definitions map[string]*EvaluationDefinition
	order       []string
}

// NewEvaluationRegistry creates an empty registry.
func NewEvaluationRegistry() *EvaluationRegistry {
	return &EvaluationRegistry{definitions: map[string]*EvaluationDefinition{}}
}

// Register adds a definition; duplicate registration panics. Simulator opt-in
// requires both Kind simulator and AllowSimulation; one without the other
// panics so a resimulating evaluator can never register by accident.
func (r *EvaluationRegistry) Register(definition *EvaluationDefinition) {
	if _, exists := r.definitions[definition.Type]; exists {
		panic(fmt.Sprintf("Evaluation definition %q is already registered.", definition.Type))
	}
	if definition.Kind == EvaluationKindSimulator && !definition.AllowSimulation {
		panic(fmt.Sprintf("Evaluation definition %q selects Kind simulator without AllowSimulation.", definition.Type))
	}
	r.definitions[definition.Type] = definition
	r.order = append(r.order, definition.Type)
	sort.Strings(r.order) // keep deterministic iteration; type order comes from tables
}

// Validate reports misconfigured definitions without mutating the registry.
func (r *EvaluationRegistry) Validate() error {
	for _, evaluationType := range r.order {
		definition := r.definitions[evaluationType]
		if definition.Kind == EvaluationKindSimulator && !definition.AllowSimulation {
			return fmt.Errorf("Evaluation definition %q selects Kind simulator without AllowSimulation.", evaluationType)
		}
	}
	return nil
}

// Get returns the definition for a type, if registered.
func (r *EvaluationRegistry) Get(evaluationType string) (*EvaluationDefinition, bool) {
	definition, ok := r.definitions[evaluationType]
	return definition, ok
}

// List returns registered type/name pairs.
func (r *EvaluationRegistry) List() []struct{ Type, Name string } {
	out := make([]struct{ Type, Name string }, 0, len(r.order))
	for _, evaluationType := range r.order {
		out = append(out, struct{ Type, Name string }{evaluationType, r.definitions[evaluationType].Name})
	}
	return out
}

// readerSimGuard counts active reader EvaluatePath calls. While
// nonzero, the simulation entry points below refuse to run: a reader
// must answer from the cached path, never rerun the base simulation.
// readerSimEval names the guarded evaluation for diagnostics.
var readerSimGuard int32
var readerSimEvalMu sync.Mutex
var readerSimEval string

// simulatorSimDepth counts in-flight simulator EvaluatePath calls.
// Simulators run simulations by design, so their resimulation never counts
// as a reader violation even when a concurrent request holds the reader
// guard above: the guard is process-global while requests evaluate
// concurrently (base and eval-overlay requests from one page overlap).
var simulatorSimDepth int32

// orchestratorSimDepth counts in-flight orchestrator simulations: the base
// path builder and the stochastic sample projector. Simulation is concurrent
// by design (sample workers run while the coordinator evaluates), so the
// resimulation refusal below exempts orchestrator-initiated runs and
// simulator evaluations, and only fires for simulation entered from inside
// a guarded reader evaluation with no orchestrator simulation or simulator
// evaluation in flight.
var orchestratorSimDepth int32

func readerSimulationBlocked() (string, bool) {
	if atomic.LoadInt32(&readerSimGuard) == 0 {
		return "", false
	}
	if atomic.LoadInt32(&orchestratorSimDepth) > 0 {
		return "", false
	}
	if atomic.LoadInt32(&simulatorSimDepth) > 0 {
		return "", false
	}
	readerSimEvalMu.Lock()
	defer readerSimEvalMu.Unlock()
	return readerSimEval, true
}

// withOrchestratorSim marks fn as an orchestrator-initiated simulation run.
func withOrchestratorSim(fn func()) {
	atomic.AddInt32(&orchestratorSimDepth, 1)
	defer atomic.AddInt32(&orchestratorSimDepth, -1)
	fn()
}

// orchestratedPrepare runs PrepareSimulationRequest as an orchestrator: the
// base path builder and the stochastic sampler simulate concurrently with
// evaluation by design, so their runs never count as reader violations.
func orchestratedPrepare(document *types.FinancialModelDocument, settings *types.ProjectionRuntimeSettings, overrides types.ModelOverrides, monteCarloSample *types.MonteCarloSample) (prepared *types.PreparedProjection, err error) {
	withOrchestratorSim(func() {
		prepared, err = PrepareSimulationRequest(document, settings, overrides, monteCarloSample)
	})
	return prepared, err
}

// orchestratedSimulate runs Simulate as an orchestrator (see above).
func orchestratedSimulate(request types.SimulationRequest) (run types.SimulationRun, err error) {
	withOrchestratorSim(func() {
		run, err = Simulate(request)
	})
	return run, err
}

// requireResimulationAllowed reports a violation when a reader
// evaluation attempts to rerun the base simulation.
//
// The guard counters are process-wide, so concurrent requests interleave:
// a simulator branch in one request may start while another request holds
// a short reader window. Reader windows are brief by contract (readers
// answer from the cached path), so a blocked simulation waits briefly and
// retries instead of failing at once. A genuine violation nests in the
// same call stack, so the guard never clears and the call still fails
// after the bound, preserving the diagnostic.
//
// resimGuardTries and resimGuardPause bound that wait. Tests shrink them;
// production keeps the default 50x20ms (~1s ceiling).
var resimGuardTries = 50
var resimGuardPause = 20 * time.Millisecond

func requireResimulationAllowed(caller string) error {
	tries := resimGuardTries
	if tries < 1 {
		tries = 1
	}
	firstEval := ""
	for attempt := 0; attempt < tries; attempt++ {
		if evalType, blocked := readerSimulationBlocked(); blocked {
			if firstEval == "" {
				firstEval = evalType
			}
			if attempt+1 == tries {
				return fmt.Errorf("reader evaluation %q must not rerun the base simulation via %s; mark Kind=simulator with explicit opt-in to run simulations", firstEval, caller)
			}
			time.Sleep(resimGuardPause)
			continue
		}
		return nil
	}
	return nil
}

// withReaderGuard runs fn with resimulation refused when the definition
// is a reader (the default). Simulator evaluations run unguarded and mark
// their own depth so concurrent readers in other requests never block them.
func withReaderGuard(definition *EvaluationDefinition, evalType string, fn func() (PathResult, error)) (PathResult, error) {
	if definition.IsSimulator() {
		atomic.AddInt32(&simulatorSimDepth, 1)
		defer atomic.AddInt32(&simulatorSimDepth, -1)
		return fn()
	}
	readerSimEvalMu.Lock()
	readerSimEval = evalType
	readerSimEvalMu.Unlock()
	atomic.AddInt32(&readerSimGuard, 1)
	defer atomic.AddInt32(&readerSimGuard, -1)
	return fn()
}

type instanceRuntime struct {
	evaluationType string
	configuredRaw  any // one of *types.FIEvaluation etc.
	sourceConfig   any // raw configured value, for per-kind cache keys
	instanceID     string
	name           string
	enabled        bool
	definition     *EvaluationDefinition
	diagnostics    []types.EvaluationDiagnostic

	deterministic    PathResult
	probabilistic    types.JsonValue
	accumulator      Accumulator
	stochasticFailed bool
	workloadPlan     *EvaluationWorkloadPlan
}

func (r *instanceRuntime) hasErrors() bool {
	for _, diagnostic := range r.diagnostics {
		if diagnostic.Severity == "error" {
			return true
		}
	}
	return false
}

func errorDiagnostic(code string, err error) types.EvaluationDiagnostic {
	return types.EvaluationDiagnostic{Code: code, Severity: "error", Message: err.Error()}
}

func (r *instanceRuntime) evaluateDeterministic(ctx *EvaluationContext) {
	if r.definition == nil || r.hasErrors() {
		return
	}
	if r.definition.DiagnoseConfig != nil {
		r.diagnostics = append(r.diagnostics, r.definition.DiagnoseConfig(ctx, r.configuredRaw)...)
	}
	result, err := withReaderGuard(r.definition, r.evaluationType, func() (PathResult, error) {
		return r.definition.EvaluatePath(ctx, r.configuredRaw)
	})
	if err != nil {
		r.diagnostics = append(r.diagnostics, errorDiagnostic("evaluation-runtime-error", err))
		return
	}
	r.deterministic = result
}

func (r *instanceRuntime) prepareStochasticWork(ctx *EvaluationContext) {
	if r.definition == nil || r.hasErrors() {
		return
	}
	if r.definition.DescribeStochasticWork == nil {
		return
	}
	r.workloadPlan = r.definition.DescribeStochasticWork(ctx, r.configuredRaw)
}

func (r *instanceRuntime) startStochastic(configuredConfig any) {
	if r.definition == nil || r.deterministic == nil || r.hasErrors() {
		return
	}
	accumulator, err := r.definition.CreateAccumulator(configuredConfig, r.deterministic)
	if err != nil {
		r.stochasticFailed = true
		r.diagnostics = append(r.diagnostics, errorDiagnostic("evaluation-accumulator-error", err))
		return
	}
	r.accumulator = accumulator
}

func (r *instanceRuntime) consume(ctx *EvaluationContext) {
	if r.definition == nil || r.accumulator == nil || r.stochasticFailed {
		return
	}
	pathResult, err := withReaderGuard(r.definition, r.evaluationType, func() (PathResult, error) {
		return r.definition.EvaluatePath(ctx, r.configuredRaw)
	})
	if err == nil {
		err = r.definition.Accumulate(r.accumulator, pathResult)
	}
	if err != nil {
		r.stochasticFailed = true
		r.probabilistic = nil
		r.diagnostics = append(r.diagnostics, errorDiagnostic("evaluation-runtime-error", err))
	}
}

func (r *instanceRuntime) finalize(ctx *EvaluationFinalizeContext) {
	if r.definition == nil || r.accumulator == nil || r.stochasticFailed {
		return
	}
	result, err := r.definition.Finalize(r.accumulator, ctx)
	if err != nil {
		r.stochasticFailed = true
		r.probabilistic = nil
		r.diagnostics = append(r.diagnostics, errorDiagnostic("evaluation-finalize-error", err))
		return
	}
	r.probabilistic = result
}

func (r *instanceRuntime) workloadProgress(completedRuns, totalRuns int) *types.StochasticEvaluationWorkload {
	if r.workloadPlan == nil {
		return nil
	}
	var measurement *EvaluationWorkloadMeasurement
	if r.accumulator != nil && !r.stochasticFailed && r.definition.MeasureStochasticWork != nil {
		measurement = r.definition.MeasureStochasticWork(r.accumulator)
	}
	completedUnits := completedRuns * r.workloadPlan.UnitsPerRun
	if measurement != nil {
		completedUnits = measurement.UnitsCompleted
	}
	workload := &types.StochasticEvaluationWorkload{
		Type:           r.evaluationType,
		InstanceID:     r.instanceID,
		Name:           r.name,
		CompletedUnits: completedUnits,
		TotalUnits:     totalRuns * r.workloadPlan.UnitsPerRun,
		UnitLabel:      r.workloadPlan.UnitLabel,
		UnitAction:     r.workloadPlan.UnitAction,
	}
	if r.workloadPlan.IntensiveUnitLabel != "" {
		workload.IntensiveUnitLabel = r.workloadPlan.IntensiveUnitLabel
	}
	if r.workloadPlan.IntensiveUnitAction != "" {
		workload.IntensiveUnitAction = r.workloadPlan.IntensiveUnitAction
	}
	if measurement != nil {
		intensive := measurement.IntensiveUnitsCompleted
		workload.IntensiveUnitsCompleted = &intensive
	}
	if r.workloadPlan.Description != "" {
		workload.Description = r.workloadPlan.Description
	}
	return workload
}

func (r *instanceRuntime) envelope() types.EvaluationResultEnvelope {
	status := types.StatusIndeterminate
	if r.hasErrors() {
		status = types.StatusWarning
	} else if r.definition != nil {
		status = r.definition.Status(r.deterministic, r.probabilistic)
	}
	envelope := types.EvaluationResultEnvelope{
		InstanceID:    r.instanceID,
		Name:          r.name,
		Status:        status,
		Deterministic: nil,
		Probabilistic: r.probabilistic,
		Diagnostics:   ensureDiagnosticSlice(r.diagnostics),
	}
	if r.deterministic != nil {
		envelope.Deterministic = r.deterministic.ToJSON()
	}
	return envelope
}

// EvaluationRuntimeSet builds runtimes over configured evaluation tables.
type EvaluationRuntimeSet struct {
	runtimes []*instanceRuntime
}

type rawInstance struct {
	evaluationType string
	instanceID     string
	name           string
	enabled        bool
	rawConfig      any
}

func rawInstances(tables *types.EvaluationTables) []rawInstance {
	var instances []rawInstance
	appendTable := func(evaluationType string, items []types.EvaluationInstance[types.JsonValue]) {
		for _, item := range items {
			instances = append(instances, rawInstance{
				evaluationType: evaluationType,
				instanceID:     item.InstanceID,
				name:           item.Name,
				enabled:        item.Enabled,
				rawConfig:      item.Config,
			})
		}
	}
	for _, table := range tables.Tables() {
		appendTable(table.Type, *table.Rows)
	}
	return instances
}

// NewEvaluationRuntimeSet creates a runtime set from evaluation tables.
func NewEvaluationRuntimeSet(tables *types.EvaluationTables, registry *EvaluationRegistry) *EvaluationRuntimeSet {
	instances := rawInstances(tables)
	idCounts := map[string]int{}
	for _, instance := range instances {
		idCounts[instance.instanceID]++
	}
	set := &EvaluationRuntimeSet{}
	seenIDs := map[string]bool{}
	for _, instance := range instances {
		if seenIDs[instance.instanceID] {
			continue
		}
		seenIDs[instance.instanceID] = true
		runtimeInstance := &instanceRuntime{
			evaluationType: instance.evaluationType,
			configuredRaw:  instance.rawConfig,
			sourceConfig:   instance.rawConfig,
			instanceID:     instance.instanceID,
			name:           instance.name,
			enabled:        instance.enabled,
		}
		if strings.TrimSpace(instance.instanceID) == "" || idCounts[instance.instanceID] > 1 {
			message := fmt.Sprintf("Evaluation instance ID %q is duplicated.", instance.instanceID)
			if strings.TrimSpace(instance.instanceID) == "" {
				message = "Evaluation instance ID is required."
			}
			runtimeInstance.diagnostics = append(runtimeInstance.diagnostics, types.EvaluationDiagnostic{
				Code:     "duplicate-evaluation-instance-id",
				Severity: "error",
				Message:  message,
			})
			set.runtimes = append(set.runtimes, runtimeInstance)
			continue
		}
		if !instance.enabled {
			runtimeInstance.diagnostics = append(runtimeInstance.diagnostics, types.EvaluationDiagnostic{
				Code:     "evaluation-disabled",
				Severity: "info",
				Message:  "Evaluation is disabled.",
			})
			set.runtimes = append(set.runtimes, runtimeInstance)
			continue
		}
		definition, ok := registry.Get(instance.evaluationType)
		if !ok {
			runtimeInstance.diagnostics = append(runtimeInstance.diagnostics, types.EvaluationDiagnostic{
				Code:     "unknown-evaluation-definition",
				Severity: "error",
				Message:  fmt.Sprintf("No evaluator is registered for %q.", instance.evaluationType),
			})
			set.runtimes = append(set.runtimes, runtimeInstance)
			continue
		}
		parsedConfig, err := definition.ParseConfig(instance.rawConfig)
		if err != nil {
			runtimeInstance.diagnostics = append(runtimeInstance.diagnostics, errorDiagnostic("invalid-evaluation-config", err))
			set.runtimes = append(set.runtimes, runtimeInstance)
			continue
		}
		runtimeInstance.definition = definition
		runtimeInstance.configuredRaw = parsedConfig
		set.runtimes = append(set.runtimes, runtimeInstance)
	}
	return set
}

// PartitionByKind splits a fully built runtime set into reader and simulator
// subsets, preserving global ID validation and relative order. Only runtimes
// with an explicit simulator definition run simulations; everything else —
// readers, disabled instances, unknown types, and invalid configs — stays on
// the reader side, which never resimulates.
func (s *EvaluationRuntimeSet) PartitionByKind() (readers, simulators *EvaluationRuntimeSet) {
	readers = &EvaluationRuntimeSet{}
	simulators = &EvaluationRuntimeSet{}
	for _, runtimeInstance := range s.runtimes {
		if runtimeInstance.definition != nil && runtimeInstance.definition.IsSimulator() {
			simulators.runtimes = append(simulators.runtimes, runtimeInstance)
			continue
		}
		readers.runtimes = append(readers.runtimes, runtimeInstance)
	}
	return readers, simulators
}

// MergeEvaluationResultCollections combines per-kind collections in full-set
// order. Each evaluation type belongs to one definition kind, so rows never
// interleave; a reader-side diagnostic (disabled, unknown, or invalid
// simulator config) keeps its global position among that table's rows.
func MergeEvaluationResultCollections(set *EvaluationRuntimeSet, reader, simulator *types.EvaluationResultCollection) *types.EvaluationResultCollection {
	merged := &types.EvaluationResultCollection{
		Evaluations: types.EvaluationResultTables{
			FinancialIndependence: []types.EvaluationResultEnvelope{},
			NetWorthThreshold:     []types.EvaluationResultEnvelope{},
			AccountBalance:        []types.EvaluationResultEnvelope{},
			PostingFulfillment:    []types.EvaluationResultEnvelope{},
			CycleFulfillment:      []types.EvaluationResultEnvelope{},
			// PlannedPurchases stays nil when empty: Result() appends per
			// registered instance, and nil-vs-empty matters to DeepEqual
			// callers that strip the table before comparing baselines.
		},
	}
	byID := map[string]types.EvaluationResultEnvelope{}
	for _, collection := range []*types.EvaluationResultCollection{reader, simulator} {
		if collection == nil {
			continue
		}
		for _, table := range collection.Evaluations.Tables() {
			for _, envelope := range *table.Rows {
				byID[envelope.InstanceID] = envelope
			}
		}
	}
	for _, runtimeInstance := range set.runtimes {
		envelope, ok := byID[runtimeInstance.instanceID]
		if !ok {
			continue
		}
		rows := merged.Evaluations.ByType(runtimeInstance.evaluationType)
		if rows == nil {
			continue
		}
		*rows = append(*rows, envelope)
	}
	return merged
}

// EvaluateDeterministic runs all enabled evaluators once over the path.
func (s *EvaluationRuntimeSet) EvaluateDeterministic(ctx *EvaluationContext) {
	for _, runtimeInstance := range s.runtimes {
		runtimeInstance.evaluateDeterministic(ctx)
	}
}

// PrepareStochasticWork captures workload plans from evaluators.
func (s *EvaluationRuntimeSet) PrepareStochasticWork(ctx *EvaluationContext) {
	for _, runtimeInstance := range s.runtimes {
		runtimeInstance.prepareStochasticWork(ctx)
	}
}

// StartStochastic creates accumulators for enabled evaluators.
func (s *EvaluationRuntimeSet) StartStochastic() {
	for _, runtimeInstance := range s.runtimes {
		runtimeInstance.startStochastic(runtimeInstance.configuredRaw)
	}
}

// Consume feeds a sampled path into accumulators.
func (s *EvaluationRuntimeSet) Consume(ctx *EvaluationContext) {
	for _, runtimeInstance := range s.runtimes {
		runtimeInstance.consume(ctx)
	}
}

// Finalize completes stochastic aggregation.
func (s *EvaluationRuntimeSet) Finalize(ctx *EvaluationFinalizeContext) {
	for _, runtimeInstance := range s.runtimes {
		runtimeInstance.finalize(ctx)
	}
}

// WorkloadProgress returns progress entries for workload-planned evaluators.
func (s *EvaluationRuntimeSet) WorkloadProgress(completedRuns, totalRuns int) []types.StochasticEvaluationWorkload {
	out := []types.StochasticEvaluationWorkload{}
	for _, runtimeInstance := range s.runtimes {
		if progress := runtimeInstance.workloadProgress(completedRuns, totalRuns); progress != nil {
			out = append(out, *progress)
		}
	}
	return out
}

// Result collects envelopes into ordered result tables.
func (s *EvaluationRuntimeSet) Result() types.EvaluationResultCollection {
	collection := types.EvaluationResultCollection{
		Evaluations: types.EvaluationResultTables{
			FinancialIndependence: []types.EvaluationResultEnvelope{},
			NetWorthThreshold:     []types.EvaluationResultEnvelope{},
			AccountBalance:        []types.EvaluationResultEnvelope{},
			PostingFulfillment:    []types.EvaluationResultEnvelope{},
			CycleFulfillment:      []types.EvaluationResultEnvelope{},
			// PlannedPurchases stays nil when empty: Result() appends per
			// registered instance, and nil-vs-empty matters to DeepEqual
			// callers that strip the table before comparing baselines.
		},
	}
	for _, table := range collection.Evaluations.Tables() {
		for _, runtimeInstance := range s.runtimes {
			if runtimeInstance.evaluationType == table.Type {
				*table.Rows = append(*table.Rows, runtimeInstance.envelope())
			}
		}
	}
	return collection
}

func ensureDiagnosticSlice(diagnostics []types.EvaluationDiagnostic) []types.EvaluationDiagnostic {
	if diagnostics == nil {
		return []types.EvaluationDiagnostic{}
	}
	return diagnostics
}
