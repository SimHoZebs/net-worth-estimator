package domain

import (
	"fmt"
	"sort"

	"github.com/simhozebs/net-worth-estimator/backend/internal/types"
)

// Evaluation runtime ported from evaluation/runtime.ts. Definitions register
// by type; central coordinators never import evaluator-specific logic.

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

// EvaluationWorkloadPlan describes stochastic work units for progress UI.
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
	Type  string
	Label string

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

// EvaluationRegistry holds registered definitions keyed by type.
type EvaluationRegistry struct {
	definitions map[string]*EvaluationDefinition
	order       []string
}

// NewEvaluationRegistry creates an empty registry.
func NewEvaluationRegistry() *EvaluationRegistry {
	return &EvaluationRegistry{definitions: map[string]*EvaluationDefinition{}}
}

// Register adds a definition; duplicate registration panics.
func (r *EvaluationRegistry) Register(definition *EvaluationDefinition) {
	if _, exists := r.definitions[definition.Type]; exists {
		panic(fmt.Sprintf("Evaluation definition %q is already registered.", definition.Type))
	}
	r.definitions[definition.Type] = definition
	r.order = append(r.order, definition.Type)
	sort.Strings(r.order) // keep deterministic iteration; type order comes from tables
}

// Get returns the definition for a type, if registered.
func (r *EvaluationRegistry) Get(evaluationType string) (*EvaluationDefinition, bool) {
	definition, ok := r.definitions[evaluationType]
	return definition, ok
}

// List returns registered type/label pairs.
func (r *EvaluationRegistry) List() []struct{ Type, Label string } {
	out := make([]struct{ Type, Label string }, 0, len(r.order))
	for _, evaluationType := range r.order {
		out = append(out, struct{ Type, Label string }{evaluationType, r.definitions[evaluationType].Label})
	}
	return out
}

type instanceRuntime struct {
	evaluationType string
	configuredRaw  any // one of *types.FIEvaluation etc.
	instanceID     string
	label          string
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
	result, err := r.definition.EvaluatePath(ctx, r.configuredRaw)
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
	pathResult, err := r.definition.EvaluatePath(ctx, r.configuredRaw)
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
		Label:          r.label,
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
		Label:         r.label,
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
	label          string
	enabled        bool
	rawConfig      any
}

func rawInstances(tables *types.EvaluationTables) []rawInstance {
	var instances []rawInstance
	for _, item := range tables.FinancialIndependence {
		instances = append(instances, rawInstance{
			evaluationType: types.EvaluationTypeFinancialIndependence,
			instanceID:     item.InstanceID,
			label:          item.Label,
			enabled:        item.Enabled,
			rawConfig:      item.Config,
		})
	}
	for _, item := range tables.NetWorthThreshold {
		instances = append(instances, rawInstance{
			evaluationType: types.EvaluationTypeNetWorthThreshold,
			instanceID:     item.InstanceID,
			label:          item.Label,
			enabled:        item.Enabled,
			rawConfig:      item.Config,
		})
	}
	for _, item := range tables.PostingFulfillment {
		instances = append(instances, rawInstance{
			evaluationType: types.EvaluationTypePostingFulfillment,
			instanceID:     item.InstanceID,
			label:          item.Label,
			enabled:        item.Enabled,
			rawConfig:      item.Config,
		})
	}
	return instances
}

// NewEvaluationRuntimeSet mirrors the constructor logic of EvaluationRuntimeSet.
func NewEvaluationRuntimeSet(tables *types.EvaluationTables, registry *EvaluationRegistry) *EvaluationRuntimeSet {
	idCounts := map[string]int{}
	for _, instance := range rawInstances(tables) {
		idCounts[instance.instanceID]++
	}
	set := &EvaluationRuntimeSet{}
	seenIDs := map[string]bool{}
	for _, instance := range rawInstances(tables) {
		if seenIDs[instance.instanceID] {
			continue
		}
		seenIDs[instance.instanceID] = true
		runtimeInstance := &instanceRuntime{
			evaluationType: instance.evaluationType,
			configuredRaw:  instance.rawConfig,
			instanceID:     instance.instanceID,
			label:          instance.label,
		}
		if trimSpace(instance.instanceID) == "" || idCounts[instance.instanceID] > 1 {
			message := fmt.Sprintf("Evaluation instance ID %q is duplicated.", instance.instanceID)
			if trimSpace(instance.instanceID) == "" {
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
			PostingFulfillment:    []types.EvaluationResultEnvelope{},
		},
	}
	for _, runtimeInstance := range s.runtimes {
		switch runtimeInstance.evaluationType {
		case types.EvaluationTypeFinancialIndependence:
			collection.Evaluations.FinancialIndependence = append(collection.Evaluations.FinancialIndependence, runtimeInstance.envelope())
		case types.EvaluationTypeNetWorthThreshold:
			collection.Evaluations.NetWorthThreshold = append(collection.Evaluations.NetWorthThreshold, runtimeInstance.envelope())
		case types.EvaluationTypePostingFulfillment:
			collection.Evaluations.PostingFulfillment = append(collection.Evaluations.PostingFulfillment, runtimeInstance.envelope())
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
