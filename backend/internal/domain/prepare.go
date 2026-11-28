package domain

import (
	"fmt"
	"math"
	"sort"
	"time"

	"github.com/simhozebs/net-worth-estimator/backend/internal/types"
)

// Request preparation for simulation. Go is the owner.

// SimulationPreparationError carries validation issues blocking simulation.
type SimulationPreparationError struct {
	Issues []types.ModelValidationIssue
}

func (e *SimulationPreparationError) Error() string {
	message := "Cannot prepare an invalid financial model:"
	for _, issue := range e.Issues {
		message += " " + issue.Message
	}
	return message
}

func applyHistoricalState(model *types.FinancialModel, projectionStartDate string) (*SimulationState, []types.HistoricalObservationSnapshot, bool, error) {
	applied, err := applyChronologicalHistory(model, projectionStartDate)
	if err != nil {
		return nil, nil, false, err
	}
	return applied.state, applied.snapshots, applied.includeStartDateEvents, nil
}

// appliedHistory is the chronological application result shared by current
// position and projection preparation: one calculation authority.
type appliedHistory struct {
	state                  *SimulationState
	snapshots              []types.HistoricalObservationSnapshot
	includeStartDateEvents bool
	latestObserved         map[string]types.Checkpoint
	// noopCheckpointKeys holds observations whose raw balance matched the
	// balance immediately before their reset (within float tolerance).
	// Persistence uses this exact set so a sub-dollar balance change is never
	// mistaken for a no-op.
	noopCheckpointKeys map[ObservationKey]struct{}
}

// applyChronologicalHistory applies recorded history through the end of projectionStartDate.
func applyChronologicalHistory(model *types.FinancialModel, projectionStartDate string) (*appliedHistory, error) {
	return applyChronologicalHistoryAt(model, projectionStartDate, dayCloseUnix(projectionStartDate))
}

// historyEvent is the single unified input for applying recorded history: either one transaction/rule
// occurrence at its effective instant or one absolute observation. There
// are no date-wide gates, no per-day phases, and no identity-suppression
// maps: one sorted list, one forward pass.
type historyEvent struct {
	instant       int64
	isObservation bool
	checkpoint    types.Checkpoint
	occurrence    DatedTransactionOccurrence
	execDate      string
	seq           int
}

// applyChronologicalHistoryAt applies one sorted event stream through the
// cut instant. Every event at or before cutInstant is applied; everything
// after is future. Observations SET their account balance; transactions CHANGE
// balances; a later observation SETS that account again.
//
//   - Recurrence instances take effect at the day-close instant of their
//     date, so a rule at 23:59:59 executes BEFORE an observation at the
//     same instant (movement before anchor preserves day-close meaning).
//   - Every one-time transaction carries its stored Unix time, including 00:00.
//   - Transactions execute before an observation on a tie; owner observations
//     execute last at the same instant.
//   - Each account anchors independently. Observations sort by instant, so
//     arrival order never matters and a backdated observation cannot roll
//     the latest state back.
func applyChronologicalHistoryAt(model *types.FinancialModel, projectionStartDate string, cutInstant int64) (*appliedHistory, error) {
	return applyChronologicalHistoryAtMode(model, projectionStartDate, cutInstant, true)
}

// applyChronologicalHistoryAtMode replays one sorted event stream. Modeled
// history includes schedule occurrences for timeline evidence and transaction
// ledgers. Current history omits them so only recorded actuals move the
// authoritative balance after a checkpoint.
func applyChronologicalHistoryAtMode(model *types.FinancialModel, projectionStartDate string, cutInstant int64, includeScheduleOccurrences bool) (*appliedHistory, error) {
	for _, checkpoint := range model.Checkpoints {
		day := FormatIsoDate(time.Unix(CheckpointInstant(checkpoint), 0).UTC())
		if CompareIsoDates(day, projectionStartDate) > 0 {
			return nil, &SimulationPreparationError{Issues: []types.ModelValidationIssue{{
				Severity: types.SeverityError,
				Code:     "checkpoint.date.future",
				Message: fmt.Sprintf("Checkpoint for '%s' is after the projection start (%s).",
					checkpoint.AccountID, projectionStartDate),
				Path: []any{"checkpoints"},
			}}}
		}
	}

	// Lower bound for rule expansion: earliest observation day, else the
	// start day itself so start-day movements are still applied exactly once.
	earliestDay := projectionStartDate
	for _, checkpoint := range model.Checkpoints {
		day := FormatIsoDate(time.Unix(CheckpointInstant(checkpoint), 0).UTC())
		if CompareIsoDates(day, earliestDay) < 0 {
			earliestDay = day
		}
	}
	schedules := model.Schedules
	if !includeScheduleOccurrences {
		schedules = nil
	}
	var history ResolvedOccurrences
	history = ResolveOccurrences(schedules, model.Transactions, earliestDay, projectionStartDate, true)

	events := []historyEvent{}
	seq := 0
	addedTransaction := map[string]bool{}
	for date, occurrences := range history.ByDate {
		for _, occurrence := range occurrences {
			// Enabled alone decides execution. Pending and void are
			// stored provider lifecycle metadata; translation assigns
			// them Enabled false, and the engine never reinterprets
			// them here.
			if !occurrence.Transaction.Enabled {
				continue
			}
			instant := EffectiveOccurrenceInstant(occurrence, date)
			if instant <= 0 || instant > cutInstant {
				continue
			}
			events = append(events, historyEvent{
				instant:       instant,
				isObservation: false,
				occurrence:    occurrence,
				execDate:      date,
				seq:           seq,
			})
			seq++
			if occurrence.Rule == nil {
				addedTransaction[occurrence.Transaction.ID] = true
			}
		}
	}
	// Manual transactions before the rule-expansion lower bound are still applied:
	// history has no lower bound for confirmed actuals, only the cut.
	for index := range model.Transactions {
		transaction := &model.Transactions[index]
		if addedTransaction[transaction.ID] {
			continue
		}
		if !transaction.Enabled {
			continue
		}
		day := transactionDay(transaction)
		if day == "" || CompareIsoDates(day, projectionStartDate) > 0 {
			continue
		}
		instant := TransactionInstant(transaction)
		if instant <= 0 || instant > cutInstant {
			continue
		}
		events = append(events, historyEvent{
			instant:       instant,
			isObservation: false,
			occurrence:    DatedTransactionOccurrence{Transaction: transaction, Index: 1000000 + index, Rule: nil, DocPath: []any{"transactions", index}},
			execDate:      day,
			seq:           seq,
		})
		seq++
	}
	for _, checkpoint := range model.Checkpoints {
		instant := CheckpointInstant(checkpoint)
		if instant <= 0 || instant > cutInstant {
			continue
		}
		events = append(events, historyEvent{
			instant:       instant,
			isObservation: true,
			checkpoint:    checkpoint,
			execDate:      FormatIsoDate(time.Unix(instant, 0).UTC()),
			seq:           seq,
		})
		seq++
	}

	sort.SliceStable(events, func(i, j int) bool {
		if events[i].instant != events[j].instant {
			return events[i].instant < events[j].instant
		}
		if events[i].isObservation != events[j].isObservation {
			return !events[i].isObservation
		}
		if events[i].isObservation {
			leftOwner, rightOwner := IsOwnerAuthored(events[i].checkpoint.Source), IsOwnerAuthored(events[j].checkpoint.Source)
			if leftOwner != rightOwner {
				return !leftOwner && rightOwner
			}
			return events[i].seq < events[j].seq
		}
		if tied := compareDatedTransactionOccurrences(events[i].occurrence, events[j].occurrence); tied != 0 {
			return tied < 0
		}
		return events[i].seq < events[j].seq
	})

	transitions := CreateTransitionRuntime(types.SimulationInputs{
		Accounts:         model.Accounts,
		Transactions:     model.Transactions,
		Schedules:        model.Schedules,
		PaymentTerms:     model.PaymentTerms,
		PlannedPurchases: model.PlannedPurchases,
	}, SimulationState{
		Balances:                         InitAccountBalances(model.Accounts),
		LatestRealizedTransactionAmounts: map[string]float64{},
		RealizedTransactionAmountsByYear: map[string]map[string]float64{},
	}, projectionStartDate, nil)

	latestObserved := map[string]types.Checkpoint{}
	noopCheckpointKeys := map[ObservationKey]struct{}{}
	historicalSnapshots := []types.HistoricalObservationSnapshot{}
	executeOccurrence := func(occurrence DatedTransactionOccurrence, date string, historicalActual bool) error {
		_, execErr := transitions.ExecuteTransaction(occurrence, date, historicalActual)
		if execErr != nil {
			message := execErr.Error()
			switch typed := execErr.(type) {
			case *AmountResolutionError:
				message = typed.Message
			case *EvalError:
				message = typed.Message
			case *ParseError:
				message = typed.Error()
			}
			return &SimulationPreparationError{Issues: []types.ModelValidationIssue{{
				Severity: types.SeverityError,
				Code:     "transaction.history.execution",
				Message: fmt.Sprintf("Could not apply transaction '%s' on %s: %s",
					occurrence.Transaction.ID, date, message),
				Path: occurrence.DocPath,
			}}}
		}
		return nil
	}

	// One forward pass over the sorted stream. Daily snapshots sample the
	// running state: each calendar day flushes once when the next day
	// begins (and once at the end), so rows stay samples, not phases.
	currentDay := ""
	flushDay := func() {
		if currentDay == "" {
			return
		}
		snapshot := types.HistoricalObservationSnapshot{
			Date:     currentDay,
			Balances: SnapshotBalances(transitions.State.Balances),
		}
		historicalSnapshots = append(historicalSnapshots, snapshot)
	}
	for _, event := range events {
		if event.execDate != currentDay {
			flushDay()
			currentDay = event.execDate
		}
		if event.isObservation {
			observation := event.checkpoint
			modeledBalance := transitions.State.Balances[observation.AccountID]
			if math.Abs(observation.Balance-modeledBalance) < 1e-9 {
				noopCheckpointKeys[ObservationKey{AccountID: observation.AccountID, ObservedAt: observation.ObservedAt}] = struct{}{}
			}
			transitions.State.Balances[observation.AccountID] = observation.Balance
			latestObserved[observation.AccountID] = observation
			continue
		}
		historicalActual := event.occurrence.Rule == nil
		if err := executeOccurrence(event.occurrence, event.execDate, historicalActual); err != nil {
			return nil, err
		}
	}
	flushDay()

	return &appliedHistory{
		state:                  &transitions.State,
		snapshots:              historicalSnapshots,
		includeStartDateEvents: true,
		latestObserved:         latestObserved,
		noopCheckpointKeys:     noopCheckpointKeys,
	}, nil
}

type preparedPosition struct {
	model                  types.FinancialModel
	state                  *SimulationState
	snapshots              []types.HistoricalObservationSnapshot
	includeStartDateEvents bool
	appliedHistory         *appliedHistory
}

// prepareRecordedProjectionPosition applies only recorded actuals and observations.
// Saved-result reads and full projection preparation share this validation,
// cutoff, and historical timeline. Modeled schedule replay is deliberately separate.
func prepareRecordedProjectionPosition(model *types.FinancialModel, settings *types.ProjectionRuntimeSettings, overrides types.ModelOverrides) (*preparedPosition, error) {
	startDate := string(settings.FallbackProjectionStartDate)
	if !IsValidIsoDate(startDate) {
		return nil, &SimulationPreparationError{Issues: []types.ModelValidationIssue{{
			Severity: types.SeverityError,
			Code:     "settings.projection-start.format",
			Message:  fmt.Sprintf("fallbackProjectionStartDate must be a YYYY-MM-DD calendar date (got %q).", startDate),
			Path:     []any{"fallbackProjectionStartDate"},
		}}}
	}
	cutInstant := dayCloseUnix(startDate)
	if settings.AsOfInstant != nil {
		cutInstant = *settings.AsOfInstant
		if FormatIsoDate(time.Unix(cutInstant, 0).UTC()) != startDate {
			return nil, &SimulationPreparationError{Issues: []types.ModelValidationIssue{{
				Severity: types.SeverityError,
				Code:     "settings.asOfInstant.day-mismatch",
				Message:  fmt.Sprintf("asOfInstant must fall on the projection start date %s.", startDate),
				Path:     []any{"asOfInstant"},
			}}}
		}
	}
	return preparePositionWithValidator(model, startDate, cutInstant, overrides, ValidateFinancialModel, false)
}

// applyModeledHistory adds schedule occurrences for transaction ledgers and
// spending-cap state. Recorded actuals remain the balance and timeline authority.
func applyModeledHistory(position *preparedPosition, startDate string, cutInstant int64) error {
	modeled, err := applyChronologicalHistoryAt(&position.model, startDate, cutInstant)
	if err != nil {
		return err
	}
	state := CloneSimulationState(*modeled.state)
	state.Balances = SnapshotBalances(position.state.Balances)
	position.state = &state
	return nil
}

// prepareFinancePositionAt applies recorded history for ordinary finance reads
// (current position, account balances) using pure finance validation, so
// no evaluation-owned check can block history.
func prepareFinancePositionAt(model *types.FinancialModel, startDate string, cutInstant int64, overrides types.ModelOverrides) (*preparedPosition, error) {
	// Historical finance reads ignore later observations. Projection preparation
	// retains its future-checkpoint validation. Copy before filtering so a read
	// cannot alter the caller's model or its checkpoint backing array.
	if model != nil {
		cutModel := *model
		cutModel.Checkpoints = make([]types.Checkpoint, 0, len(model.Checkpoints))
		for _, checkpoint := range model.Checkpoints {
			if CheckpointInstant(checkpoint) <= cutInstant {
				cutModel.Checkpoints = append(cutModel.Checkpoints, checkpoint)
			}
		}
		model = &cutModel
	}
	return preparePositionWithValidator(model, startDate, cutInstant, overrides, ValidateFinanceModel, false)
}

func preparePositionWithValidator(model *types.FinancialModel, startDate string, cutInstant int64, overrides types.ModelOverrides, validate func(*types.FinancialModel) []types.ModelValidationIssue, includeScheduleOccurrences bool) (*preparedPosition, error) {
	if model == nil {
		model = &types.FinancialModel{Evaluations: types.EmptyEvaluationTables()}
	}
	effectiveModel := types.ApplyModelOverrides(*model, overrides)
	issues := validate(&effectiveModel)
	validationErrors := []types.ModelValidationIssue{}
	for _, issue := range issues {
		if issue.Severity == types.SeverityError {
			validationErrors = append(validationErrors, issue)
		}
	}
	if len(validationErrors) > 0 {
		return nil, &SimulationPreparationError{Issues: validationErrors}
	}

	if !IsValidIsoDate(startDate) {
		return nil, &SimulationPreparationError{Issues: []types.ModelValidationIssue{{
			Severity: types.SeverityError,
			Code:     "settings.projection-start.format",
			Message:  fmt.Sprintf("fallbackProjectionStartDate must be a YYYY-MM-DD calendar date (got %q).", startDate),
			Path:     []any{"fallbackProjectionStartDate"},
		}}}
	}
	applied, err := applyChronologicalHistoryAtMode(&effectiveModel, startDate, cutInstant, includeScheduleOccurrences)
	if err != nil {
		return nil, err
	}

	return &preparedPosition{effectiveModel, applied.state, applied.snapshots, applied.includeStartDateEvents, applied}, nil
}

// PrepareSimulationRequest resolves overrides, validation, history, and dates.
// Recorded actuals set the authoritative balance baseline and historical rows
// through the cut. Modeled replay separately retains transaction ledgers, while
// simulation continues after the cut without repeating applied occurrences.
func PrepareSimulationRequest(model *types.FinancialModel, settings *types.ProjectionRuntimeSettings, overrides types.ModelOverrides, monteCarloSample *types.MonteCarloSample) (*types.PreparedProjection, error) {
	if err := requireResimulationAllowed("PrepareSimulationRequest"); err != nil {
		return nil, err
	}
	startDate := string(settings.FallbackProjectionStartDate)
	position, err := prepareRecordedProjectionPosition(model, settings, overrides)
	if err != nil {
		return nil, err
	}
	cutInstant := dayCloseUnix(startDate)
	if settings.AsOfInstant != nil {
		cutInstant = *settings.AsOfInstant
	}
	if err := applyModeledHistory(position, startDate, cutInstant); err != nil {
		return nil, err
	}
	effectiveModel := position.model
	prepared := &types.PreparedProjection{
		EffectiveModel:      effectiveModel,
		HistoricalSnapshots: position.snapshots,
		Request: types.SimulationRequest{
			Model: types.SimulationInputs{
				Accounts:         effectiveModel.Accounts,
				Transactions:     effectiveModel.Transactions,
				Schedules:        effectiveModel.Schedules,
				PaymentTerms:     effectiveModel.PaymentTerms,
				PlannedPurchases: effectiveModel.PlannedPurchases,
			},
			InitialState:           *position.state,
			StartDate:              settings.FallbackProjectionStartDate,
			EndDate:                AddYearsClamped(settings.FallbackProjectionStartDate, settings.HorizonYears),
			IncludeStartDateEvents: true,
			MonteCarloSample:       monteCarloSample,
			HistoryCutInstant:      cutInstant,
		},
	}
	return prepared, nil
}
