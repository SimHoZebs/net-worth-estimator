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
// untouched. Every evaluator extends the generic Evaluator and falls under
// one of two subtypes — ReaderDefinition or SimulatorDefinition — chosen at
// registration. Core hooks are shared: ParseConfig parses once and returns
// a typed config or error; EvaluatePath answers over one path; Accumulate
// plus Finalize aggregate sampled paths; Status drives the UI verdict.
// The subtypes differ only in simulation permission: a reader answers from
// the cached path and never simulates; a simulator runs branch simulations
// against shared base path state and needs DescribeStochasticWork and
// MeasureStochasticWork for progress. NewReachedDateReader builds the
// reached-date reader family; NewReachedDateSimulator builds the same shape
// as a simulator (purchases).
//
// Simulation contract: rerunning the base simulation is NOT the default.
// Reader evaluations run against the cached ProjectionPath shared by all
// evaluations; while a reader EvaluatePath runs, PrepareSimulationRequest,
// Simulate, simulateScheduled, and simulatePurchases refuse to run and report
// a reader violation. Simulator evaluations (purchases, FI) reuse the shared
// base path state and run simulations only — never a fresh Prepare per eval.
// There is no runtime split: one EvaluationRuntimeSet evaluates every
// evaluator in input order with one context; the guard is per-instance.

// EvaluationContext is passed to every evaluation hook.
type EvaluationContext struct {
	Path             *types.ProjectionPath
	Model            *types.FinancialModel
	MonteCarloSample *types.MonteCarloSample
	Timeline         *types.EvaluationTimeline
	DetailLevel      string // "detailed" | "summary"
	// DirtyFrom is the inclusive ISO date from which the projection was
	// dirtied (empty = clean / unknown). Evaluators with declared
	// Dependents may skip when their window excludes the dirty suffix.
	DirtyFrom string
	// ChangedAccountIDs / ChangedTransactionIDs name the rows touched by the
	// edit that dirtied the projection. Evaluators whose Dependents.AccountIDs
	// do not intersect this set may skip.
	ChangedAccountIDs     []string
	ChangedTransactionIDs []string
}

// GetTimeline returns a source-agnostic timeline for deterministic readers.
// Callers may supply Timeline directly (projected or historical); otherwise
// it is derived from Path. Stochastic hooks keep using Path/MonteCarloSample.
func (c *EvaluationContext) GetTimeline() *types.EvaluationTimeline {
	if c == nil {
		return nil
	}
	if c.Timeline != nil {
		return c.Timeline
	}
	return types.TimelineFromPath(c.Path)
}

// EvaluationDependents declares the evaluator's dependency window. FromDate
// is the earliest date inspected; AccountIDs and TransactionIDs narrow to
// specific accounts/transactions. Nil means depends on nothing (default).
// Shipped evaluators declare DependsOnEverything() explicitly so reruns are
// never silently skipped.
type EvaluationDependents struct {
	AccountIDs     []string
	TransactionIDs []string
	FromDate       types.IsoDate
}

func DependsOnEverything() *EvaluationDependents { return &EvaluationDependents{} }

// EvaluationFinalizeContext is passed to stochastic finalization.
type EvaluationFinalizeContext struct {
	Model             *types.FinancialModel
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

// Evaluator is the generic base every evaluator extends. The runtime and
// the registry hold Definitions; each definition embeds one Evaluator.
// All evaluators share the deterministic and accumulation hooks; the
// Reader vs Simulator subtype alone decides simulation permission.
type Evaluator struct {
	Type string
	Name string

	// RequiresProjectionPath declares whether the evaluator needs a
	// non-nil ctx.Path. Nil means required (zero-value safe, preserves
	// behavior for all existing definitions). Future projection-free
	// evaluations opt out explicitly; existing evaluators stay required.
	RequiresProjectionPath *bool

	ValidateConfig func(config any) error
	ParseConfig    func(config any) (any, error)

	EvaluatePath func(ctx *EvaluationContext, config any) (PathResult, error)

	// Dependents declares the evaluator's dependency window. Nil means
	// depends on NOTHING so omission never silently becomes "everything".
	// Every shipped evaluator must declare non-nil to guarantee reruns when
	// shared state changes. Validate enforces this at registration.
	Dependents func(ctx *EvaluationContext, config any) *EvaluationDependents

	Status func(deterministic PathResult, probabilistic types.JsonValue) types.EvaluationResultStatus

	DiagnoseConfig func(ctx *EvaluationContext, config any) []types.EvaluationDiagnostic

	// Accumulation hooks aggregate sampled paths into a probabilistic
	// result. Both subtypes use them; they do not imply simulation.
	CreateAccumulator func(config any, deterministicResult PathResult) (Accumulator, error)
	Accumulate        func(accumulator Accumulator, pathResult PathResult) error
	Finalize          func(accumulator Accumulator, ctx *EvaluationFinalizeContext) (types.JsonValue, error)

	DescribeStochasticWork func(ctx *EvaluationContext, config any) *EvaluationWorkloadPlan
	MeasureStochasticWork  func(accumulator Accumulator) *EvaluationWorkloadMeasurement
}

// Definition is the registered form of an evaluator: one generic Evaluator
// wrapped by exactly one subtype. The runtime set holds every Definition in
// a single slice and evaluates them in input order.
type Definition interface {
	IsSimulator() bool
	NeedsProjectionPath() bool
	Base() *Evaluator
}

// ReaderDefinition is an Evaluator that answers from the cached path.
// It never simulates.
type ReaderDefinition struct {
	Evaluator
}

func (r *ReaderDefinition) Base() *Evaluator {
	if r == nil {
		return nil
	}
	return &r.Evaluator
}

func (r *ReaderDefinition) IsSimulator() bool { return false }

func (r *ReaderDefinition) NeedsProjectionPath() bool {
	if r == nil {
		return true
	}
	return r.Evaluator.NeedsProjectionPath()
}

// SimulatorDefinition is an Evaluator that runs branch simulations
// against shared base path state.
type SimulatorDefinition struct {
	Evaluator
}

func (s *SimulatorDefinition) Base() *Evaluator {
	if s == nil {
		return nil
	}
	return &s.Evaluator
}

func (s *SimulatorDefinition) IsSimulator() bool { return true }

func (s *SimulatorDefinition) NeedsProjectionPath() bool {
	if s == nil {
		return true
	}
	return s.Evaluator.NeedsProjectionPath()
}

// NeedsProjectionPath reports whether the evaluator requires a non-nil path.
// Nil or unspecified means required (preserves behavior for all existing evaluators).
func (d *Evaluator) NeedsProjectionPath() bool {
	if d == nil || d.RequiresProjectionPath == nil {
		return true
	}
	return *d.RequiresProjectionPath
}

// EvaluationRegistry holds registered definitions keyed by type.
type EvaluationRegistry struct {
	definitions map[string]Definition
	order       []string
}

// NewEvaluationRegistry creates an empty registry.
func NewEvaluationRegistry() *EvaluationRegistry {
	return &EvaluationRegistry{definitions: map[string]Definition{}}
}

// Register adds a definition; duplicate registration panics. The definition
// must be a ReaderDefinition or a SimulatorDefinition extending the generic
// Evaluator; a bare Evaluator cannot register.
func (r *EvaluationRegistry) Register(definition Definition) {
	base := definition.Base()
	evaluationType := ""
	if base != nil {
		evaluationType = base.Type
	}
	if _, exists := r.definitions[evaluationType]; exists {
		panic(fmt.Sprintf("Evaluation definition %q is already registered.", evaluationType))
	}
	if base == nil || base.Dependents == nil {
		panic(fmt.Sprintf("Evaluation definition %q must declare Dependents (nil means depends on nothing).", evaluationType))
	}
	r.definitions[evaluationType] = definition
	r.order = append(r.order, evaluationType)
	sort.Strings(r.order) // keep deterministic iteration; type order comes from tables
}

// Validate reports misconfigured definitions without mutating the registry.
func (r *EvaluationRegistry) Validate() error {
	for _, evaluationType := range r.order {
		base := r.definitions[evaluationType].Base()
		if base == nil || base.Dependents == nil {
			return fmt.Errorf("Evaluation definition %q must declare Dependents (nil means depends on nothing).", evaluationType)
		}
	}
	return nil
}

// Get returns the definition for a type, if registered.
func (r *EvaluationRegistry) Get(evaluationType string) (Definition, bool) {
	definition, ok := r.definitions[evaluationType]
	return definition, ok
}

// List returns registered type/name pairs.
func (r *EvaluationRegistry) List() []struct{ Type, Name string } {
	out := make([]struct{ Type, Name string }, 0, len(r.order))
	for _, evaluationType := range r.order {
		base := r.definitions[evaluationType].Base()
		name := ""
		if base != nil {
			name = base.Name
		}
		out = append(out, struct{ Type, Name string }{evaluationType, name})
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
func orchestratedPrepare(model *types.FinancialModel, settings *types.ProjectionRuntimeSettings, overrides types.ModelOverrides, monteCarloSample *types.MonteCarloSample) (prepared *types.PreparedProjection, err error) {
	withOrchestratorSim(func() {
		prepared, err = PrepareSimulationRequest(model, settings, overrides, monteCarloSample)
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
				return fmt.Errorf("reader evaluation %q must not rerun the base simulation via %s; register as SimulatorDefinition to run simulations", firstEval, caller)
			}
			time.Sleep(resimGuardPause)
			continue
		}
		return nil
	}
	return nil
}

// withReaderGuard runs fn with resimulation refused when the definition
// is a reader. Simulator evaluations run unguarded and mark their own
// depth so concurrent readers in other requests never block them.
func withReaderGuard(definition Definition, evalType string, fn func() (PathResult, error)) (PathResult, error) {
	if definition != nil && definition.IsSimulator() {
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
	definition     Definition
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
	if r.definition.Base().NeedsProjectionPath() && ctx.GetTimeline() == nil {
		r.diagnostics = append(r.diagnostics, types.EvaluationDiagnostic{
			Code:     "projection-unavailable",
			Severity: "info",
			Message:  "Projection data is unavailable for this evaluation.",
		})
		return
	}
	// Nil Dependents means depends on nothing. When a dirty marker is present,
	// the evaluator is skipped instead of recomputing. Cold evaluations
	// (no dirty marker) always run so a fresh evaluator still produces output.
	if r.definition.Base().Dependents == nil && ctx.DirtyFrom != "" {
		r.diagnostics = append(r.diagnostics, types.EvaluationDiagnostic{
			Code:     "evaluation-skipped",
			Severity: "info",
			Message:  "Skipped; no Dependents declared (nil means depends on nothing).",
		})
		return
	}
	if r.definition.Base().Dependents != nil && ctx.DirtyFrom != "" {
		deps := r.definition.Base().Dependents(ctx, r.configuredRaw)
		if deps == nil {
			r.diagnostics = append(r.diagnostics, types.EvaluationDiagnostic{
				Code:     "evaluation-skipped",
				Severity: "info",
				Message:  "Skipped; Dependents declares no affected window.",
			})
			return
		}
		if deps.FromDate != "" && deps.FromDate > types.IsoDate(ctx.DirtyFrom) {
			// Dirty suffix is after the evaluator's earliest interest date and
			// no overlap: reader can keep its stored envelope (skip).
			// Timeline window check is conservative: if Timeline.StartDate is
			// already after DirtyFrom, skip; else run.
			if tl := ctx.GetTimeline(); tl != nil && tl.StartDate < types.IsoDate(ctx.DirtyFrom) {
				r.diagnostics = append(r.diagnostics, types.EvaluationDiagnostic{
					Code:     "evaluation-skipped",
					Severity: "info",
					Message:  "Skipped; dependents window excludes dirty suffix.",
				})
				return
			}
		}
		if len(deps.AccountIDs) > 0 && len(ctx.ChangedAccountIDs) > 0 {
			intersects := false
			changed := map[string]bool{}
			for _, id := range ctx.ChangedAccountIDs {
				changed[id] = true
			}
			for _, id := range deps.AccountIDs {
				if changed[id] {
					intersects = true
					break
				}
			}
			if !intersects {
				r.diagnostics = append(r.diagnostics, types.EvaluationDiagnostic{
					Code:     "evaluation-skipped",
					Severity: "info",
					Message:  "Skipped; dependents accounts exclude changed accounts.",
				})
				return
			}
		}
		if len(deps.TransactionIDs) > 0 && len(ctx.ChangedTransactionIDs) > 0 {
			intersects := false
			changed := map[string]bool{}
			for _, id := range ctx.ChangedTransactionIDs {
				changed[id] = true
			}
			for _, id := range deps.TransactionIDs {
				if changed[id] {
					intersects = true
					break
				}
			}
			if !intersects {
				r.diagnostics = append(r.diagnostics, types.EvaluationDiagnostic{
					Code:     "evaluation-skipped",
					Severity: "info",
					Message:  "Skipped; dependents transactions exclude changed transactions.",
				})
				return
			}
		}
	}
	if r.definition.Base().DiagnoseConfig != nil {
		r.diagnostics = append(r.diagnostics, r.definition.Base().DiagnoseConfig(ctx, r.configuredRaw)...)
	}
	result, err := withReaderGuard(r.definition, r.evaluationType, func() (PathResult, error) {
		return r.definition.Base().EvaluatePath(ctx, r.configuredRaw)
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
	if r.definition.Base().NeedsProjectionPath() && ctx.GetTimeline() == nil {
		return
	}
	if r.definition.Base().DescribeStochasticWork == nil {
		return
	}
	r.workloadPlan = r.definition.Base().DescribeStochasticWork(ctx, r.configuredRaw)
}

func (r *instanceRuntime) startStochastic(configuredConfig any) {
	if r.definition == nil || r.deterministic == nil || r.hasErrors() {
		return
	}
	accumulator, err := r.definition.Base().CreateAccumulator(configuredConfig, r.deterministic)
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
	if r.definition.Base().NeedsProjectionPath() && ctx.GetTimeline() == nil {
		return
	}
	pathResult, err := withReaderGuard(r.definition, r.evaluationType, func() (PathResult, error) {
		return r.definition.Base().EvaluatePath(ctx, r.configuredRaw)
	})
	if err == nil {
		err = r.definition.Base().Accumulate(r.accumulator, pathResult)
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
	result, err := r.definition.Base().Finalize(r.accumulator, ctx)
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
	if r.accumulator != nil && !r.stochasticFailed && r.definition.Base().MeasureStochasticWork != nil {
		measurement = r.definition.Base().MeasureStochasticWork(r.accumulator)
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
		status = r.definition.Base().Status(r.deterministic, r.probabilistic)
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
		parsedConfig, err := definition.Base().ParseConfig(instance.rawConfig)
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
			FinancialIndependence:  []types.EvaluationResultEnvelope{},
			NetWorthThreshold:      []types.EvaluationResultEnvelope{},
			AccountBalance:         []types.EvaluationResultEnvelope{},
			TransactionFulfillment: []types.EvaluationResultEnvelope{},
			CycleFulfillment:       []types.EvaluationResultEnvelope{},
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
