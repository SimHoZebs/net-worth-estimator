package api

import (
	"context"
	"time"

	"github.com/danielgtaylor/huma/v2"
	"github.com/simhozebs/net-worth-estimator/backend/internal/store"
	"github.com/simhozebs/net-worth-estimator/backend/internal/types"
)

// Purpose-built reads for row-first clients. Each endpoint answers one
// question a screen actually asks instead of dumping a table. Every
// response carries the document revision (one global content identity), so
// callers that combine queries can compare revisions and refetch on skew
// instead of rendering a torn view.

// isSyncOwned mirrors the frontend rule: row authorship is "user"
// (owner-authored, including the legacy "model" value renamed on setup) or
// a sync-owned name set by the server. Any other non-empty author is
// system-owned sync output, matched by exclusion rather than by name.
func isSyncOwned(source string) bool {
	return source != "" && source != "user" && source != "model"
}

// isArchivedDebt hides a paid-off debt: a debt account whose latest
// observation at or before the viewed date is effectively zero.
func isArchivedDebt(account types.Account, latest *types.Checkpoint) bool {
	if account.Kind != "debt" || latest == nil {
		return false
	}
	return latest.Balance > -0.005 && latest.Balance < 0.005
}

type accountBalanceRow struct {
	ID            string            `json:"id"`
	Name          string            `json:"name"`
	Kind          types.AccountKind `json:"kind"`
	Enabled       bool              `json:"enabled"`
	Archived      bool              `json:"archived"`
	Color         *string           `json:"color,omitempty"`
	MinBalance    *float64          `json:"minBalance"`
	MaxBalance    *float64          `json:"maxBalance"`
	Balance       float64           `json:"balance"`
	ObservedOn    types.IsoDate     `json:"observedOn"`
	HasCheckpoint bool              `json:"hasCheckpoint"`
	SyncOwned     bool              `json:"syncOwned"`
	ReadOnly      bool              `json:"readOnly"`
}

type accountBalancesOutput struct {
	Body struct {
		Accounts []accountBalanceRow `json:"accounts"`
		AsOf     types.IsoDate       `json:"asOf"`
		Revision string              `json:"revision"`
	} `json:"body"`
}

// listAccountBalances answers "what does each account hold as of this date".
// It folds the latest checkpoint per account server-side; screens that
// showed balances from the converted plan read this instead.
func (s *Server) listAccountBalances(_ context.Context, input *struct {
	AsOf string `query:"asOf" doc:"Balance date YYYY-MM-DD; defaults to the latest checkpoint date or today"`
}) (*accountBalancesOutput, error) {
	document, err := s.store.LoadDocument()
	if err != nil {
		return nil, huma.Error500InternalServerError(err.Error())
	}
	revision, err := store.DocumentETag(document)
	if err != nil {
		return nil, huma.Error500InternalServerError(err.Error())
	}
	asOf := types.IsoDate(input.AsOf)
	if document != nil && asOf == "" {
		for _, checkpoint := range document.Checkpoints {
			if checkpoint.Date > asOf {
				asOf = checkpoint.Date
			}
		}
	}
	if asOf == "" {
		asOf = types.IsoDate(time.Now().UTC().Format("2006-01-02"))
	}
	rows := []accountBalanceRow{}
	if document != nil {
		for _, account := range document.Accounts {
			var latest *types.Checkpoint
			for i := range document.Checkpoints {
				checkpoint := &document.Checkpoints[i]
				if checkpoint.AccountID != account.ID || checkpoint.Date > asOf {
					continue
				}
				if latest == nil || checkpoint.Date > latest.Date {
					latest = checkpoint
				}
			}
			syncOwned := false
			if document != nil {
				for _, checkpoint := range document.Checkpoints {
					if checkpoint.AccountID == account.ID && isSyncOwned(checkpoint.Source) {
						syncOwned = true
						break
					}
				}
			}
			row := accountBalanceRow{
				ID:         account.ID,
				Name:       account.Name,
				Kind:       account.Kind,
				Enabled:    account.Enabled,
				Archived:   isArchivedDebt(account, latest),
				Color:      account.Color,
				MinBalance: account.MinBalance,
				MaxBalance: account.MaxBalance,
				SyncOwned:  syncOwned,
				ReadOnly:   s.ReadOnly || syncOwned,
			}
			if latest != nil {
				row.Balance = latest.Balance
				row.ObservedOn = latest.Date
				row.HasCheckpoint = true
			} else {
				row.ObservedOn = asOf
			}
			rows = append(rows, row)
		}
	}
	output := &accountBalancesOutput{}
	output.Body.Accounts = rows
	output.Body.AsOf = asOf
	output.Body.Revision = revision
	return output, nil
}

type transactionRow struct {
	ID              string                        `json:"id"`
	Kind            string                        `json:"kind"`
	Name            string                        `json:"name"`
	SourceAccountID *string                       `json:"sourceAccountId"`
	Destinations    []string                      `json:"destinations"`
	Amount          types.PostingAmountResolution `json:"amount"`
	Frequency       string                        `json:"frequency"`
	StartDate       types.IsoDate                 `json:"startDate"`
	EndDate         *types.IsoDate                `json:"endDate"`
	Priority        *int                          `json:"priority,omitempty"`
	Enabled         bool                          `json:"enabled"`
	SyncOwned       bool                          `json:"syncOwned"`
	ReadOnly        bool                          `json:"readOnly"`
	Claim           *types.PostingClaim           `json:"claim,omitempty"`
	Pending         bool                          `json:"pending,omitempty"`
	Void            bool                          `json:"void,omitempty"`
	PostedTime      int64                         `json:"postedTime,omitempty"`
	TransactionTime int64                         `json:"transactionTime,omitempty"`
}

// transactionDay renders a unix stamp as a UTC calendar day for display rows.
// A missing stamp falls back to the epoch, mirroring the legacy conversion,
// so rows always carry a renderable date.
func transactionDay(stamp int64) types.IsoDate {
	if stamp <= 0 {
		stamp = 0
	}
	return types.IsoDate(time.Unix(stamp, 0).UTC().Format("2006-01-02"))
}

type transactionListOutput struct {
	Body struct {
		Transactions []transactionRow `json:"transactions"`
		Revision     string           `json:"revision"`
	} `json:"body"`
}

// listTransactions answers "which transactions touch this account" (or all
// of them). Postings and rules arrive as the single combined list the
// activity screens render; amount display resolution still comes from
// projection transaction events, which already travel with projection results.
func (s *Server) listTransactions(_ context.Context, input *struct {
	AccountID string `query:"accountId" doc:"Only transactions touching this account"`
	Recurring string `query:"recurring" doc:"once, recurring, or all" default:"all"`
}) (*transactionListOutput, error) {
	document, err := s.store.LoadDocument()
	if err != nil {
		return nil, huma.Error500InternalServerError(err.Error())
	}
	revision, err := store.DocumentETag(document)
	if err != nil {
		return nil, huma.Error500InternalServerError(err.Error())
	}
	transactions := []transactionRow{}
	if document != nil {
		touches := func(source *string, destinations []string) bool {
			if input.AccountID == "" {
				return true
			}
			if source != nil && *source == input.AccountID {
				return true
			}
			for _, destination := range destinations {
				if destination == input.AccountID {
					return true
				}
			}
			return false
		}
		if input.Recurring == "" || input.Recurring == "all" || input.Recurring == "recurring" {
			for _, rule := range document.RecurrenceRules {
				if !touches(rule.SourceAccountID, rule.Destinations) {
					continue
				}
				priority := rule.Priority
				transactions = append(transactions, transactionRow{
					ID:              rule.ID,
					Kind:            "rule",
					Name:            rule.Name,
					SourceAccountID: rule.SourceAccountID,
					Destinations:    rule.Destinations,
					Amount:          rule.Amount,
					Frequency:       string(rule.Frequency),
					StartDate:       rule.StartDate,
					EndDate:         rule.EndDate,
					Priority:        &priority,
					Enabled:         rule.Enabled,
				})
			}
		}
		if input.Recurring == "" || input.Recurring == "all" || input.Recurring == "once" {
			for _, posting := range document.Postings {
				if !touches(posting.SourceAccountID, posting.Destinations) {
					continue
				}
				syncOwned := isSyncOwned(posting.Source)
				startDate := transactionDay(posting.TransactionTime)
				if startDate == "" {
					startDate = transactionDay(posting.PostedTime)
				}
				transactions = append(transactions, transactionRow{
					ID:              posting.ID,
					Kind:            "posting",
					Name:            posting.Name,
					SourceAccountID: posting.SourceAccountID,
					Destinations:    posting.Destinations,
					Amount:          posting.Amount,
					Frequency:       "once",
					StartDate:       startDate,
					Enabled:         posting.Enabled,
					SyncOwned:       syncOwned,
					ReadOnly:        syncOwned,
					Claim:           posting.Claim,
					Pending:         posting.Pending,
					Void:            posting.Void,
					PostedTime:      posting.PostedTime,
					TransactionTime: posting.TransactionTime,
				})
			}
		}
	}
	output := &transactionListOutput{}
	output.Body.Transactions = transactions
	output.Body.Revision = revision
	return output, nil
}

type transactionCatalogOutput struct {
	Body struct {
		Items []struct {
			ID   string `json:"id"`
			Kind string `json:"kind"`
			Name string `json:"name"`
		} `json:"items"`
		Revision string `json:"revision"`
	} `json:"body"`
}

// listTransactionCatalog answers "which transactions can this picker reference".
// Amount editors, funding-source pickers, and evaluation forms need id and
// name only; the full descriptors stay with the transactions query.
func (s *Server) listTransactionCatalog(_ context.Context, _ *struct{}) (*transactionCatalogOutput, error) {
	document, err := s.store.LoadDocument()
	if err != nil {
		return nil, huma.Error500InternalServerError(err.Error())
	}
	revision, err := store.DocumentETag(document)
	if err != nil {
		return nil, huma.Error500InternalServerError(err.Error())
	}
	output := &transactionCatalogOutput{}
	output.Body.Items = []struct {
		ID   string `json:"id"`
		Kind string `json:"kind"`
		Name string `json:"name"`
	}{}
	if document != nil {
		for _, rule := range document.RecurrenceRules {
			output.Body.Items = append(output.Body.Items, struct {
				ID   string `json:"id"`
				Kind string `json:"kind"`
				Name string `json:"name"`
			}{ID: rule.ID, Kind: "rule", Name: rule.Name})
		}
		for _, posting := range document.Postings {
			output.Body.Items = append(output.Body.Items, struct {
				ID   string `json:"id"`
				Kind string `json:"kind"`
				Name string `json:"name"`
			}{ID: posting.ID, Kind: "posting", Name: posting.Name})
		}
	}
	output.Body.Revision = revision
	return output, nil
}

type evaluationSummaryOutput struct {
	Body struct {
		Evaluations types.EvaluationTables `json:"evaluations"`
		Revision    string                 `json:"revision"`
	} `json:"body"`
}

// listEvaluationSummary answers "which evaluations exist and what are they
// called". Pins, grids, and the independence configure screen read instance
// identity and configs here. The tables hold a handful of rows, so the full
// configs travel with the summary instead of a second fetch per row.
func (s *Server) listEvaluationSummary(_ context.Context, _ *struct{}) (*evaluationSummaryOutput, error) {
	document, err := s.store.LoadDocument()
	if err != nil {
		return nil, huma.Error500InternalServerError(err.Error())
	}
	revision, err := store.DocumentETag(document)
	if err != nil {
		return nil, huma.Error500InternalServerError(err.Error())
	}
	evaluations := types.EmptyEvaluationTables()
	if document != nil {
		evaluations = document.Evaluations
	}
	output := &evaluationSummaryOutput{}
	output.Body.Evaluations = evaluations
	output.Body.Revision = revision
	return output, nil
}

type checkpointListOutput struct {
	Body struct {
		Checkpoints []types.Checkpoint `json:"checkpoints"`
		Revision    string             `json:"revision"`
	} `json:"body"`
}

// listCheckpoints answers "what observations exist for this account and
// window". The outlook cash-flow ledger pages through these instead of the
// whole checkpoint table.
func (s *Server) listCheckpoints(_ context.Context, input *struct {
	AccountID string `query:"accountId" doc:"Only checkpoints for this account"`
	Since     string `query:"since" doc:"First date YYYY-MM-DD inclusive"`
	Until     string `query:"until" doc:"Last date YYYY-MM-DD inclusive"`
}) (*checkpointListOutput, error) {
	document, err := s.store.LoadDocument()
	if err != nil {
		return nil, huma.Error500InternalServerError(err.Error())
	}
	revision, err := store.DocumentETag(document)
	if err != nil {
		return nil, huma.Error500InternalServerError(err.Error())
	}
	checkpoints := []types.Checkpoint{}
	if document != nil {
		for _, checkpoint := range document.Checkpoints {
			if input.AccountID != "" && checkpoint.AccountID != input.AccountID {
				continue
			}
			if input.Since != "" && checkpoint.Date < types.IsoDate(input.Since) {
				continue
			}
			if input.Until != "" && checkpoint.Date > types.IsoDate(input.Until) {
				continue
			}
			checkpoints = append(checkpoints, checkpoint)
		}
	}
	output := &checkpointListOutput{}
	output.Body.Checkpoints = checkpoints
	output.Body.Revision = revision
	return output, nil
}
