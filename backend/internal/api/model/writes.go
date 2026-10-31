package model

import (
	"github.com/danielgtaylor/huma/v2"
	"github.com/simhozebs/net-worth-estimator/backend/internal/api/internal/modelstate"
	"github.com/simhozebs/net-worth-estimator/backend/internal/domain"
	"github.com/simhozebs/net-worth-estimator/backend/internal/store"
	"github.com/simhozebs/net-worth-estimator/backend/internal/types"
)

// Row writes replace the retired whole-model PUT. Each handler loads
// the stored model, applies one change in memory, runs the
// authoritative validator, and persists only when no error-severity issue
// exists. Last write wins: concurrent row edits overwrite each other,
// which is correct for a single writer and revisable later.
type rowResultBody[T any] struct {
	Row       T                            `json:"row"`
	Issues    []types.ModelValidationIssue `json:"issues"`
	Persisted bool                         `json:"persisted"`
	Revision  string                       `json:"revision"`
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
// warnings. Handlers wrap row/issues/persisted/revision in their output
// shape. Evaluation writes use it so a broken forecast cannot be saved.
func runRowWrite[T any](s *handler, mutate func(model *types.FinancialModel), persist func() (T, error)) (T, []types.ModelValidationIssue, bool, string, error) {
	return runRowWriteWithValidator(s, mutate, persist, domain.ValidateFinancialModel, domain.ValidateFinancialModel)
}

// runFinanceRowWrite validates and persists one ordinary finance row.
// The gate is ValidateFinanceWriteChange: the candidate's finance errors
// plus evaluation reference errors newly introduced relative to the
// stored baseline. Preexisting forecast reference, config-shape, and
// identity errors never block repairing unrelated valid financial rows.
// Success-path issues carry finance-only warnings; forecast diagnostics
// stay on the whole-model read.
func runFinanceRowWrite[T any](s *handler, mutate func(model *types.FinancialModel), persist func() (T, error)) (T, []types.ModelValidationIssue, bool, string, error) {
	var baseline []types.ModelValidationIssue
	return runRowWriteWithValidator(s, func(model *types.FinancialModel) {
		// Capture references before helpers compact shared backing arrays.
		baseline = domain.EvaluationReferenceIssues(model)
		mutate(model)
	}, persist, func(candidate *types.FinancialModel) []types.ModelValidationIssue {
		return domain.ValidateFinanceWriteChange(baseline, candidate)
	}, domain.ValidateFinanceModel)
}

func runRowWriteWithValidator[T any](s *handler, mutate func(model *types.FinancialModel), persist func() (T, error), validateCandidate, validateStored func(*types.FinancialModel) []types.ModelValidationIssue) (T, []types.ModelValidationIssue, bool, string, error) {
	var zero T
	model, err := s.store.LoadModel()
	if err != nil {
		return zero, nil, false, "", huma.Error500InternalServerError(err.Error())
	}
	if model == nil {
		model = &types.FinancialModel{Evaluations: types.EmptyEvaluationTables()}
	}
	mutate(model)
	issues := validateCandidate(model)
	if issues == nil {
		issues = []types.ModelValidationIssue{}
	}
	if hasErrorIssues(issues) {
		// The invalid candidate differs from stored state. Reload its identity.
		revision, err := modelstate.CurrentRevision(s.store)
		if err != nil {
			return zero, nil, false, "", huma.Error500InternalServerError(err.Error())
		}
		return zero, issues, false, revision, nil
	}
	row, err := persist()
	if err != nil {
		return zero, nil, false, "", modelstate.WriteError(err)
	}
	// Re-read warnings against the persisted model so the response
	// reflects stored state, not the request echo.
	model, err = s.store.LoadModel()
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

type reorderOutput = modelstate.ReorderOutput
