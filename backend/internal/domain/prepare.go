package domain

import (
	"fmt"
	"sort"

	"github.com/simhozebs/net-worth-estimator/backend/internal/types"
)

// Request preparation ported from simulation/prepareSimulation.ts.

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

func replayHistoricalState(document *types.FinancialModelDocument, projectionStartDate string, incomeData *types.IncomeDataSnapshot) (*SimulationState, []types.HistoricalObservationSnapshot, bool, error) {
	for _, checkpoint := range document.Checkpoints {
		if CompareIsoDates(checkpoint.Date, projectionStartDate) > 0 {
			return nil, nil, false, &SimulationPreparationError{Issues: []types.ModelValidationIssue{{
				Severity: types.SeverityError,
				Code:     "checkpoint.date.future",
				Message: fmt.Sprintf("Checkpoint for '%s' is dated after the projection start (%s).",
					checkpoint.AccountID, checkpoint.Date),
				Path: []any{"checkpoints"},
			}}}
		}
	}
	checkpointsByDate := map[string][]types.Checkpoint{}
	for _, checkpoint := range document.Checkpoints {
		checkpointsByDate[checkpoint.Date] = append(checkpointsByDate[checkpoint.Date], checkpoint)
	}
	hasStartDateCheckpoint := false
	if _, ok := checkpointsByDate[projectionStartDate]; ok {
		hasStartDateCheckpoint = true
	}
	occurrencesByDate := map[string][]DatedPostingOccurrence{}

	for index := range document.Postings {
		posting := &document.Postings[index]
		isBeforeStart := CompareIsoDates(posting.StartDate, projectionStartDate) < 0
		isStartWithCheckpoint := hasStartDateCheckpoint && posting.StartDate == projectionStartDate
		if posting.Enabled && posting.Frequency == types.FrequencyOnce && (isBeforeStart || isStartWithCheckpoint) {
			occurrencesByDate[posting.StartDate] = append(occurrencesByDate[posting.StartDate], DatedPostingOccurrence{Posting: posting, Index: index})
		}
	}

	earliestCheckpointDate := ""
	for index, checkpoint := range document.Checkpoints {
		if index == 0 || CompareIsoDates(checkpoint.Date, earliestCheckpointDate) < 0 {
			earliestCheckpointDate = checkpoint.Date
		}
	}
	if earliestCheckpointDate != "" {
		recurringPostings := []types.Posting{}
		recurringIndexes := map[*types.Posting]int{}
		for index := range document.Postings {
			posting := &document.Postings[index]
			if posting.Frequency != types.FrequencyOnce {
				recurringPostings = append(recurringPostings, *posting)
			}
		}
		// Map back from copies to original indexes for stable ordering.
		recurringOccurrencesByDate := map[string][]DatedPostingOccurrence{}
		AddOccurrences(recurringPostings, recurringOccurrencesByDate, earliestCheckpointDate, projectionStartDate, true)
		for date, occurrences := range recurringOccurrencesByDate {
			if !hasStartDateCheckpoint && date == projectionStartDate {
				continue
			}
			for _, occurrence := range occurrences {
				originalIndex := -1
				for index := range document.Postings {
					if &document.Postings[index] == occurrence.Posting {
						originalIndex = index
						break
					}
				}
				if originalIndex < 0 {
					for index := range document.Postings {
						if document.Postings[index].ID == occurrence.Posting.ID {
							originalIndex = index
							break
						}
					}
				}
				if originalIndex >= 0 {
					occurrencesByDate[date] = append(occurrencesByDate[date], DatedPostingOccurrence{
						Posting: &document.Postings[originalIndex],
						Index:   originalIndex,
					})
				}
			}
		}
		_ = recurringIndexes
	}

	transitions, err := CreateTransitionRuntime(types.FinancialModel{
		Accounts: document.Accounts,
		Postings: document.Postings,
	}, SimulationState{
		Balances:                     InitAccountBalances(document.Accounts),
		LatestRealizedPostingAmounts: map[string]float64{},
		RealizedPostingAmountsByYear: map[string]map[string]float64{},
	}, projectionStartDate, nil, incomeData)
	if err != nil {
		return nil, nil, false, err
	}

	historicalSnapshots := []types.HistoricalObservationSnapshot{}
	historicalDatesSet := map[string]bool{}
	for date := range occurrencesByDate {
		historicalDatesSet[date] = true
	}
	for date := range checkpointsByDate {
		historicalDatesSet[date] = true
	}
	historicalDates := make([]string, 0, len(historicalDatesSet))
	for date := range historicalDatesSet {
		historicalDates = append(historicalDates, date)
	}
	sort.Slice(historicalDates, func(i, j int) bool { return CompareIsoDates(historicalDates[i], historicalDates[j]) < 0 })

	for _, date := range historicalDates {
		occurrences := make([]DatedPostingOccurrence, len(occurrencesByDate[date]))
		copy(occurrences, occurrencesByDate[date])
		sort.SliceStable(occurrences, func(i, j int) bool {
			if occurrences[i].Posting.Priority != occurrences[j].Posting.Priority {
				return occurrences[i].Posting.Priority < occurrences[j].Posting.Priority
			}
			return occurrences[i].Index < occurrences[j].Index
		})
		for _, occurrence := range occurrences {
			if _, err := transitions.ExecutePosting(occurrence, date); err != nil {
				message := err.Error()
				switch typed := err.(type) {
				case *AmountResolutionError:
					message = typed.Message
				case *IncomeResolutionError:
					message = typed.Message
				case *EvalError:
					message = typed.Message
				case *ParseError:
					message = typed.Error()
				}
				return nil, nil, false, &SimulationPreparationError{Issues: []types.ModelValidationIssue{{
					Severity: types.SeverityError,
					Code:     "posting.history.execution",
					Message: fmt.Sprintf("Could not replay posting '%s' on %s: %s",
						occurrence.Posting.ID, date, message),
					Path: []any{"postings", occurrence.Index},
				}}}
			}
		}

		var checkpointCorrections []types.CheckpointCorrection
		for _, checkpoint := range checkpointsByDate[date] {
			modeledBalance := transitions.State.Balances[checkpoint.AccountID]
			transitions.State.Balances[checkpoint.AccountID] = checkpoint.Balance
			checkpointCorrections = append(checkpointCorrections, types.CheckpointCorrection{
				AccountID:       checkpoint.AccountID,
				ObservedBalance: checkpoint.Balance,
				ModeledBalance:  modeledBalance,
				Adjustment:      checkpoint.Balance - modeledBalance,
			})
		}
		snapshot := types.HistoricalObservationSnapshot{
			Date:     date,
			Balances: SnapshotBalances(transitions.State.Balances),
		}
		if len(checkpointCorrections) > 0 {
			snapshot.CheckpointCorrections = checkpointCorrections
		}
		historicalSnapshots = append(historicalSnapshots, snapshot)
	}

	return &transitions.State, historicalSnapshots, !hasStartDateCheckpoint, nil
}

// PrepareSimulationRequest resolves overrides, validation, history, and dates.
func PrepareSimulationRequest(document *types.FinancialModelDocument, settings *types.ProjectionRuntimeSettings, overrides types.ModelOverrides, monteCarloSample *types.MonteCarloSample, incomeData *types.IncomeDataSnapshot) (*types.PreparedProjection, error) {
	effectiveDocument := types.ApplyModelOverrides(*document, overrides)
	hasEnabledIncome := false
	for _, posting := range effectiveDocument.Postings {
		if posting.Enabled && posting.Amount.Resolver == "income" {
			hasEnabledIncome = true
			break
		}
	}
	if hasEnabledIncome && incomeData == nil {
		return nil, &SimulationPreparationError{Issues: []types.ModelValidationIssue{{
			Severity: types.SeverityError,
			Code:     "income-data.missing",
			Message:  "Income data is required to project an income posting.",
			Path:     []any{},
		}}}
	}
	issues := ValidateFinancialModel(&effectiveDocument, incomeData)
	validationErrors := []types.ModelValidationIssue{}
	for _, issue := range issues {
		if issue.Severity == types.SeverityError {
			validationErrors = append(validationErrors, issue)
		}
	}
	if len(validationErrors) > 0 {
		return nil, &SimulationPreparationError{Issues: validationErrors}
	}

	startDate := settings.FallbackProjectionStartDate
	if !IsValidIsoDate(startDate) {
		return nil, &SimulationPreparationError{Issues: []types.ModelValidationIssue{{
			Severity: types.SeverityError,
			Code:     "settings.projection-start.format",
			Message:  fmt.Sprintf("fallbackProjectionStartDate must be a YYYY-MM-DD calendar date (got %q).", startDate),
			Path:     []any{"fallbackProjectionStartDate"},
		}}}
	}
	state, historicalSnapshots, includeStartDateEvents, err := replayHistoricalState(&effectiveDocument, startDate, incomeData)
	if err != nil {
		return nil, err
	}

	prepared := &types.PreparedProjection{
		EffectiveDocument:   effectiveDocument,
		HistoricalSnapshots: historicalSnapshots,
		Request: types.SimulationRequest{
			Model: types.FinancialModel{
				Accounts: effectiveDocument.Accounts,
				Postings: effectiveDocument.Postings,
			},
			InitialState:           *state,
			StartDate:              startDate,
			EndDate:                AddYearsClamped(startDate, settings.HorizonYears),
			IncludeStartDateEvents: includeStartDateEvents,
			MonteCarloSample:       monteCarloSample,
			IncomeData:             incomeData,
		},
	}
	return prepared, nil
}
