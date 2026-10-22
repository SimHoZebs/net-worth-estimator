package api

import (
	"github.com/danielgtaylor/huma/v2"
	"github.com/simhozebs/net-worth-estimator/backend/internal/store"
	"github.com/simhozebs/net-worth-estimator/backend/internal/types"
)

// Row writes replace the retired whole-document PUT. Each handler loads
// the stored document, applies one change in memory, runs the
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

func rowWriteError(err error) error {
	switch {
	case store.IsNotFound(err):
		return huma.Error404NotFound("row not found")
	case store.IsIDConflict(err):
		return huma.Error409Conflict("id already exists")
	case store.IsInvalidID(err):
		return huma.Error422UnprocessableEntity("posting id must be a canonical UUID")
	case store.IsSyncOwned(err):
		return huma.Error422UnprocessableEntity("sync-owned rows are read-only")
	case store.IsAccountMissing(err):
		return huma.Error422UnprocessableEntity("referenced account does not exist")
	default:
		return huma.Error500InternalServerError(err.Error())
	}
}

func currentRevision(s *Server) (string, error) {
	document, err := s.store.LoadDocument()
	if err != nil {
		return "", err
	}
	return store.DocumentETag(document)
}

// runRowWrite validates and persists one plan-entry change, then computes
// its revision from the stored snapshot used for response warnings.
// Handlers wrap row/issues/persisted/revision in their output shape.
func runRowWrite[T any](s *Server, mutate func(document *types.FinancialModelDocument), persist func() (T, error)) (T, []types.ModelValidationIssue, bool, string, error) {
	var zero T
	document, err := s.store.LoadDocument()
	if err != nil {
		return zero, nil, false, "", huma.Error500InternalServerError(err.Error())
	}
	if document == nil {
		document = &types.FinancialModelDocument{Evaluations: types.EmptyEvaluationTables()}
	}
	mutate(document)
	issues := domainValidate(document)
	if issues == nil {
		issues = []types.ModelValidationIssue{}
	}
	if hasErrorIssues(issues) {
		// The invalid candidate differs from stored state. Reload its identity.
		revision, err := currentRevision(s)
		if err != nil {
			return zero, nil, false, "", huma.Error500InternalServerError(err.Error())
		}
		return zero, issues, false, revision, nil
	}
	row, err := persist()
	if err != nil {
		return zero, nil, false, "", rowWriteError(err)
	}
	// Re-read warnings against the persisted document so the response
	// reflects stored state, not the request echo.
	document, err = s.store.LoadDocument()
	if err != nil {
		return zero, nil, false, "", huma.Error500InternalServerError(err.Error())
	}
	issues = domainValidate(document)
	if issues == nil {
		issues = []types.ModelValidationIssue{}
	}
	revision, err := store.DocumentETag(document)
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

type reorderOutput struct {
	Body struct {
		Revision string `json:"revision"`
	} `json:"body"`
}
