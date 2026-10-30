package domain

import (
	"fmt"
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

func replayHistoricalState(document *types.FinancialModelDocument, projectionStartDate string) (*SimulationState, []types.HistoricalObservationSnapshot, bool, error) {
	replay, err := replayChronologicalHistory(document, projectionStartDate)
	if err != nil {
		return nil, nil, false, err
	}
	return replay.state, replay.snapshots, replay.includeStartDateEvents, nil
}

// historicalReplay is the chronological replay result shared by current
// position and projection preparation: one calculation authority.
type historicalReplay struct {
	state                  *SimulationState
	snapshots              []types.HistoricalObservationSnapshot
	includeStartDateEvents bool
	latestObserved         map[string]types.Checkpoint
}

// replayChronologicalHistory replays through the end of projectionStartDate.
func replayChronologicalHistory(document *types.FinancialModelDocument, projectionStartDate string) (*historicalReplay, error) {
	return replayChronologicalHistoryAt(document, projectionStartDate, dayCloseUnix(projectionStartDate))
}

// historyEvent is the single unified replay input: either one posting/rule
// occurrence at its effective instant or one absolute observation. There
// are no date-wide gates, no per-day phases, and no identity-suppression
// maps: one sorted list, one forward pass.
type historyEvent struct {
	instant       int64
	isObservation bool
	checkpoint    types.Checkpoint
	occurrence    DatedPostingOccurrence
	execDate      string
	seq           int
}

// replayChronologicalHistoryAt replays one sorted event stream through the
// cut instant. Every event at or before cutInstant replays; everything
// after is future. Observations SET their account balance; postings CHANGE
// balances; a later observation SETS again and records the
// observed-vs-modeled discrepancy.
//
//   - Recurrence instances take effect at the day-close instant of their
//     date, so a rule at 23:59:59 executes BEFORE an observation at the
//     same instant (movement before anchor preserves day-close meaning).
//   - Every one-time posting carries its stored Unix time, including 00:00.
//   - Postings execute before an observation on a tie; owner observations
//     execute last at the same instant.
//   - Each account anchors independently. Observations sort by instant, so
//     arrival order never matters and a backdated observation cannot roll
//     the latest state back.
func replayChronologicalHistoryAt(document *types.FinancialModelDocument, projectionStartDate string, cutInstant int64) (*historicalReplay, error) {
	for _, checkpoint := range document.Checkpoints {
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
	// start day itself so start-day movements still replay exactly once.
	earliestDay := projectionStartDate
	for _, checkpoint := range document.Checkpoints {
		day := FormatIsoDate(time.Unix(CheckpointInstant(checkpoint), 0).UTC())
		if CompareIsoDates(day, earliestDay) < 0 {
			earliestDay = day
		}
	}
	var history ResolvedOccurrences
	history = ResolveOccurrences(document.RecurrenceRules, document.Postings, earliestDay, projectionStartDate, true)

	events := []historyEvent{}
	seq := 0
	addedPosting := map[string]bool{}
	for date, occurrences := range history.ByDate {
		for _, occurrence := range occurrences {
			if occurrence.Posting.Purchase != nil {
				continue
			}
			if occurrence.Posting.Pending || occurrence.Posting.Void {
				continue
			}
			if !occurrence.Posting.Enabled {
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
				addedPosting[occurrence.Posting.ID] = true
			}
		}
	}
	// Manual postings before the rule-expansion lower bound still replay:
	// history has no lower bound for confirmed actuals, only the cut.
	for index := range document.Postings {
		posting := &document.Postings[index]
		if addedPosting[posting.ID] {
			continue
		}
		if posting.Purchase != nil || posting.Pending || posting.Void || !posting.Enabled {
			continue
		}
		day := postingDay(posting)
		if day == "" || CompareIsoDates(day, projectionStartDate) > 0 {
			continue
		}
		instant := PostingInstant(posting)
		if instant <= 0 || instant > cutInstant {
			continue
		}
		events = append(events, historyEvent{
			instant:       instant,
			isObservation: false,
			occurrence:    DatedPostingOccurrence{Posting: posting, Index: 1000000 + index, Rule: nil, DocPath: []any{"postings", index}},
			execDate:      day,
			seq:           seq,
		})
		seq++
	}
	for _, checkpoint := range document.Checkpoints {
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
		if tied := compareDatedPostingOccurrences(events[i].occurrence, events[j].occurrence); tied != 0 {
			return tied < 0
		}
		return events[i].seq < events[j].seq
	})

	transitions, err := CreateTransitionRuntime(types.FinancialModel{
		Accounts:         document.Accounts,
		Postings:         document.Postings,
		RecurrenceRules:  document.RecurrenceRules,
		PaymentTerms:     document.PaymentTerms,
		PlannedPurchases: document.PlannedPurchases,
	}, SimulationState{
		Balances:                     InitAccountBalances(document.Accounts),
		LatestRealizedPostingAmounts: map[string]float64{},
		RealizedPostingAmountsByYear: map[string]map[string]float64{},
	}, projectionStartDate, nil)
	if err != nil {
		return nil, err
	}

	latestObserved := map[string]types.Checkpoint{}
	historicalSnapshots := []types.HistoricalObservationSnapshot{}
	executeOccurrence := func(occurrence DatedPostingOccurrence, date string, historicalActual bool) error {
		_, execErr := transitions.ExecutePosting(occurrence, date, historicalActual)
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
				Code:     "posting.history.execution",
				Message: fmt.Sprintf("Could not replay posting '%s' on %s: %s",
					occurrence.Posting.ID, date, message),
				Path: occurrence.DocPath,
			}}}
		}
		return nil
	}

	// One forward pass over the sorted stream. Daily snapshots sample the
	// running state: each calendar day flushes once when the next day
	// begins (and once at the end), so rows stay samples, not phases.
	var checkpointCorrections []types.CheckpointCorrection
	currentDay := ""
	flushDay := func() {
		if currentDay == "" {
			return
		}
		snapshot := types.HistoricalObservationSnapshot{
			Date:     currentDay,
			Balances: SnapshotBalances(transitions.State.Balances),
		}
		if len(checkpointCorrections) > 0 {
			snapshot.CheckpointCorrections = checkpointCorrections
			checkpointCorrections = nil
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
			transitions.State.Balances[observation.AccountID] = observation.Balance
			checkpointCorrections = append(checkpointCorrections, types.CheckpointCorrection{
				AccountID:       observation.AccountID,
				ObservedBalance: observation.Balance,
				ModeledBalance:  modeledBalance,
				Adjustment:      observation.Balance - modeledBalance,
			})
			latestObserved[observation.AccountID] = observation
			continue
		}
		historicalActual := event.occurrence.Rule == nil
		if err := executeOccurrence(event.occurrence, event.execDate, historicalActual); err != nil {
			return nil, err
		}
	}
	flushDay()

	return &historicalReplay{
		state:                  &transitions.State,
		snapshots:              historicalSnapshots,
		includeStartDateEvents: true,
		latestObserved:         latestObserved,
	}, nil
}

type preparedPosition struct {
	document               types.FinancialModelDocument
	state                  *SimulationState
	snapshots              []types.HistoricalObservationSnapshot
	includeStartDateEvents bool
	replay                 *historicalReplay
}

func preparePosition(document *types.FinancialModelDocument, startDate string, overrides types.ModelOverrides) (*preparedPosition, error) {
	return preparePositionAt(document, startDate, dayCloseUnix(startDate), overrides)
}

func preparePositionAt(document *types.FinancialModelDocument, startDate string, cutInstant int64, overrides types.ModelOverrides) (*preparedPosition, error) {
	if document == nil {
		document = &types.FinancialModelDocument{Evaluations: types.EmptyEvaluationTables()}
	}
	effectiveDocument := types.ApplyModelOverrides(*document, overrides)
	issues := ValidateFinancialModel(&effectiveDocument)
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
	replay, err := replayChronologicalHistoryAt(&effectiveDocument, startDate, cutInstant)
	if err != nil {
		return nil, err
	}

	return &preparedPosition{effectiveDocument, replay.state, replay.snapshots, replay.includeStartDateEvents, replay}, nil
}

// PrepareSimulationRequest resolves overrides, validation, history, and dates.
// History replays through the cut instant and the simulation continues after
// it, skipping already-replayed occurrences by the same cut so nothing
// executes twice.
func PrepareSimulationRequest(document *types.FinancialModelDocument, settings *types.ProjectionRuntimeSettings, overrides types.ModelOverrides, monteCarloSample *types.MonteCarloSample) (*types.PreparedProjection, error) {
	if err := requireResimulationAllowed("PrepareSimulationRequest"); err != nil {
		return nil, err
	}
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
	position, err := preparePositionAt(document, startDate, cutInstant, overrides)
	if err != nil {
		return nil, err
	}
	effectiveDocument := position.document
	prepared := &types.PreparedProjection{
		EffectiveDocument:   effectiveDocument,
		HistoricalSnapshots: position.snapshots,
		Request: types.SimulationRequest{
			Model: types.FinancialModel{
				Accounts:         effectiveDocument.Accounts,
				Postings:         effectiveDocument.Postings,
				RecurrenceRules:  effectiveDocument.RecurrenceRules,
				PaymentTerms:     effectiveDocument.PaymentTerms,
				PlannedPurchases: effectiveDocument.PlannedPurchases,
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
