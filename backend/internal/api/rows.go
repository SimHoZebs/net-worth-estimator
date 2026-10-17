package api

import (
	"context"

	"github.com/danielgtaylor/huma/v2"
	"github.com/simhozebs/net-worth-estimator/backend/internal/store"
	"github.com/simhozebs/net-worth-estimator/backend/internal/types"
)

// Row writes replace the retired whole-document PUT. Each handler loads
// the stored document plus income, applies one change in memory, runs the
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
	case store.IsReservedID(err):
		return huma.Error422UnprocessableEntity("id uses the reserved sync namespace")
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

// applyRowChange validates one in-memory mutation and persists it with
// persist when clean. It returns the issues and post-write revision.
func applyRowChange[T any](s *Server, mutate func(document *types.FinancialModelDocument), persist func() (T, error)) (T, []types.ModelValidationIssue, bool, error) {
	var zero T
	document, incomeData, err := s.store.LoadDocumentAndIncomeData()
	if err != nil {
		return zero, nil, false, huma.Error500InternalServerError(err.Error())
	}
	if document == nil {
		empty := &types.FinancialModelDocument{Evaluations: types.EmptyEvaluationTables()}
		document = empty
		if incomeData == nil {
			incomeData = &types.IncomeDataSnapshot{}
		}
	}
	mutate(document)
	issues := domainValidate(document, incomeData)
	if issues == nil {
		issues = []types.ModelValidationIssue{}
	}
	if hasErrorIssues(issues) {
		return zero, issues, false, nil
	}
	row, err := persist()
	if err != nil {
		return zero, nil, false, rowWriteError(err)
	}
	// Re-read warnings against the persisted document so the response
	// reflects stored state, not the request echo.
	document, incomeData, err = s.store.LoadDocumentAndIncomeData()
	if err != nil {
		return zero, nil, false, huma.Error500InternalServerError(err.Error())
	}
	issues = domainValidate(document, incomeData)
	if issues == nil {
		issues = []types.ModelValidationIssue{}
	}
	return row, issues, true, nil
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

type accountBody struct {
	ID         *string           `json:"id,omitempty"`
	Name       string            `json:"name"`
	Kind       types.AccountKind `json:"kind"`
	MinBalance *float64          `json:"minBalance,omitempty"`
	MaxBalance *float64          `json:"maxBalance,omitempty"`
	Color      *string           `json:"color,omitempty"`
	Enabled    bool              `json:"enabled"`
	// Source is accepted and ignored: accounts carry no ownership flag.
	// Row ownership lives in checkpoints/postings ("model" | "simplefin")
	// plus account_links, mirroring the retired whole-document PUT contract.
	Source *string `json:"source,omitempty"`
}

func (b accountBody) toAccount(id string) types.Account {
	out := types.Account{
		Name: b.Name, Kind: b.Kind,
		MinBalance: b.MinBalance, MaxBalance: b.MaxBalance,
		Color: b.Color, Enabled: b.Enabled,
	}
	if b.ID != nil {
		out.ID = *b.ID
	}
	if id != "" {
		out.ID = id
	}
	return out
}

type accountInput struct {
	Body accountBody `json:"body"`
}

type accountOutput struct {
	Body rowResultBody[types.Account] `json:"body"`
}

func accountID(account types.Account) string { return account.ID }

func (s *Server) createAccount(_ context.Context, input *accountInput) (*accountOutput, error) {
	account := input.Body.toAccount("")
	row, issues, persisted, err := applyRowChange(s, func(document *types.FinancialModelDocument) {
		document.Accounts = replaceByID(document.Accounts, account.ID, accountID, account)
	}, func() (types.Account, error) {
		return s.store.CreateAccount(account)
	})
	if err != nil {
		return nil, err
	}
	revision, revErr := currentRevision(s)
	if revErr != nil {
		return nil, huma.Error500InternalServerError(revErr.Error())
	}
	return &accountOutput{Body: rowResultBody[types.Account]{Row: row, Issues: issues, Persisted: persisted, Revision: revision}}, nil
}

func (s *Server) updateAccount(_ context.Context, input *struct {
	ID   string      `path:"id"`
	Body accountBody `json:"body"`
}) (*accountOutput, error) {
	account := input.Body.toAccount(input.ID)
	row, issues, persisted, err := applyRowChange(s, func(document *types.FinancialModelDocument) {
		document.Accounts = replaceByID(document.Accounts, account.ID, accountID, account)
	}, func() (types.Account, error) {
		return s.store.UpdateAccount(account)
	})
	if err != nil {
		return nil, err
	}
	revision, revErr := currentRevision(s)
	if revErr != nil {
		return nil, huma.Error500InternalServerError(revErr.Error())
	}
	return &accountOutput{Body: rowResultBody[types.Account]{Row: row, Issues: issues, Persisted: persisted, Revision: revision}}, nil
}

func (s *Server) deleteAccount(_ context.Context, input *struct {
	ID string `path:"id"`
}) (*struct {
	Body struct {
		DeletedID string                       `json:"deletedId"`
		Issues    []types.ModelValidationIssue `json:"issues"`
		Persisted bool                         `json:"persisted"`
		Revision  string                       `json:"revision"`
	} `json:"body"`
}, error) {
	id := input.ID
	_, issues, persisted, err := applyRowChange(s, func(document *types.FinancialModelDocument) {
		document.Accounts = removeByID(document.Accounts, id, accountID)
	}, func() (struct{}, error) {
		return struct{}{}, s.store.DeleteAccount(id)
	})
	if err != nil {
		return nil, err
	}
	revision, revErr := currentRevision(s)
	if revErr != nil {
		return nil, huma.Error500InternalServerError(revErr.Error())
	}
	output := &struct {
		Body struct {
			DeletedID string                       `json:"deletedId"`
			Issues    []types.ModelValidationIssue `json:"issues"`
			Persisted bool                         `json:"persisted"`
			Revision  string                       `json:"revision"`
		} `json:"body"`
	}{}
	output.Body.DeletedID = id
	output.Body.Issues = issues
	output.Body.Persisted = persisted
	output.Body.Revision = revision
	return output, nil
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

func (s *Server) moveAccount(_ context.Context, input *reorderInput) (*reorderOutput, error) {
	id, beforeID := input.Body.ID, input.Body.BeforeID
	_, _, _, err := applyRowChange(s, func(document *types.FinancialModelDocument) {
		document.Accounts = moveBeforeID(document.Accounts, id, beforeID, accountID)
	}, func() (struct{}, error) {
		return struct{}{}, s.store.MoveAccount(id, beforeID)
	})
	if err != nil {
		return nil, err
	}
	revision, revErr := currentRevision(s)
	if revErr != nil {
		return nil, huma.Error500InternalServerError(revErr.Error())
	}
	return &reorderOutput{Body: struct {
		Revision string `json:"revision"`
	}{Revision: revision}}, nil
}

type postingBody struct {
	ID              *string                       `json:"id,omitempty"`
	Name            string                        `json:"name"`
	SourceAccountID *string                       `json:"sourceAccountId,omitempty"`
	Destinations    []string                      `json:"destinations,omitempty"`
	Amount          types.PostingAmountResolution `json:"amount"`
	Date            types.IsoDate                 `json:"date"`
	Claim           *types.PostingClaim           `json:"claim,omitempty"`
	Priority        int                           `json:"priority"`
	Enabled         bool                          `json:"enabled"`
	// Source is accepted and ignored: ownership is server-computed,
	// mirroring the retired whole-document PUT contract.
	Source *string `json:"source,omitempty"`
}

func (b postingBody) toPosting(id string) types.Posting {
	out := types.Posting{
		Name: b.Name, SourceAccountID: b.SourceAccountID,
		Destinations: b.Destinations, Amount: b.Amount, Date: b.Date,
		Claim: b.Claim, Priority: b.Priority, Enabled: b.Enabled,
	}
	if b.ID != nil {
		out.ID = *b.ID
	}
	if id != "" {
		out.ID = id
	}
	return out
}

type postingInput struct {
	Body postingBody `json:"body"`
}

type postingOutput struct {
	Body rowResultBody[types.Posting] `json:"body"`
}

func postingID(posting types.Posting) string { return posting.ID }

func (s *Server) createPosting(_ context.Context, input *postingInput) (*postingOutput, error) {
	posting := input.Body.toPosting("")
	row, issues, persisted, err := applyRowChange(s, func(document *types.FinancialModelDocument) {
		document.Postings = replaceByID(document.Postings, posting.ID, postingID, posting)
	}, func() (types.Posting, error) {
		return s.store.CreatePosting(posting)
	})
	if err != nil {
		return nil, err
	}
	revision, revErr := currentRevision(s)
	if revErr != nil {
		return nil, huma.Error500InternalServerError(revErr.Error())
	}
	if persisted {
		row.Source = store.SourceModel
	}
	return &postingOutput{Body: rowResultBody[types.Posting]{Row: row, Issues: issues, Persisted: persisted, Revision: revision}}, nil
}

func (s *Server) updatePosting(_ context.Context, input *struct {
	ID   string      `path:"id"`
	Body postingBody `json:"body"`
}) (*postingOutput, error) {
	posting := input.Body.toPosting(input.ID)
	row, issues, persisted, err := applyRowChange(s, func(document *types.FinancialModelDocument) {
		document.Postings = replaceByID(document.Postings, posting.ID, postingID, posting)
	}, func() (types.Posting, error) {
		return s.store.UpdatePosting(posting)
	})
	if err != nil {
		return nil, err
	}
	revision, revErr := currentRevision(s)
	if revErr != nil {
		return nil, huma.Error500InternalServerError(revErr.Error())
	}
	if persisted {
		row.Source = store.SourceModel
	}
	return &postingOutput{Body: rowResultBody[types.Posting]{Row: row, Issues: issues, Persisted: persisted, Revision: revision}}, nil
}

func (s *Server) deletePosting(_ context.Context, input *struct {
	ID string `path:"id"`
}) (*reorderOutput, error) {
	id := input.ID
	_, _, _, err := applyRowChange(s, func(document *types.FinancialModelDocument) {
		document.Postings = removeByID(document.Postings, id, postingID)
	}, func() (struct{}, error) {
		return struct{}{}, s.store.DeletePosting(id)
	})
	if err != nil {
		return nil, err
	}
	revision, revErr := currentRevision(s)
	if revErr != nil {
		return nil, huma.Error500InternalServerError(revErr.Error())
	}
	return &reorderOutput{Body: struct {
		Revision string `json:"revision"`
	}{Revision: revision}}, nil
}

func (s *Server) movePosting(_ context.Context, input *reorderInput) (*reorderOutput, error) {
	id, beforeID := input.Body.ID, input.Body.BeforeID
	_, _, _, err := applyRowChange(s, func(document *types.FinancialModelDocument) {
		document.Postings = moveBeforeID(document.Postings, id, beforeID, postingID)
	}, func() (struct{}, error) {
		return struct{}{}, s.store.MovePosting(id, beforeID)
	})
	if err != nil {
		return nil, err
	}
	revision, revErr := currentRevision(s)
	if revErr != nil {
		return nil, huma.Error500InternalServerError(revErr.Error())
	}
	return &reorderOutput{Body: struct {
		Revision string `json:"revision"`
	}{Revision: revision}}, nil
}

type ruleBody struct {
	ID               *string                       `json:"id,omitempty"`
	Name             string                        `json:"name"`
	SourceAccountID  *string                       `json:"sourceAccountId,omitempty"`
	Destinations     []string                      `json:"destinations,omitempty"`
	Amount           types.PostingAmountResolution `json:"amount"`
	Frequency        types.RecurrenceFrequency     `json:"frequency"`
	AnnualRate       float64                       `json:"annualRate"`
	AnnualGrowthRate float64                       `json:"annualGrowthRate"`
	Volatility       float64                       `json:"volatility"`
	StartDate        types.IsoDate                 `json:"startDate"`
	EndDate          *types.IsoDate                `json:"endDate,omitempty"`
	AnnualCap        *float64                      `json:"annualCap,omitempty"`
	Priority         int                           `json:"priority"`
	Enabled          bool                          `json:"enabled"`
}

func (b ruleBody) toRule(id string) types.RecurrenceRule {
	out := types.RecurrenceRule{
		Name: b.Name, SourceAccountID: b.SourceAccountID,
		Destinations: b.Destinations, Amount: b.Amount, Frequency: b.Frequency,
		AnnualRate: b.AnnualRate, AnnualGrowthRate: b.AnnualGrowthRate,
		Volatility: b.Volatility, StartDate: b.StartDate, EndDate: b.EndDate,
		AnnualCap: b.AnnualCap, Priority: b.Priority, Enabled: b.Enabled,
	}
	if b.ID != nil {
		out.ID = *b.ID
	}
	if id != "" {
		out.ID = id
	}
	return out
}

type ruleInput struct {
	Body ruleBody `json:"body"`
}

type ruleOutput struct {
	Body rowResultBody[types.RecurrenceRule] `json:"body"`
}

func ruleID(rule types.RecurrenceRule) string { return rule.ID }

func (s *Server) createRule(_ context.Context, input *ruleInput) (*ruleOutput, error) {
	rule := input.Body.toRule("")
	row, issues, persisted, err := applyRowChange(s, func(document *types.FinancialModelDocument) {
		document.RecurrenceRules = replaceByID(document.RecurrenceRules, rule.ID, ruleID, rule)
	}, func() (types.RecurrenceRule, error) {
		return s.store.CreateRule(rule)
	})
	if err != nil {
		return nil, err
	}
	revision, revErr := currentRevision(s)
	if revErr != nil {
		return nil, huma.Error500InternalServerError(revErr.Error())
	}
	return &ruleOutput{Body: rowResultBody[types.RecurrenceRule]{Row: row, Issues: issues, Persisted: persisted, Revision: revision}}, nil
}

func (s *Server) updateRule(_ context.Context, input *struct {
	ID   string   `path:"id"`
	Body ruleBody `json:"body"`
}) (*ruleOutput, error) {
	rule := input.Body.toRule(input.ID)
	row, issues, persisted, err := applyRowChange(s, func(document *types.FinancialModelDocument) {
		document.RecurrenceRules = replaceByID(document.RecurrenceRules, rule.ID, ruleID, rule)
	}, func() (types.RecurrenceRule, error) {
		return s.store.UpdateRule(rule)
	})
	if err != nil {
		return nil, err
	}
	revision, revErr := currentRevision(s)
	if revErr != nil {
		return nil, huma.Error500InternalServerError(revErr.Error())
	}
	return &ruleOutput{Body: rowResultBody[types.RecurrenceRule]{Row: row, Issues: issues, Persisted: persisted, Revision: revision}}, nil
}

func (s *Server) deleteRule(_ context.Context, input *struct {
	ID string `path:"id"`
}) (*reorderOutput, error) {
	id := input.ID
	_, _, _, err := applyRowChange(s, func(document *types.FinancialModelDocument) {
		document.RecurrenceRules = removeByID(document.RecurrenceRules, id, ruleID)
	}, func() (struct{}, error) {
		return struct{}{}, s.store.DeleteRule(id)
	})
	if err != nil {
		return nil, err
	}
	revision, revErr := currentRevision(s)
	if revErr != nil {
		return nil, huma.Error500InternalServerError(revErr.Error())
	}
	return &reorderOutput{Body: struct {
		Revision string `json:"revision"`
	}{Revision: revision}}, nil
}

func (s *Server) moveRule(_ context.Context, input *reorderInput) (*reorderOutput, error) {
	id, beforeID := input.Body.ID, input.Body.BeforeID
	_, _, _, err := applyRowChange(s, func(document *types.FinancialModelDocument) {
		document.RecurrenceRules = moveBeforeID(document.RecurrenceRules, id, beforeID, ruleID)
	}, func() (struct{}, error) {
		return struct{}{}, s.store.MoveRule(id, beforeID)
	})
	if err != nil {
		return nil, err
	}
	revision, revErr := currentRevision(s)
	if revErr != nil {
		return nil, huma.Error500InternalServerError(revErr.Error())
	}
	return &reorderOutput{Body: struct {
		Revision string `json:"revision"`
	}{Revision: revision}}, nil
}

type checkpointInput struct {
	Body types.Checkpoint `json:"body"`
}

type checkpointOutput struct {
	Body rowResultBody[types.Checkpoint] `json:"body"`
}

func checkpointKey(checkpoint types.Checkpoint) string {
	return checkpoint.AccountID + "\x00" + string(checkpoint.Date)
}

func (s *Server) saveCheckpoint(_ context.Context, input *checkpointInput) (*checkpointOutput, error) {
	checkpoint := input.Body
	row, issues, persisted, err := applyRowChange(s, func(document *types.FinancialModelDocument) {
		document.Checkpoints = replaceByID(document.Checkpoints, checkpointKey(checkpoint), checkpointKey, checkpoint)
	}, func() (types.Checkpoint, error) {
		return s.store.SaveCheckpoint(checkpoint)
	})
	if err != nil {
		return nil, err
	}
	revision, revErr := currentRevision(s)
	if revErr != nil {
		return nil, huma.Error500InternalServerError(revErr.Error())
	}
	return &checkpointOutput{Body: rowResultBody[types.Checkpoint]{Row: row, Issues: issues, Persisted: persisted, Revision: revision}}, nil
}

func (s *Server) deleteCheckpoint(_ context.Context, input *struct {
	AccountID string `query:"accountId"`
	Date      string `query:"date"`
}) (*reorderOutput, error) {
	accountID, date := input.AccountID, input.Date
	_, _, _, err := applyRowChange(s, func(document *types.FinancialModelDocument) {
		kept := document.Checkpoints[:0]
		for _, checkpoint := range document.Checkpoints {
			if checkpoint.AccountID != accountID || string(checkpoint.Date) != date {
				kept = append(kept, checkpoint)
			}
		}
		document.Checkpoints = kept
	}, func() (struct{}, error) {
		return struct{}{}, s.store.DeleteCheckpoint(accountID, date)
	})
	if err != nil {
		return nil, err
	}
	revision, revErr := currentRevision(s)
	if revErr != nil {
		return nil, huma.Error500InternalServerError(revErr.Error())
	}
	return &reorderOutput{Body: struct {
		Revision string `json:"revision"`
	}{Revision: revision}}, nil
}

type evaluationInput struct {
	Body store.EvaluationUpdate `json:"body"`
}

type evaluationOutput struct {
	Body rowResultBody[store.EvaluationUpdate] `json:"body"`
}

func evalSlice(document *types.FinancialModelDocument, evalType string) *[]types.EvaluationInstance[types.JsonValue] {
	switch types.EvaluationType(evalType) {
	case types.EvaluationTypeFinancialIndependence:
		return (*[]types.EvaluationInstance[types.JsonValue])(&document.Evaluations.FinancialIndependence)
	case types.EvaluationTypeNetWorthThreshold:
		return (*[]types.EvaluationInstance[types.JsonValue])(&document.Evaluations.NetWorthThreshold)
	case types.EvaluationTypeAccountBalance:
		return (*[]types.EvaluationInstance[types.JsonValue])(&document.Evaluations.AccountBalance)
	case types.EvaluationTypePostingFulfillment:
		return (*[]types.EvaluationInstance[types.JsonValue])(&document.Evaluations.PostingFulfillment)
	case types.EvaluationTypeCycleFulfillment:
		return (*[]types.EvaluationInstance[types.JsonValue])(&document.Evaluations.CycleFulfillment)
	default:
		return nil
	}
}

func evalToInstance(item store.EvaluationUpdate) types.EvaluationInstance[types.JsonValue] {
	return types.EvaluationInstance[types.JsonValue]{InstanceID: item.InstanceID, Name: item.Name, Enabled: item.Enabled, Config: types.JsonValue(item.Config)}
}

func instanceIDOf(instance types.EvaluationInstance[types.JsonValue]) string {
	return instance.InstanceID
}

func (s *Server) createEvaluation(_ context.Context, input *evaluationInput) (*evaluationOutput, error) {
	item := input.Body
	row, issues, persisted, err := applyRowChange(s, func(document *types.FinancialModelDocument) {
		if slice := evalSlice(document, item.Type); slice != nil {
			*slice = replaceByID(*slice, item.InstanceID, instanceIDOf, evalToInstance(item))
		}
	}, func() (store.EvaluationUpdate, error) {
		return s.store.CreateEvaluation(item)
	})
	if err != nil {
		return nil, err
	}
	revision, revErr := currentRevision(s)
	if revErr != nil {
		return nil, huma.Error500InternalServerError(revErr.Error())
	}
	return &evaluationOutput{Body: rowResultBody[store.EvaluationUpdate]{Row: row, Issues: issues, Persisted: persisted, Revision: revision}}, nil
}

func (s *Server) updateEvaluation(_ context.Context, input *struct {
	InstanceID string                 `path:"instanceId"`
	Body       store.EvaluationUpdate `json:"body"`
}) (*evaluationOutput, error) {
	item := input.Body
	item.InstanceID = input.InstanceID
	row, issues, persisted, err := applyRowChange(s, func(document *types.FinancialModelDocument) {
		if slice := evalSlice(document, item.Type); slice != nil {
			*slice = replaceByID(*slice, item.InstanceID, instanceIDOf, evalToInstance(item))
		}
	}, func() (store.EvaluationUpdate, error) {
		return s.store.UpdateEvaluation(item)
	})
	if err != nil {
		return nil, err
	}
	revision, revErr := currentRevision(s)
	if revErr != nil {
		return nil, huma.Error500InternalServerError(revErr.Error())
	}
	return &evaluationOutput{Body: rowResultBody[store.EvaluationUpdate]{Row: row, Issues: issues, Persisted: persisted, Revision: revision}}, nil
}

func (s *Server) deleteEvaluation(_ context.Context, input *struct {
	InstanceID string `path:"instanceId"`
}) (*reorderOutput, error) {
	instanceID := input.InstanceID
	_, _, _, err := applyRowChange(s, func(document *types.FinancialModelDocument) {
		for _, evalType := range types.EvaluationTypeOrder {
			if slice := evalSlice(document, evalType); slice != nil {
				*slice = removeByID(*slice, instanceID, instanceIDOf)
			}
		}
	}, func() (struct{}, error) {
		return struct{}{}, s.store.DeleteEvaluation(instanceID)
	})
	if err != nil {
		return nil, err
	}
	revision, revErr := currentRevision(s)
	if revErr != nil {
		return nil, huma.Error500InternalServerError(revErr.Error())
	}
	return &reorderOutput{Body: struct {
		Revision string `json:"revision"`
	}{Revision: revision}}, nil
}

func (s *Server) moveEvaluation(_ context.Context, input *struct {
	Body struct {
		Type       string `json:"type"`
		InstanceID string `json:"instanceId"`
		BeforeID   string `json:"beforeId,omitempty"`
	} `json:"body"`
}) (*reorderOutput, error) {
	evalType, instanceID, beforeID := input.Body.Type, input.Body.InstanceID, input.Body.BeforeID
	_, _, _, err := applyRowChange(s, func(document *types.FinancialModelDocument) {
		if slice := evalSlice(document, evalType); slice != nil {
			*slice = moveBeforeID(*slice, instanceID, beforeID, instanceIDOf)
		}
	}, func() (struct{}, error) {
		return struct{}{}, s.store.MoveEvaluation(evalType, instanceID, beforeID)
	})
	if err != nil {
		return nil, err
	}
	revision, revErr := currentRevision(s)
	if revErr != nil {
		return nil, huma.Error500InternalServerError(revErr.Error())
	}
	return &reorderOutput{Body: struct {
		Revision string `json:"revision"`
	}{Revision: revision}}, nil
}

type termsBody struct {
	AccountID      string   `json:"accountId"`
	MinimumFixed   float64  `json:"minimumFixed"`
	MinimumPercent *float64 `json:"minimumPercent,omitempty"`
	DueDay         int      `json:"dueDay"`
	StatementDay   *int     `json:"statementDay,omitempty"`
}

func (b termsBody) toTerms() types.PaymentTerms {
	return types.PaymentTerms{
		AccountID: b.AccountID, MinimumFixed: b.MinimumFixed,
		MinimumPercent: b.MinimumPercent, DueDay: b.DueDay, StatementDay: b.StatementDay,
	}
}

type paymentTermsInput struct {
	Body termsBody `json:"body"`
}

type paymentTermsOutput struct {
	Body rowResultBody[types.PaymentTerms] `json:"body"`
}

func (s *Server) savePaymentTerms(_ context.Context, input *paymentTermsInput) (*paymentTermsOutput, error) {
	terms := input.Body.toTerms()
	row, issues, persisted, err := applyRowChange(s, func(document *types.FinancialModelDocument) {
		replaced := false
		for i, existing := range document.PaymentTerms {
			if existing.AccountID == terms.AccountID {
				document.PaymentTerms[i] = terms
				replaced = true
			}
		}
		if !replaced {
			document.PaymentTerms = append(document.PaymentTerms, terms)
		}
	}, func() (types.PaymentTerms, error) {
		return s.store.SavePaymentTerms(terms)
	})
	if err != nil {
		return nil, err
	}
	revision, revErr := currentRevision(s)
	if revErr != nil {
		return nil, huma.Error500InternalServerError(revErr.Error())
	}
	return &paymentTermsOutput{Body: rowResultBody[types.PaymentTerms]{Row: row, Issues: issues, Persisted: persisted, Revision: revision}}, nil
}

func (s *Server) deletePaymentTerms(_ context.Context, input *struct {
	AccountID string `path:"accountId"`
}) (*reorderOutput, error) {
	accountID := input.AccountID
	_, _, _, err := applyRowChange(s, func(document *types.FinancialModelDocument) {
		kept := document.PaymentTerms[:0]
		for _, terms := range document.PaymentTerms {
			if terms.AccountID != accountID {
				kept = append(kept, terms)
			}
		}
		document.PaymentTerms = kept
	}, func() (struct{}, error) {
		return struct{}{}, s.store.DeletePaymentTerms(accountID)
	})
	if err != nil {
		return nil, err
	}
	revision, revErr := currentRevision(s)
	if revErr != nil {
		return nil, huma.Error500InternalServerError(revErr.Error())
	}
	return &reorderOutput{Body: struct {
		Revision string `json:"revision"`
	}{Revision: revision}}, nil
}

type linkListOutput struct {
	Body struct {
		Links []store.AccountLink `json:"links"`
	} `json:"body"`
}

func (s *Server) listAccountLinks(_ context.Context, _ *struct{}) (*linkListOutput, error) {
	links, err := s.store.ListAccountLinks()
	if err != nil {
		return nil, huma.Error500InternalServerError(err.Error())
	}
	if links == nil {
		links = []store.AccountLink{}
	}
	output := &linkListOutput{}
	output.Body.Links = links
	return output, nil
}

type linkPutInput struct {
	BridgeAccountID string `path:"bridgeAccountId"`
	Body            struct {
		ModelAccountID string `json:"modelAccountId"`
	} `json:"body"`
}

type linkOutput struct {
	Body struct {
		Link     store.AccountLink `json:"link"`
		Revision string            `json:"revision"`
	} `json:"body"`
}

func (s *Server) saveAccountLink(_ context.Context, input *linkPutInput) (*linkOutput, error) {
	link := store.AccountLink{
		BridgeAccountID: input.BridgeAccountID,
		ModelAccountID:  input.Body.ModelAccountID,
		Origin:          store.LinkOriginManual,
		LastSeenAt:      "",
	}
	existing, err := s.store.ListAccountLinks()
	if err != nil {
		return nil, huma.Error500InternalServerError(err.Error())
	}
	for _, stored := range existing {
		if stored.BridgeAccountID == link.BridgeAccountID {
			link.BridgeName = stored.BridgeName
			link.Currency = stored.Currency
			link.LastSeenAt = stored.LastSeenAt
		}
	}
	saved, err := s.store.SaveAccountLink(link)
	if err != nil {
		return nil, rowWriteError(err)
	}
	revision, revErr := currentRevision(s)
	if revErr != nil {
		return nil, huma.Error500InternalServerError(revErr.Error())
	}
	output := &linkOutput{}
	output.Body.Link = saved
	output.Body.Revision = revision
	return output, nil
}

func (s *Server) deleteAccountLink(_ context.Context, input *struct {
	BridgeAccountID string `path:"bridgeAccountId"`
}) (*reorderOutput, error) {
	if err := s.store.DeleteAccountLink(input.BridgeAccountID); err != nil {
		return nil, rowWriteError(err)
	}
	revision, revErr := currentRevision(s)
	if revErr != nil {
		return nil, huma.Error500InternalServerError(revErr.Error())
	}
	return &reorderOutput{Body: struct {
		Revision string `json:"revision"`
	}{Revision: revision}}, nil
}
