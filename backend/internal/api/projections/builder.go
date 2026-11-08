package projections

import (
	"context"
	"crypto/rand"
	"encoding/binary"
	"encoding/json"
	"fmt"
	"math"
	"sort"
	"time"

	"golang.org/x/sync/singleflight"

	"github.com/simhozebs/net-worth-estimator/backend/internal/domain"
	"github.com/simhozebs/net-worth-estimator/backend/internal/store"
	"github.com/simhozebs/net-worth-estimator/backend/internal/types"
)

// Unified build and read orchestration: one canonical state per user.
// Slice validity is revision-scoped; the dirty date scopes the rewrite.

const unifiedEngineVersion = "v1"

// canonicalEvalJSON serializes evaluation tables in struct field order.
func canonicalEvalJSON(tables *types.EvaluationTables) (string, error) {
	encoded, err := json.Marshal(tables)
	if err != nil {
		return "", err
	}
	return string(encoded), nil
}

// yearlyBounds partitions [start, horizonEnd) into calendar-year slices.
func yearlyBounds(start, horizonEnd string) [][2]string {
	out := [][2]string{}
	from := start
	for from < horizonEnd {
		to := domain.AddYearsClamped(from, 1)
		if to <= from {
			break
		}
		if to > horizonEnd {
			to = horizonEnd
		}
		out = append(out, [2]string{from, to})
		from = to
	}
	return out
}

func midnightRFC3339(date string) string {
	return date + "T00:00:00Z"
}

// midnightUnix returns Unix seconds for UTC midnight of a calendar day. It
// uses the shared strict day check; an invalid day panics loudly instead of
// silently returning epoch 0.
func midnightUnix(date string) int64 {
	return domain.MustParseIsoDate(date).Unix()
}

// sliceForDate finds the slice whose [from, to) range contains the date.
// The horizon end equals the last slice's to_at and belongs to it.
func sliceForDate(slices []types.ProjectionSlice, date string) string {
	instant := midnightUnix(date)
	for _, slice := range slices {
		if slice.FromAt <= instant && instant < slice.ToAt {
			return slice.ID
		}
	}
	if len(slices) > 0 && instant == slices[len(slices)-1].ToAt {
		return slices[len(slices)-1].ID
	}
	return ""
}

// slicesCover reports whether slices partition [start, horizonEnd) exactly.
func slicesCover(slices []types.ProjectionSlice, start, horizonEnd string) bool {
	want := midnightUnix(start)
	end := midnightUnix(horizonEnd)
	for _, slice := range slices {
		if slice.FromAt != want {
			return false
		}
		want = slice.ToAt
	}
	return want == end
}

// ensureCanonicalState freezes the canonical window on first build and
// reports whether the request settings address it.
func (s *handler) ensureCanonicalState(settings *types.ProjectionRuntimeSettings) (types.ProjectionState, bool, error) {
	state, err := s.store.GetProjectionState()
	if err != nil {
		return state, false, err
	}
	if state.EngineVersion != unifiedEngineVersion {
		state, err = s.store.InitializeProjectionState("", "", "", unifiedEngineVersion)
		if err != nil {
			return state, false, err
		}
	}
	if state.ProjectionStart == "" {
		if settings.FallbackProjectionStartDate == "" {
			return state, false, fmt.Errorf("canonical state needs a fallback projection start date")
		}
		start := string(settings.FallbackProjectionStartDate)
		horizonEnd := domain.AddYearsClamped(start, settings.HorizonYears)
		state, err = s.store.InitializeProjectionState(start, horizonEnd, s.resourceID, unifiedEngineVersion)
		if err != nil {
			return state, false, err
		}
	}
	if settings.AsOfInstant != nil {
		return state, false, nil
	}
	if string(settings.FallbackProjectionStartDate) != state.ProjectionStart {
		return state, false, nil
	}
	if domain.AddYearsClamped(state.ProjectionStart, settings.HorizonYears) != state.HorizonEnd {
		return state, false, nil
	}
	return state, true, nil
}

// buildFlight shares one concurrent build per user.
var buildFlight singleflight.Group

// buildDeterministic computes the full window and persists the invalid suffix.
func (s *handler) buildDeterministic(model *types.FinancialModel, settings *types.ProjectionRuntimeSettings) error {
	_, err, _ := buildFlight.Do("det:"+s.resourceID, func() (any, error) {
		return nil, s.buildDeterministicLocked(model, settings)
	})
	return err
}

func (s *handler) buildDeterministicLocked(model *types.FinancialModel, settings *types.ProjectionRuntimeSettings) error {
	state, canonical, err := s.ensureCanonicalState(settings)
	if err != nil || !canonical {
		if err == nil {
			err = fmt.Errorf("settings do not address the canonical state")
		}
		return err
	}
	evalJSON, err := canonicalEvalJSON(&settings.Evaluations)
	if err != nil {
		return err
	}
	slices, err := s.store.ListProjectionSlices()
	if err != nil {
		return err
	}
	complete := state.DirtyFrom == 0 && slicesCover(slices, state.ProjectionStart, state.HorizonEnd) && currentRevision(slices, state.Revision)
	if complete && evalJSON == state.DetEvaluationsJSON {
		served, err := s.outputsSatisfy(state.ID, "deterministic", &settings.Evaluations, state.Revision)
		if err != nil {
			return err
		}
		if served {
			return nil
		}
	}
	if complete {
		// Clean with complete slices but stale outputs: persist outputs only.
		path, result, err := domain.ProjectWithPath(model, settings, types.ModelOverrides{}, nil)
		if err != nil {
			return err
		}
		_ = path
		if err := s.writeEvaluationOutputs(state.ID, "deterministic", result.Evaluations, state.Revision); err != nil {
			return err
		}
		return s.persistEvaluationFingerprint(state, evalJSON)
	}
	path, base, err := domain.ProjectRawFinancialModel(model, settings, types.ModelOverrides{}, nil)
	if err != nil {
		return err
	}
	result := *base
	result.Evaluations = domain.EvaluateProjectionPath(path, settings, nil)
	// Re-check the state before persisting: a concurrent model write wins.
	currentState, err := s.store.GetProjectionState()
	if err != nil {
		return err
	}
	if currentState.Revision != state.Revision || currentState.DirtyFrom != state.DirtyFrom {
		return fmt.Errorf("projection inputs changed while building; skipping the stale write")
	}
	prefix, suffix := suffixSlices(slices, state.DirtyFrom)
	if state.DirtyFrom > 0 && len(slices) > 0 && len(suffix) == 0 {
		// Dirty beyond the horizon: no projected date changes. Adopt the
		// manifest, refresh outputs, and clear the flag.
		if err := s.writeEvaluationOutputs(state.ID, "deterministic", result.Evaluations, state.Revision); err != nil {
			return err
		}
		if err := s.adoptSlices(prefix, state.Revision); err != nil {
			return err
		}
		if err := s.persistEvaluationFingerprint(state, evalJSON); err != nil {
			return err
		}
		_, err = s.store.PublishProjection(state.Revision)
		return err
	}
	suffixFrom := midnightUnix(state.ProjectionStart)
	if len(suffix) > 0 {
		suffixFrom = suffix[0].FromAt
	}
	suffixIDs := make([]string, 0, len(suffix))
	for _, slice := range suffix {
		suffixIDs = append(suffixIDs, slice.ID)
	}
	if err := s.deleteSliceRows(suffixIDs); err != nil {
		return err
	}
	// Per-type writers clear their own kind below; nothing to clear here.
	fresh, err := s.ensureSuffixManifest(state, suffixFrom)
	if err != nil {
		return err
	}
	byID := map[string]types.ProjectionSlice{}
	for _, slice := range fresh {
		byID[slice.ID] = slice
	}
	for _, slice := range prefix {
		byID[slice.ID] = slice
	}
	if err := s.writeDeterministicRows(path, result, byID, suffixFrom); err != nil {
		return err
	}
	if err := s.writeEvaluationOutputs(state.ID, "deterministic", result.Evaluations, state.Revision); err != nil {
		return err
	}
	if err := s.adoptSlices(prefix, state.Revision); err != nil {
		return err
	}
	if err := s.persistEvaluationFingerprint(state, evalJSON); err != nil {
		return err
	}
	_, err = s.store.PublishProjection(state.Revision)
	return err
}

// persistEvaluationFingerprint records the revision only while it is still stored.
func (s *handler) persistEvaluationFingerprint(state types.ProjectionState, evalJSON string) error {
	ok, err := s.store.SaveDeterministicEvaluations(state.ID, state.Revision, evalJSON)
	if err != nil {
		return err
	}
	if !ok {
		return fmt.Errorf("projection inputs changed while building; skipping the stale write")
	}
	return nil
}

// currentRevision reports whether every slice was built at the revision.
func currentRevision(slices []types.ProjectionSlice, revision int64) bool {
	if len(slices) == 0 {
		return false
	}
	for _, slice := range slices {
		if slice.BuiltRevision != revision {
			return false
		}
	}
	return true
}

// outputsSatisfy reports whether stored outputs cover the tables at the revision.
func (s *handler) outputsSatisfy(stateID, kind string, tables *types.EvaluationTables, revision int64) (bool, error) {
	_, served, err := s.assembleEvaluations(stateID, kind, tables, revision)
	return served, err
}

func suffixSlices(slices []types.ProjectionSlice, dirtyFrom int64) (prefix, suffix []types.ProjectionSlice) {
	index := domain.FindFirstInvalidSlice(slices, dirtyFrom)
	if index < 0 {
		return slices, nil
	}
	return slices[:index], slices[index:]
}

// adoptSlices carries prefix slices onto the current revision.
func (s *handler) adoptSlices(prefix []types.ProjectionSlice, revision int64) error {
	for _, slice := range prefix {
		if slice.BuiltRevision == revision {
			continue
		}
		slice.BuiltRevision = revision
		if _, err := s.store.SaveProjectionSlice(slice); err != nil {
			return err
		}
	}
	return nil
}

// deleteSliceRows removes generated transactions, checkpoints, timeline rows,
// and statistics for slices.
func (s *handler) deleteSliceRows(sliceIDs []string) error {
	if len(sliceIDs) == 0 {
		return nil
	}
	if err := s.store.DeleteGeneratedTransactions(sliceIDs); err != nil {
		return err
	}
	if err := s.store.DeleteProjectionRows(sliceIDs); err != nil {
		return err
	}
	return s.store.DeleteMonteCarloStatistics(sliceIDs)
}

// ensureSuffixManifest creates yearly slices for the suffix range.
func (s *handler) ensureSuffixManifest(state types.ProjectionState, fromUnix int64) ([]types.ProjectionSlice, error) {
	from := time.Unix(fromUnix, 0).UTC().Format("2006-01-02")
	bounds := yearlyBounds(from, state.HorizonEnd)
	out := make([]types.ProjectionSlice, 0, len(bounds))
	for _, bound := range bounds {
		id := state.ID + ":" + bound[0]
		slice, err := s.store.SaveProjectionSlice(types.ProjectionSlice{
			ID:                id,
			ProjectionStateID: state.ID,
			FromAt:            midnightUnix(bound[0]),
			ToAt:              midnightUnix(bound[1]),
			BuiltRevision:     state.Revision,
			Status:            "ready",
		})
		if err != nil {
			return nil, err
		}
		out = append(out, slice)
	}
	return out, nil
}

// writeDeterministicRows persists projected rows, events, generated transactions,
// and generated checkpoints for dates at or after suffixFrom.
func (s *handler) writeDeterministicRows(path *types.ProjectionPath, result types.ProjectionResult, byID map[string]types.ProjectionSlice, suffixFrom int64) error {
	slices := make([]types.ProjectionSlice, 0, len(byID))
	for _, slice := range byID {
		slices = append(slices, slice)
	}
	modelByID := map[string]types.Transaction{}
	for _, transaction := range path.EffectiveModel.Transactions {
		modelByID[transaction.ID] = transaction
	}
	modelRuleByID := map[string]types.Schedule{}
	for _, rule := range path.EffectiveModel.Schedules {
		modelRuleByID[rule.ID] = rule
	}
	var rows []store.ProjectionRowPayload
	var transactions []store.GeneratedTransaction
	for _, row := range path.Rows {
		if row.IsHistorical || midnightUnix(string(row.Date)) < suffixFrom {
			continue
		}
		sliceID := sliceForDate(slices, string(row.Date))
		if sliceID == "" {
			continue
		}
		encoded, err := json.Marshal(row)
		if err != nil {
			return err
		}
		rows = append(rows, store.ProjectionRowPayload{SliceID: sliceID, Date: string(row.Date), Payload: string(encoded)})
	}
	for _, event := range result.TransactionEvents {
		if midnightUnix(string(event.Date)) < suffixFrom {
			continue
		}
		sliceID := sliceForDate(slices, string(event.Date))
		if sliceID == "" {
			continue
		}
		encoded, err := json.Marshal(event)
		if err != nil {
			return err
		}
		transaction := store.GeneratedTransaction{
			SliceID:         sliceID,
			PostedTime:      midnightUnix(string(event.Date)),
			TransactionTime: midnightUnix(string(event.Date)),
			EventJSON:       string(encoded),
			AppliedAmount:   event.RealizedAmount,
			Outcome:         fulfillmentOutcome(event.Fulfillment),
		}
		if source, ok := modelByID[event.Origin.TransactionID]; ok {
			transaction.Name = source.Name
			transaction.SourceAccountID = source.SourceAccountID
			transaction.DestinationIDs = source.Destinations
		} else if rule, ok := modelRuleByID[event.Origin.TransactionID]; ok {
			transaction.Name = rule.Name
			transaction.SourceAccountID = rule.SourceAccountID
			transaction.DestinationIDs = rule.Destinations
		}
		transactions = append(transactions, transaction)
	}
	if err := s.store.SaveProjectionRows(rows); err != nil {
		return err
	}
	if err := s.store.SaveGeneratedTransactions(transactions); err != nil {
		return err
	}
	return nil
}

func fulfillmentOutcome(fulfillment *types.TransactionFulfillment) string {
	if fulfillment == nil {
		return "fulfilled"
	}
	if fulfillment.UnfulfilledAmount > 0 {
		return "unfulfilled"
	}
	return "fulfilled"
}

// decodeResult re-parses a computed result payload into its typed shape.
// Computed payloads always originate from the matching ToJSON shape.
func decodeResult[T any](value types.JsonValue) (T, error) {
	var out T
	encoded, err := json.Marshal(value)
	if err != nil {
		return out, err
	}
	if err := json.Unmarshal(encoded, &out); err != nil {
		return out, err
	}
	return out, nil
}

func marshalJSON(value types.JsonValue) string {
	if value == nil {
		return "null"
	}
	encoded, err := json.Marshal(value)
	if err != nil {
		return "null"
	}
	return string(encoded)
}

// writeEvaluationOutputs persists one typed row per instance.
func (s *handler) writeEvaluationOutputs(stateID, kind string, tables types.EvaluationResultTables, builtRevision int64) error {
	for _, table := range tables.Tables() {
		switch table.Type {
		case types.EvaluationTypeNetWorthThreshold:
			if err := s.writeThresholdOutputs(stateID, kind, *table.Rows, builtRevision); err != nil {
				return err
			}
		case types.EvaluationTypeAccountBalance:
			if err := s.writeBalanceOutputs(stateID, kind, *table.Rows, builtRevision); err != nil {
				return err
			}
		case types.EvaluationTypeTransactionFulfillment:
			if err := s.writeFulfillmentOutputs(stateID, kind, *table.Rows, builtRevision); err != nil {
				return err
			}
		case types.EvaluationTypeCycleFulfillment:
			if err := s.writeCycleOutputs(stateID, kind, *table.Rows, builtRevision); err != nil {
				return err
			}
		case types.EvaluationTypePlannedPurchases:
			if err := s.writePurchasesOutputs(stateID, kind, *table.Rows, builtRevision); err != nil {
				return err
			}
		case types.EvaluationTypeFinancialIndependence:
			if err := s.writeFIOutputs(stateID, kind, *table.Rows, builtRevision); err != nil {
				return err
			}
		case types.EvaluationTypeWhatIf:
			if err := s.writeWhatIfOutputs(stateID, kind, *table.Rows, builtRevision); err != nil {
				return err
			}
		default:
			return fmt.Errorf("unknown evaluation type %q", table.Type)
		}
	}
	return nil
}

func baseFromEnvelope(stateID, kind string, envelope types.EvaluationResultEnvelope, position int, builtRevision int64) (types.EvaluationOutputBase, error) {
	diagnostics, err := json.Marshal(envelope.Diagnostics)
	if err != nil {
		return types.EvaluationOutputBase{}, err
	}
	return types.EvaluationOutputBase{
		StateID: stateID, Kind: kind, InstanceID: envelope.InstanceID, Position: position,
		Name: envelope.Name, Status: string(envelope.Status), DiagnosticsJSON: string(diagnostics),
		BuiltRevision:    builtRevision,
		HasDeterministic: envelope.Deterministic != nil, HasProbabilistic: envelope.Probabilistic != nil,
	}, nil
}

// assignReachedDate copies a deterministic reached flag plus optional first date.
func assignReachedDate(reached **bool, firstDate **string, detReached bool, detFirstDate *string) {
	reachedCopy := detReached
	*reached = &reachedCopy
	if detFirstDate != nil {
		date := *detFirstDate
		*firstDate = &date
	}
}

func (s *handler) writeThresholdOutputs(stateID, kind string, rows []types.EvaluationResultEnvelope, builtRevision int64) error {
	outputs := make([]types.NetWorthThresholdOutput, 0, len(rows))
	for i, envelope := range rows {
		base, err := baseFromEnvelope(stateID, kind, envelope, i, builtRevision)
		if err != nil {
			return err
		}
		output := types.NetWorthThresholdOutput{EvaluationOutputBase: base}
		if envelope.Deterministic != nil {
			det, err := decodeResult[domain.NetWorthThresholdPathResult](envelope.Deterministic)
			if err != nil {
				return err
			}
			assignReachedDate(&output.Reached, &output.FirstReachedDate, det.Reached, det.FirstReachedDate)
		}
		if envelope.Probabilistic != nil {
			prob, err := decodeResult[domain.NetWorthThresholdProbabilisticResult](envelope.Probabilistic)
			if err != nil {
				return err
			}
			output.ProbProbability = &prob.Probability
			output.ProbP10Date = prob.P10ReachedDate
			output.ProbMedianDate = prob.MedianReachedDate
			output.ProbP90Date = prob.P90ReachedDate
		}
		outputs = append(outputs, output)
	}
	return s.store.SaveNetWorthThresholdOutputs(stateID, kind, outputs, builtRevision)
}

func (s *handler) writeBalanceOutputs(stateID, kind string, rows []types.EvaluationResultEnvelope, builtRevision int64) error {
	outputs := make([]types.AccountBalanceOutput, 0, len(rows))
	for i, envelope := range rows {
		base, err := baseFromEnvelope(stateID, kind, envelope, i, builtRevision)
		if err != nil {
			return err
		}
		output := types.AccountBalanceOutput{EvaluationOutputBase: base}
		if envelope.Deterministic != nil {
			det, err := decodeResult[domain.AccountBalancePathResult](envelope.Deterministic)
			if err != nil {
				return err
			}
			assignReachedDate(&output.Reached, &output.FirstReachedDate, det.Reached, det.FirstReachedDate)
		}
		if envelope.Probabilistic != nil {
			prob, err := decodeResult[domain.AccountBalanceProbabilisticResult](envelope.Probabilistic)
			if err != nil {
				return err
			}
			output.ProbProbability = &prob.Probability
			output.ProbP10Date = prob.P10ReachedDate
			output.ProbMedianDate = prob.MedianReachedDate
			output.ProbP90Date = prob.P90ReachedDate
		}
		outputs = append(outputs, output)
	}
	return s.store.SaveAccountBalanceOutputs(stateID, kind, outputs, builtRevision)
}

type fulfillmentProbabilistic struct {
	RunCount                   int                   `json:"runCount"`
	FulfilledRunCount          int                   `json:"fulfilledRunCount"`
	FullFulfillmentProbability float64               `json:"fullFulfillmentProbability"`
	UnfulfilledPercentiles     types.PercentileBands `json:"unfulfilledAmountPercentiles"`
}

type cycleProbabilistic struct {
	RunCount                int                   `json:"runCount"`
	WithinBudgetRunCount    int                   `json:"withinBudgetRunCount"`
	WithinBudgetProbability float64               `json:"withinBudgetProbability"`
	SpentPercentiles        types.PercentileBands `json:"spentPercentiles"`
}

func (s *handler) writeFulfillmentOutputs(stateID, kind string, rows []types.EvaluationResultEnvelope, builtRevision int64) error {
	outputs := make([]types.TransactionFulfillmentOutput, 0, len(rows))
	for i, envelope := range rows {
		base, err := baseFromEnvelope(stateID, kind, envelope, i, builtRevision)
		if err != nil {
			return err
		}
		output := types.TransactionFulfillmentOutput{EvaluationOutputBase: base}
		if envelope.Deterministic != nil {
			det, err := decodeResult[domain.TransactionFulfillmentPathResult](envelope.Deterministic)
			if err != nil {
				return err
			}
			events, err := json.Marshal(det.Events)
			if err != nil {
				return err
			}
			dates, err := json.Marshal(det.Dates)
			if err != nil {
				return err
			}
			transactions, err := json.Marshal(det.Transactions)
			if err != nil {
				return err
			}
			output.RequestedAmount = &det.RequestedAmount
			output.RealizedAmount = &det.RealizedAmount
			output.DestinationLimitedAmount = &det.DestinationLimitedAmount
			output.UnfulfilledAmount = &det.UnfulfilledAmount
			output.CompletionRate = &det.CompletionRate
			if det.FirstUnderfulfilledDate != nil {
				date := string(*det.FirstUnderfulfilledDate)
				output.FirstUnderfulfilledDate = &date
			}
			output.EventsJSON = string(events)
			output.DatesJSON = string(dates)
			output.TransactionsJSON = string(transactions)
		}
		if envelope.Probabilistic != nil {
			prob, err := decodeResult[fulfillmentProbabilistic](envelope.Probabilistic)
			if err != nil {
				return err
			}
			output.ProbRunCount = &prob.RunCount
			output.ProbFulfilledCount = &prob.FulfilledRunCount
			output.ProbFullProbability = &prob.FullFulfillmentProbability
			output.ProbUnfulfilledP10 = &prob.UnfulfilledPercentiles.P10
			output.ProbUnfulfilledP25 = &prob.UnfulfilledPercentiles.P25
			output.ProbUnfulfilledP50 = &prob.UnfulfilledPercentiles.P50
			output.ProbUnfulfilledP75 = &prob.UnfulfilledPercentiles.P75
			output.ProbUnfulfilledP90 = &prob.UnfulfilledPercentiles.P90
		}
		outputs = append(outputs, output)
	}
	return s.store.SaveTransactionFulfillmentOutputs(stateID, kind, outputs, builtRevision)
}

func (s *handler) writeCycleOutputs(stateID, kind string, rows []types.EvaluationResultEnvelope, builtRevision int64) error {
	outputs := make([]types.CycleFulfillmentOutput, 0, len(rows))
	for i, envelope := range rows {
		base, err := baseFromEnvelope(stateID, kind, envelope, i, builtRevision)
		if err != nil {
			return err
		}
		output := types.CycleFulfillmentOutput{EvaluationOutputBase: base}
		if envelope.Deterministic != nil {
			det, err := decodeResult[domain.CycleFulfillmentPathResult](envelope.Deterministic)
			if err != nil {
				return err
			}
			accountIDs, err := json.Marshal(det.AccountIDs)
			if err != nil {
				return err
			}
			output.AccountIDsJSON = string(accountIDs)
			output.StatementDay = &det.StatementDay
			output.Budget = &det.Budget
			start := string(det.CycleStart)
			output.CycleStart = &start
			end := string(det.CycleEnd)
			output.CycleEnd = &end
			window := string(det.WindowStart)
			output.WindowStart = &window
			output.DaysTotal = &det.DaysTotal
			output.DaysLeft = &det.DaysLeft
			output.RecordedSpend = &det.RecordedSpend
			output.ScheduledSpend = &det.ScheduledSpend
			output.Spent = &det.Spent
			output.Remaining = &det.Remaining
			within := det.WithinBudget
			output.WithinBudget = &within
			output.Shortfall = &det.Shortfall
		}
		if envelope.Probabilistic != nil {
			prob, err := decodeResult[cycleProbabilistic](envelope.Probabilistic)
			if err != nil {
				return err
			}
			output.ProbRunCount = &prob.RunCount
			output.ProbWithinCount = &prob.WithinBudgetRunCount
			output.ProbWithinProbability = &prob.WithinBudgetProbability
			output.ProbSpentP10 = &prob.SpentPercentiles.P10
			output.ProbSpentP25 = &prob.SpentPercentiles.P25
			output.ProbSpentP50 = &prob.SpentPercentiles.P50
			output.ProbSpentP75 = &prob.SpentPercentiles.P75
			output.ProbSpentP90 = &prob.SpentPercentiles.P90
		}
		outputs = append(outputs, output)
	}
	return s.store.SaveCycleFulfillmentOutputs(stateID, kind, outputs, builtRevision)
}

type reachedDateProbabilistic struct {
	Probability       float64 `json:"probability"`
	P10ReachedDate    *string `json:"p10ReachedDate"`
	MedianReachedDate *string `json:"medianReachedDate"`
	P90ReachedDate    *string `json:"p90ReachedDate"`
}

func (s *handler) writePurchasesOutputs(stateID, kind string, rows []types.EvaluationResultEnvelope, builtRevision int64) error {
	outputs := make([]types.PlannedPurchasesOutput, 0, len(rows))
	for i, envelope := range rows {
		base, err := baseFromEnvelope(stateID, kind, envelope, i, builtRevision)
		if err != nil {
			return err
		}
		output := types.PlannedPurchasesOutput{EvaluationOutputBase: base}
		if envelope.Deterministic != nil {
			det, err := decodeResult[domain.PlannedPurchasesPathResult](envelope.Deterministic)
			if err != nil {
				return err
			}
			purchases, err := json.Marshal(det.Purchases)
			if err != nil {
				return err
			}
			output.AllFunded = &det.AllFunded
			if det.FirstReachedDate != nil {
				date := *det.FirstReachedDate
				output.FirstReachedDate = &date
			}
			output.PurchasesJSON = string(purchases)
		}
		if envelope.Probabilistic != nil {
			prob, err := decodeResult[reachedDateProbabilistic](envelope.Probabilistic)
			if err != nil {
				return err
			}
			output.ProbProbability = &prob.Probability
			output.ProbP10Date = prob.P10ReachedDate
			output.ProbMedianDate = prob.MedianReachedDate
			output.ProbP90Date = prob.P90ReachedDate
		}
		outputs = append(outputs, output)
	}
	return s.store.SavePlannedPurchasesOutputs(stateID, kind, outputs, builtRevision)
}

func (s *handler) writeFIOutputs(stateID, kind string, rows []types.EvaluationResultEnvelope, builtRevision int64) error {
	outputs := make([]types.FinancialIndependenceOutput, 0, len(rows))
	for i, envelope := range rows {
		base, err := baseFromEnvelope(stateID, kind, envelope, i, builtRevision)
		if err != nil {
			return err
		}
		output := types.FinancialIndependenceOutput{EvaluationOutputBase: base}
		if envelope.Deterministic != nil {
			det, err := decodeResult[domain.FIAnalysisResult](envelope.Deterministic)
			if err != nil {
				return err
			}
			if det.Milestones.FirstCoverageDate != nil {
				date := string(*det.Milestones.FirstCoverageDate)
				output.FirstCoverageDate = &date
			}
			if det.Milestones.FirstSelfSustainingDate != nil {
				date := string(*det.Milestones.FirstSelfSustainingDate)
				output.FirstSelfSustainingDate = &date
			}
			output.DetailJSON = marshalJSON(envelope.Deterministic)
		}
		if envelope.Probabilistic != nil {
			prob, err := decodeResult[domain.FIProbabilisticResult](envelope.Probabilistic)
			if err != nil {
				return err
			}
			output.ProbSuccess = &prob.FiCycleSuccessProbability
			if prob.MedianCoverageDate != nil {
				date := string(*prob.MedianCoverageDate)
				output.ProbMedianDate = &date
			}
			if prob.SelfSustainingDate != nil {
				date := string(*prob.SelfSustainingDate)
				output.ProbSelfSustainingDate = &date
			}
			output.ProbSelfSustainingProb = prob.SelfSustainingProbability
		}
		outputs = append(outputs, output)
	}
	return s.store.SaveFinancialIndependenceOutputs(stateID, kind, outputs, builtRevision)
}

func (s *handler) writeWhatIfOutputs(stateID, kind string, rows []types.EvaluationResultEnvelope, builtRevision int64) error {
	outputs := make([]types.WhatIfOutput, 0, len(rows))
	for i, envelope := range rows {
		base, err := baseFromEnvelope(stateID, kind, envelope, i, builtRevision)
		if err != nil {
			return err
		}
		output := types.WhatIfOutput{EvaluationOutputBase: base}
		if envelope.Deterministic != nil {
			det, err := decodeResult[domain.WhatIfPathResult](envelope.Deterministic)
			if err != nil {
				return err
			}
			output.FinalNetWorth = &det.FinalNetWorth
			output.TransactionCount = &det.TransactionCount
			if det.FirstUnfulfilledDate != nil {
				date := *det.FirstUnfulfilledDate
				output.FirstUnfulfilledDate = &date
			}
			output.AllFunded = &det.AllFunded
		}
		if envelope.Probabilistic != nil {
			var prob struct {
				FullFundingProbability float64 `json:"fullFundingProbability"`
				SampleCount            int     `json:"sampleCount"`
			}
			encoded, err := json.Marshal(envelope.Probabilistic)
			if err != nil {
				return err
			}
			if err := json.Unmarshal(encoded, &prob); err != nil {
				return err
			}
			output.ProbFullProbability = &prob.FullFundingProbability
			output.ProbSampleCount = &prob.SampleCount
		}
		outputs = append(outputs, output)
	}
	return s.store.SaveWhatIfOutputs(stateID, kind, outputs, builtRevision)
}

// assembleEvaluations rebuilds result tables from stored typed rows.
func (s *handler) assembleEvaluations(stateID, kind string, tables *types.EvaluationTables, revision int64) (types.EvaluationResultTables, bool, error) {
	empty := types.EvaluationResultTables{
		FinancialIndependence:  []types.EvaluationResultEnvelope{},
		NetWorthThreshold:      []types.EvaluationResultEnvelope{},
		AccountBalance:         []types.EvaluationResultEnvelope{},
		TransactionFulfillment: []types.EvaluationResultEnvelope{},
		CycleFulfillment:       []types.EvaluationResultEnvelope{},
	}
	want := 0
	for _, table := range tables.Tables() {
		want += len(*table.Rows)
	}
	if want == 0 {
		return empty, true, nil
	}
	out := empty
	count := 0
	envelopeOf := func(base types.EvaluationOutputBase) (types.EvaluationResultEnvelope, error) {
		var diagnostics []types.EvaluationDiagnostic
		raw := base.DiagnosticsJSON
		if raw == "" {
			raw = "[]"
		}
		if err := json.Unmarshal([]byte(raw), &diagnostics); err != nil {
			return types.EvaluationResultEnvelope{}, err
		}
		if diagnostics == nil {
			diagnostics = []types.EvaluationDiagnostic{}
		}
		return types.EvaluationResultEnvelope{
			InstanceID: base.InstanceID, Name: base.Name, Status: types.EvaluationResultStatus(base.Status),
			Diagnostics: diagnostics,
		}, nil
	}
	thresholds, err := s.store.ListNetWorthThresholdOutputs(stateID, kind)
	if err != nil {
		return out, false, err
	}
	for _, row := range thresholds {
		if row.BuiltRevision != revision {
			return out, false, nil
		}
		envelope, err := envelopeOf(row.EvaluationOutputBase)
		if err != nil {
			return out, false, err
		}
		if row.HasDeterministic {
			envelope.Deterministic = map[string]any{"reached": row.Reached != nil && *row.Reached, "firstReachedDate": optString(row.FirstReachedDate)}
		}
		if row.HasProbabilistic {
			envelope.Probabilistic = map[string]any{"probability": optFloat(row.ProbProbability), "p10ReachedDate": optString(row.ProbP10Date), "medianReachedDate": optString(row.ProbMedianDate), "p90ReachedDate": optString(row.ProbP90Date)}
		}
		out.NetWorthThreshold = append(out.NetWorthThreshold, envelope)
		count++
	}
	balances, err := s.store.ListAccountBalanceOutputs(stateID, kind)
	if err != nil {
		return out, false, err
	}
	for _, row := range balances {
		if row.BuiltRevision != revision {
			return out, false, nil
		}
		envelope, err := envelopeOf(row.EvaluationOutputBase)
		if err != nil {
			return out, false, err
		}
		if row.HasDeterministic {
			envelope.Deterministic = map[string]any{"reached": row.Reached != nil && *row.Reached, "firstReachedDate": optString(row.FirstReachedDate)}
		}
		if row.HasProbabilistic {
			envelope.Probabilistic = map[string]any{"probability": optFloat(row.ProbProbability), "p10ReachedDate": optString(row.ProbP10Date), "medianReachedDate": optString(row.ProbMedianDate), "p90ReachedDate": optString(row.ProbP90Date)}
		}
		out.AccountBalance = append(out.AccountBalance, envelope)
		count++
	}
	fulfillments, err := s.store.ListTransactionFulfillmentOutputs(stateID, kind)
	if err != nil {
		return out, false, err
	}
	for _, row := range fulfillments {
		if row.BuiltRevision != revision {
			return out, false, nil
		}
		envelope, err := envelopeOf(row.EvaluationOutputBase)
		if err != nil {
			return out, false, err
		}
		if row.HasDeterministic {
			envelope.Deterministic = map[string]any{
				"requestedAmount": optFloat(row.RequestedAmount), "realizedAmount": optFloat(row.RealizedAmount),
				"destinationLimitedAmount": optFloat(row.DestinationLimitedAmount), "unfulfilledAmount": optFloat(row.UnfulfilledAmount),
				"completionRate": optFloat(row.CompletionRate), "firstUnderfulfilledDate": optString(row.FirstUnderfulfilledDate),
				"events": json.RawMessage(row.EventsJSON), "dates": json.RawMessage(row.DatesJSON), "transactions": json.RawMessage(row.TransactionsJSON),
			}
		}
		if row.HasProbabilistic {
			envelope.Probabilistic = map[string]any{
				"runCount": optInt(row.ProbRunCount), "fulfilledRunCount": optInt(row.ProbFulfilledCount),
				"fullFulfillmentProbability": optFloat(row.ProbFullProbability),
				"unfulfilledAmountPercentiles": map[string]any{
					"p10": optFloat(row.ProbUnfulfilledP10), "p25": optFloat(row.ProbUnfulfilledP25), "p50": optFloat(row.ProbUnfulfilledP50),
					"p75": optFloat(row.ProbUnfulfilledP75), "p90": optFloat(row.ProbUnfulfilledP90),
				},
			}
		}
		out.TransactionFulfillment = append(out.TransactionFulfillment, envelope)
		count++
	}
	cycles, err := s.store.ListCycleFulfillmentOutputs(stateID, kind)
	if err != nil {
		return out, false, err
	}
	for _, row := range cycles {
		if row.BuiltRevision != revision {
			return out, false, nil
		}
		envelope, err := envelopeOf(row.EvaluationOutputBase)
		if err != nil {
			return out, false, err
		}
		if row.HasDeterministic {
			envelope.Deterministic = map[string]any{
				"accountIds": json.RawMessage(row.AccountIDsJSON), "statementDay": optInt(row.StatementDay), "budget": optFloat(row.Budget),
				"cycleStart": optString(row.CycleStart), "cycleEnd": optString(row.CycleEnd), "windowStart": optString(row.WindowStart),
				"daysTotal": optInt(row.DaysTotal), "daysLeft": optInt(row.DaysLeft),
				"recordedSpend": optFloat(row.RecordedSpend), "scheduledSpend": optFloat(row.ScheduledSpend),
				"spent": optFloat(row.Spent), "remaining": optFloat(row.Remaining),
				"withinBudget": optBool(row.WithinBudget), "shortfall": optFloat(row.Shortfall),
			}
		}
		if row.HasProbabilistic {
			envelope.Probabilistic = map[string]any{
				"runCount": optInt(row.ProbRunCount), "withinBudgetRunCount": optInt(row.ProbWithinCount),
				"withinBudgetProbability": optFloat(row.ProbWithinProbability),
				"spentPercentiles": map[string]any{
					"p10": optFloat(row.ProbSpentP10), "p25": optFloat(row.ProbSpentP25), "p50": optFloat(row.ProbSpentP50),
					"p75": optFloat(row.ProbSpentP75), "p90": optFloat(row.ProbSpentP90),
				},
			}
		}
		out.CycleFulfillment = append(out.CycleFulfillment, envelope)
		count++
	}
	purchases, err := s.store.ListPlannedPurchasesOutputs(stateID, kind)
	if err != nil {
		return out, false, err
	}
	for _, row := range purchases {
		if row.BuiltRevision != revision {
			return out, false, nil
		}
		envelope, err := envelopeOf(row.EvaluationOutputBase)
		if err != nil {
			return out, false, err
		}
		if row.HasDeterministic {
			envelope.Deterministic = map[string]any{
				"purchases": json.RawMessage(row.PurchasesJSON), "allFunded": optBool(row.AllFunded),
				"firstReachedDate": optString(row.FirstReachedDate),
			}
		}
		if row.HasProbabilistic {
			envelope.Probabilistic = map[string]any{"probability": optFloat(row.ProbProbability), "p10ReachedDate": optString(row.ProbP10Date), "medianReachedDate": optString(row.ProbMedianDate), "p90ReachedDate": optString(row.ProbP90Date)}
		}
		out.PlannedPurchases = append(out.PlannedPurchases, envelope)
		count++
	}
	fis, err := s.store.ListFinancialIndependenceOutputs(stateID, kind)
	if err != nil {
		return out, false, err
	}
	for _, row := range fis {
		if row.BuiltRevision != revision {
			return out, false, nil
		}
		envelope, err := envelopeOf(row.EvaluationOutputBase)
		if err != nil {
			return out, false, err
		}
		if row.HasDeterministic {
			envelope.Deterministic = json.RawMessage(row.DetailJSON)
		}
		if row.HasProbabilistic {
			envelope.Probabilistic = map[string]any{
				"fiCycleSuccessProbability": optFloat(row.ProbSuccess), "medianCoverageDate": optString(row.ProbMedianDate),
				"selfSustainingDate": optString(row.ProbSelfSustainingDate), "selfSustainingProbability": row.ProbSelfSustainingProb,
			}
		}
		out.FinancialIndependence = append(out.FinancialIndependence, envelope)
		count++
	}
	whatifs, err := s.store.ListWhatIfOutputs(stateID, kind)
	if err != nil {
		return out, false, err
	}
	for _, row := range whatifs {
		if row.BuiltRevision != revision {
			return out, false, nil
		}
		envelope, err := envelopeOf(row.EvaluationOutputBase)
		if err != nil {
			return out, false, err
		}
		if row.HasDeterministic {
			envelope.Deterministic = map[string]any{
				"finalNetWorth": optFloat(row.FinalNetWorth), "transactionCount": optInt(row.TransactionCount),
				"firstUnfulfilledDate": optString(row.FirstUnfulfilledDate), "allFunded": optBool(row.AllFunded),
			}
		}
		if row.HasProbabilistic {
			envelope.Probabilistic = map[string]any{"fullFundingProbability": optFloat(row.ProbFullProbability), "sampleCount": optInt(row.ProbSampleCount)}
		}
		out.WhatIf = append(out.WhatIf, envelope)
		count++
	}
	if count != wantInstances(tables) {
		return out, false, nil
	}
	return out, true, nil
}

func wantInstances(tables *types.EvaluationTables) int {
	want := 0
	for _, table := range tables.Tables() {
		want += len(*table.Rows)
	}
	return want
}

func optString(s *string) any {
	if s == nil {
		return nil
	}
	return *s
}

func optBool(b *bool) any {
	if b == nil {
		return nil
	}
	return *b
}

func optFloat(f *float64) any {
	if f == nil {
		return nil
	}
	return *f
}

func optInt(i *int) any {
	if i == nil {
		return nil
	}
	return *i
}

// readDeterministic assembles the complete result from stored rows.
func (s *handler) readDeterministic(model *types.FinancialModel, settings *types.ProjectionRuntimeSettings) (*types.ProjectionResult, bool, error) {
	state, canonical, err := s.ensureCanonicalState(settings)
	if err != nil || !canonical {
		return nil, false, err
	}
	if state.DirtyFrom > 0 {
		return nil, false, nil
	}
	evalJSON, err := canonicalEvalJSON(&settings.Evaluations)
	if err != nil {
		return nil, false, err
	}
	if evalJSON != state.DetEvaluationsJSON {
		return nil, false, nil
	}
	slices, err := s.store.ListProjectionSlices()
	if err != nil {
		return nil, false, err
	}
	if !slicesCover(slices, state.ProjectionStart, state.HorizonEnd) || !currentRevision(slices, state.Revision) {
		return nil, false, nil
	}
	ids := make([]string, 0, len(slices))
	for _, slice := range slices {
		ids = append(ids, slice.ID)
	}
	storedRows, err := s.store.ListProjectionRows(ids)
	if err != nil {
		return nil, false, err
	}
	storedTransactions, err := s.store.ListGeneratedTransactions(ids)
	if err != nil {
		return nil, false, err
	}
	tables, served, err := s.assembleEvaluations(state.ID, "deterministic", &settings.Evaluations, state.Revision)
	if err != nil {
		return nil, false, err
	}
	if !served {
		return nil, false, nil
	}
	history, initialBalances, err := domain.HistoricalProjectionRows(model, settings, types.ModelOverrides{})
	if err != nil {
		return nil, false, err
	}
	rows := make([]types.ProjectionRow, 0, len(history)+len(storedRows))
	rows = append(rows, history...)
	for _, stored := range storedRows {
		var row types.ProjectionRow
		if err := json.Unmarshal([]byte(stored.Payload), &row); err != nil {
			return nil, false, err
		}
		rows = append(rows, row)
	}
	events := make([]types.TransactionEvent, 0, len(storedTransactions))
	for _, stored := range storedTransactions {
		var event types.TransactionEvent
		if err := json.Unmarshal([]byte(stored.EventJSON), &event); err != nil {
			return nil, false, err
		}
		events = append(events, event)
	}
	sort.Slice(events, func(i, j int) bool {
		if events[i].Date != events[j].Date {
			return events[i].Date < events[j].Date
		}
		return events[i].Sequence < events[j].Sequence
	})
	result := domain.RenderProjectionResult(rows, events, *model, initialBalances, types.IsoDate(state.ProjectionStart))
	result.Evaluations = tables
	return result, true, nil
}

// buildStochastic computes trials and persists statistics plus outputs.
func (s *handler) buildStochastic(model *types.FinancialModel, settings *types.ProjectionRuntimeSettings, config types.StochasticConfig) (*types.StochasticProjectionResult, error) {
	// No singleflight here: concurrent identical seeded runs already
	// converge in the shared-run registry, which also attaches streams.
	// A per-user gate would only serialize different seeds needlessly.
	return s.buildStochasticLocked(model, settings, config)
}

func (s *handler) buildStochasticLocked(model *types.FinancialModel, settings *types.ProjectionRuntimeSettings, config types.StochasticConfig) (*types.StochasticProjectionResult, error) {
	state, canonical, err := s.ensureCanonicalState(settings)
	if err != nil || !canonical {
		if err == nil {
			err = fmt.Errorf("settings do not address the canonical state")
		}
		return nil, err
	}
	if config.RunCount != state.TrialCount && state.TrialCount != 0 {
		return nil, fmt.Errorf("run count %d does not match canonical %d", config.RunCount, state.TrialCount)
	}
	if state.TrialCount == 0 {
		state.TrialCount = config.RunCount
	}
	if state.DirtyFrom > 0 {
		// Route through the shared build flight: the stochastic path and the
		// deterministic endpoint can request the same rebuild concurrently,
		// and two interleaved slice writes would append duplicate rows.
		if err := s.buildDeterministic(model, settings); err != nil {
			return nil, err
		}
		state, err = s.store.GetProjectionState()
		if err != nil {
			return nil, err
		}
	}
	seed := state.StochasticSeed
	if seed != nil && config.Seed != nil && *config.Seed != *seed {
		return nil, fmt.Errorf("seed %d does not match canonical %d", *config.Seed, *seed)
	}
	if seed == nil {
		frozen := config.Seed
		if frozen == nil {
			var value uint64
			if err := binary.Read(rand.Reader, binary.LittleEndian, &value); err != nil {
				return nil, err
			}
			drawn := int64(value >> 1)
			frozen = &drawn
		}
		state.StochasticSeed = frozen
		if _, err := s.store.SaveProjectionState(state); err != nil {
			return nil, err
		}
		seed = frozen
	}
	slices, err := s.store.ListProjectionSlices()
	if err != nil {
		return nil, err
	}
	if !slicesCover(slices, state.ProjectionStart, state.HorizonEnd) {
		fresh, err := s.ensureSuffixManifest(state, midnightUnix(state.ProjectionStart))
		if err != nil {
			return nil, err
		}
		slices = append(slices, fresh...)
	}
	effective := types.StochasticConfig{RunCount: state.TrialCount, Seed: seed}
	result, samples, err := domain.StochasticNetWorthSamples(context.Background(), model, settings, types.ModelOverrides{}, effective, nil)
	if err != nil {
		return nil, err
	}
	result.Config = effective
	ids := make([]string, 0, len(slices))
	for _, slice := range slices {
		ids = append(ids, slice.ID)
	}
	if err := s.store.DeleteMonteCarloStatistics(ids); err != nil {
		return nil, err
	}
	if err := s.writeNetWorthStatistics(slices, samples, state.TrialCount, state.ProjectionStart); err != nil {
		return nil, err
	}
	evalJSON, err := canonicalEvalJSON(&settings.Evaluations)
	if err != nil {
		return nil, err
	}
	if err := s.writeEvaluationOutputs(state.ID, "stochastic", result.Evaluations, state.Revision); err != nil {
		return nil, err
	}
	latest, err := s.store.GetProjectionState()
	if err != nil {
		return nil, err
	}
	if latest.Revision != state.Revision || latest.DirtyFrom != state.DirtyFrom {
		return nil, fmt.Errorf("projection inputs changed while building; skipping the stale write")
	}
	state.StochEvaluationsJSON = evalJSON
	if _, err := s.store.SaveProjectionState(state); err != nil {
		return nil, err
	}
	if _, err := s.store.PublishProjection(state.Revision); err != nil {
		return nil, err
	}
	return result, nil
}

// writeNetWorthStatistics persists portfolio bands per projected date.
func (s *handler) writeNetWorthStatistics(slices []types.ProjectionSlice, samples map[string][]float64, runCount int, projectionStart string) error {
	if len(slices) == 0 {
		return fmt.Errorf("no slices for statistics")
	}
	bySlice := map[string][]types.MonteCarloStatistic{}
	for date, values := range samples {
		if date < projectionStart {
			continue
		}
		sliceID := sliceForDate(slices, date)
		if sliceID == "" {
			continue
		}
		bySlice[sliceID] = append(bySlice[sliceID], summarizeSamples(sliceID, date, values, runCount))
	}
	for _, stats := range bySlice {
		if err := s.store.SaveMonteCarloStatistics(stats); err != nil {
			return err
		}
	}
	return nil
}

func summarizeSamples(sliceID, date string, values []float64, runCount int) types.MonteCarloStatistic {
	sorted := append([]float64{}, values...)
	sort.Float64s(sorted)
	mean := 0.0
	below := 0
	for _, value := range sorted {
		mean += value
		if value < 0 {
			below++
		}
	}
	mean /= math.Max(1, float64(len(sorted)))
	variance := 0.0
	for _, value := range sorted {
		gap := value - mean
		variance += gap * gap
	}
	variance /= math.Max(1, float64(len(sorted)))
	quantile := func(p float64) float64 {
		if len(sorted) == 0 {
			return 0
		}
		rank := p * float64(len(sorted)-1)
		low := int(math.Floor(rank))
		high := int(math.Ceil(rank))
		if low == high {
			return sorted[low]
		}
		return sorted[low] + (rank-float64(low))*(sorted[high]-sorted[low])
	}
	return types.MonteCarloStatistic{
		ProjectionSliceID:    sliceID,
		AsOfAt:               midnightRFC3339(date),
		SampleCount:          runCount,
		Mean:                 mean,
		Median:               quantile(0.5),
		P10:                  quantile(0.10),
		P25:                  quantile(0.25),
		P50:                  quantile(0.5),
		P75:                  quantile(0.75),
		P90:                  quantile(0.90),
		StdDev:               math.Sqrt(variance),
		ProbabilityBelowZero: float64(below) / math.Max(1, float64(len(sorted))),
	}
}

// readStochastic assembles bands and evaluations from stored statistics.
func (s *handler) readStochastic(model *types.FinancialModel, settings *types.ProjectionRuntimeSettings, config types.StochasticConfig) (*types.StochasticProjectionResult, bool, error) {
	state, canonical, err := s.ensureCanonicalState(settings)
	if err != nil || !canonical {
		return nil, false, err
	}
	if config.RunCount != state.TrialCount {
		return nil, false, nil
	}
	if config.Seed != nil && (state.StochasticSeed == nil || *config.Seed != *state.StochasticSeed) {
		return nil, false, nil
	}
	if state.DirtyFrom > 0 {
		return nil, false, nil
	}
	evalJSON, err := canonicalEvalJSON(&settings.Evaluations)
	if err != nil {
		return nil, false, err
	}
	if evalJSON != state.StochEvaluationsJSON {
		return nil, false, nil
	}
	slices, err := s.store.ListProjectionSlices()
	if err != nil {
		return nil, false, err
	}
	if !slicesCover(slices, state.ProjectionStart, state.HorizonEnd) || !currentRevision(slices, state.Revision) {
		return nil, false, nil
	}
	ids := make([]string, 0, len(slices))
	for _, slice := range slices {
		ids = append(ids, slice.ID)
	}
	all := []types.MonteCarloStatistic{}
	for _, id := range ids {
		stats, err := s.store.ListMonteCarloStatistics(id)
		if err != nil {
			return nil, false, err
		}
		all = append(all, stats...)
	}
	if len(all) == 0 {
		return nil, false, nil
	}
	byDate := map[string][]types.MonteCarloStatistic{}
	for _, stat := range all {
		date := stat.AsOfAt[:10]
		byDate[date] = append(byDate[date], stat)
	}
	tables, served, err := s.assembleEvaluations(state.ID, "stochastic", &settings.Evaluations, state.Revision)
	if err != nil {
		return nil, false, err
	}
	if !served {
		return nil, false, nil
	}
	history, _, err := domain.HistoricalProjectionRows(model, settings, types.ModelOverrides{})
	if err != nil {
		return nil, false, err
	}
	// A date counts as historical when history already covers it: sample
	// accumulation marks the first row seen per date, and history replays
	// before projected dates simulate.
	historical := map[string]bool{}
	for _, row := range history {
		historical[string(row.Date)] = true
	}
	bands := make([]types.StochasticBandRow, 0, len(history)+len(byDate))
	for _, row := range history {
		balance := domain.RoundSampleValue(row.NetWorth)
		bands = append(bands, types.StochasticBandRow{
			Date:         row.Date,
			IsHistorical: true,
			NetWorth:     types.PercentileBands{P10: balance, P25: balance, P50: balance, P75: balance, P90: balance},
		})
	}
	dates := make([]string, 0, len(byDate))
	for date := range byDate {
		if date < state.ProjectionStart {
			continue
		}
		dates = append(dates, date)
	}
	sort.Strings(dates)
	for _, date := range dates {
		portfolio, ok := portfolioStat(byDate[date])
		if !ok {
			return nil, false, nil
		}
		bands = append(bands, types.StochasticBandRow{
			Date:         types.IsoDate(date),
			IsHistorical: historical[date],
			NetWorth: types.PercentileBands{
				P10: portfolio.P10, P25: portfolio.P25, P50: portfolio.P50,
				P75: portfolio.P75, P90: portfolio.P90,
			},
		})
	}
	if len(bands) == 0 {
		return nil, false, nil
	}
	result := &types.StochasticProjectionResult{
		Config:      types.StochasticConfig{RunCount: config.RunCount, Seed: state.StochasticSeed},
		Bands:       bands,
		Evaluations: tables,
	}
	result.Milestones.FinalNetWorthPercentiles = bands[len(bands)-1].NetWorth
	return result, true, nil
}

func portfolioStat(stats []types.MonteCarloStatistic) (types.MonteCarloStatistic, bool) {
	for _, stat := range stats {
		if stat.AccountID == "" {
			return stat, true
		}
	}
	return types.MonteCarloStatistic{}, false
}
