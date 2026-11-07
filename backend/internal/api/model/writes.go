package model

import (
	"github.com/danielgtaylor/huma/v2"
	"github.com/simhozebs/net-worth-estimator/backend/internal/api/internal/modelstate"
	"github.com/simhozebs/net-worth-estimator/backend/internal/domain"
	"github.com/simhozebs/net-worth-estimator/backend/internal/store"
	"github.com/simhozebs/net-worth-estimator/backend/internal/types"
)

// Model writes replace the retired whole-model PUT. Each handler loads
// the stored model, applies one change in memory, runs the
// authoritative validator, and persists only when no error-severity issue
// exists. Last write wins: concurrent row edits overwrite each other,
// which is correct for a single writer and revisable later.
type writeResult[T any] struct {
	Result   T                            `json:"value"`
	Issues   []types.ModelValidationIssue `json:"issues"`
	Saved    bool                         `json:"saved"`
	Revision string                       `json:"revision"`
}

func hasErrorIssues(issues []types.ModelValidationIssue) bool {
	for _, issue := range issues {
		if issue.Severity == types.SeverityError {
			return true
		}
	}
	return false
}

// runRowWrite validates and persists one model-entry change with full
// validation (finance plus forecast evaluation configuration), then
// computes its revision from the stored snapshot used for response
// warnings. Handlers wrap row/issues/saved/revision in their output
// shape. Evaluation writes use it so a broken forecast cannot be saved.
func runRowWrite[T any](s *handler, mutate func(model *types.FinancialModel), persist func() (T, error)) (T, []types.ModelValidationIssue, bool, string, error) {
	return runRowWriteWithValidator(s.store, mutate, persist, domain.ValidateFinancialModel, domain.ValidateFinancialModel)
}

// runFinanceRowWrite validates and persists one ordinary finance row.
// The gate is ValidateFinanceWriteChange: the candidate's finance errors
// plus evaluation reference errors newly introduced relative to the
// stored baseline. Preexisting forecast reference, config-shape, and
// identity errors never block repairing unrelated valid financial rows.
// Success-path issues carry finance-only warnings; forecast diagnostics
// stay on the whole-model read.
func runFinanceRowWrite[T any](s *handler, mutate func(model *types.FinancialModel), persist func() (T, error)) (T, []types.ModelValidationIssue, bool, string, error) {
	return runFinanceRowWriteGuarded(s, nil, mutate, persist)
}

func runFinanceRowWriteGuarded[T any](s *handler, guard func(*types.FinancialModel) error, mutate func(model *types.FinancialModel), persist func() (T, error)) (T, []types.ModelValidationIssue, bool, string, error) {
	var baseline []types.ModelValidationIssue
	return runRowWriteWithValidator(s.store, func(model *types.FinancialModel) {
		// Capture references before helpers compact shared backing arrays.
		baseline = domain.EvaluationReferenceIssues(model)
		mutate(model)
	}, persist, func(candidate *types.FinancialModel) []types.ModelValidationIssue {
		return domain.ValidateFinanceWriteChange(baseline, candidate)
	}, domain.ValidateFinanceModel, guard)
}

// PersistFinanceSchedule validates and persists one generated recurrence rule
// through the ordinary finance write boundary, so pattern-to-new-rule
// creation shares the manual row-write contract: validation, revision, and
// last-write-wins.
// Generated rules append after the current maximum priority.
func PersistFinanceSchedule(st store.Store, rule types.Schedule) (types.Schedule, []types.ModelValidationIssue, bool, string, error) {
	resolved := rule
	return runFinanceRowWriteWithStore(st, func(model *types.FinancialModel) {
		max := -1
		for _, existing := range model.Schedules {
			if existing.Priority > max {
				max = existing.Priority
			}
		}
		resolved.Priority = max + 1
		model.Schedules = replaceByID(model.Schedules, resolved.ID, scheduleID, resolved)
	}, func() (types.Schedule, error) {
		return st.CreateSchedule(resolved)
	})
}

// runFinanceRowWriteWithStore is runFinanceRowWrite over an explicit store
// so pattern creation reuses the finance boundary without duplicating it.
func runFinanceRowWriteWithStore[T any](st store.Store, mutate func(model *types.FinancialModel), persist func() (T, error)) (T, []types.ModelValidationIssue, bool, string, error) {
	var baseline []types.ModelValidationIssue
	return runRowWriteWithValidator(st, func(model *types.FinancialModel) {
		baseline = domain.EvaluationReferenceIssues(model)
		mutate(model)
	}, persist, func(candidate *types.FinancialModel) []types.ModelValidationIssue {
		return domain.ValidateFinanceWriteChange(baseline, candidate)
	}, domain.ValidateFinanceModel)
}

func runRowWriteWithValidator[T any](st store.Store, mutate func(model *types.FinancialModel), persist func() (T, error), validateCandidate, validateStored func(*types.FinancialModel) []types.ModelValidationIssue, guards ...func(*types.FinancialModel) error) (T, []types.ModelValidationIssue, bool, string, error) {
	var zero T
	model, err := st.LoadModel()
	if err != nil {
		return zero, nil, false, "", huma.Error500InternalServerError(err.Error())
	}
	if model == nil {
		model = &types.FinancialModel{Evaluations: types.EmptyEvaluationTables()}
	}
	for _, guard := range guards {
		if guard != nil {
			if err := guard(model); err != nil {
				return zero, nil, false, "", err
			}
		}
	}
	mutate(model)
	issues := validateCandidate(model)
	if issues == nil {
		issues = []types.ModelValidationIssue{}
	}
	if hasErrorIssues(issues) {
		// The invalid candidate differs from stored state. Reload its identity.
		revision, err := modelstate.CurrentRevision(st)
		if err != nil {
			return zero, nil, false, "", huma.Error500InternalServerError(err.Error())
		}
		return zero, issues, false, revision, nil
	}
	row, err := persist()
	if err != nil {
		return zero, nil, false, "", modelstate.WriteError(err)
	}
	// Re-read warnings against the saved model so the response
	// reflects stored state, not the request echo.
	model, err = st.LoadModel()
	if err != nil {
		return zero, nil, false, "", huma.Error500InternalServerError(err.Error())
	}
	issues = validateStored(model)
	if issues == nil {
		issues = []types.ModelValidationIssue{}
	}
	revision, err := store.ModelETag(model)
	if err != nil {
		return zero, nil, false, "", huma.Error500InternalServerError(err.Error())
	}
	return row, issues, true, revision, nil
}

func replaceByID[T any](rows []T, id string, getID func(T) string, value T) []T {
	for i, row := range rows {
		if getID(row) == id {
			rows[i] = value
			return rows
		}
	}
	return append(rows, value)
}

func removeByID[T any](rows []T, id string, getID func(T) string) []T {
	kept := rows[:0]
	for _, row := range rows {
		if getID(row) != id {
			kept = append(kept, row)
		}
	}
	return kept
}

func moveBeforeID[T any](rows []T, id, beforeID string, getID func(T) string) []T {
	kept := rows[:0]
	for _, row := range rows {
		if getID(row) != id {
			kept = append(kept, row)
		}
	}
	if beforeID == "" {
		for _, row := range rows {
			if getID(row) == id {
				return append(kept, row)
			}
		}
		return kept
	}
	result := make([]T, 0, len(rows))
	for _, row := range kept {
		if getID(row) == beforeID {
			for _, original := range rows {
				if getID(original) == id {
					result = append(result, original)
				}
			}
		}
		result = append(result, row)
	}
	return result
}

type reorderInput struct {
	Body struct {
		ID       string `json:"id"`
		BeforeID string `json:"beforeId,omitempty"`
	} `json:"body"`
}
