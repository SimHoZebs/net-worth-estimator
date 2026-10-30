package model

import (
	"context"
	"errors"
	"time"

	"github.com/danielgtaylor/huma/v2"
	"github.com/simhozebs/net-worth-estimator/backend/internal/domain"
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
// observed balance at or before the viewed date is effectively zero.
// The observed balance comes from the replay's selected observation, so
// same-day instant ordering agrees with the current position.
func isArchivedDebt(account types.Account, observedBalance *float64) bool {
	if account.Kind != "debt" || observedBalance == nil {
		return false
	}
	return *observedBalance > -0.005 && *observedBalance < 0.005
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
	// ObservedBalance is the latest observation at or before AsOf,
	// separate from the adjusted modeled Balance. Nil when unobserved.
	ObservedBalance *float64 `json:"observedBalance,omitempty"`
	// ObservedAt is the required observation instant (Unix).
	ObservedAt *int64 `json:"observedAt,omitempty"`
}

type accountBalancesOutput struct {
	Body struct {
		Accounts []accountBalanceRow `json:"accounts"`
		AsOf     types.IsoDate       `json:"asOf"`
		Revision string              `json:"revision"`
	} `json:"body"`
}

// listAccountBalances answers "what does each account hold as of this date".
// Balances come from the same chronological replay as the current position
// and projection baseline (one calculation authority): Balance is the
// adjusted modeled balance at the end of AsOf, with the latest observation
// and reconciliation state carried separately. It never folds the latest
// checkpoint as the balance.
func (s *handler) listAccountBalances(_ context.Context, input *struct {
	AsOf string `query:"asOf" doc:"Cut YYYY-MM-DD (end of day, inclusive) or RFC 3339 instant; defaults to the latest checkpoint date or today"`
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
	rawCut := string(asOf)
	if document != nil && rawCut == "" {
		var latest int64
		for _, checkpoint := range document.Checkpoints {
			if checkpoint.ObservedAt > latest {
				latest = checkpoint.ObservedAt
			}
		}
		if latest > 0 {
			asOf = types.IsoDate(time.Unix(latest, 0).UTC().Format("2006-01-02"))
			rawCut = string(asOf)
		}
	}
	if rawCut == "" {
		rawCut = time.Now().UTC().Format("2006-01-02")
	}
	// Normalize calendar fields to the parsed cut day: an RFC 3339 cut
	// must not echo as a date-only value. The exact instant stays in the
	// timestamp fields (ObservedAt) where needed. A malformed cut is
	// client input, not a server failure.
	_, cutDayStr, err := domain.ParseAsOfCut(rawCut)
	if err != nil {
		return nil, huma.Error422UnprocessableEntity(err.Error())
	}
	cutDay := types.IsoDate(cutDayStr)
	position, err := domain.ResolveCurrentPosition(document, rawCut, types.ModelOverrides{})
	if err != nil {
		var preparationError *domain.SimulationPreparationError
		if errors.As(err, &preparationError) {
			return nil, huma.Error422UnprocessableEntity(preparationError.Error())
		}
		return nil, huma.Error500InternalServerError(err.Error())
	}
	byAccount := make(map[string]types.PositionAccount, len(position.Accounts))
	for _, account := range position.Accounts {
		byAccount[account.AccountID] = account
	}
	rows := []accountBalanceRow{}
	if document != nil {
		for _, account := range document.Accounts {
			adjusted := byAccount[account.ID]
			observedOn := cutDay
			hasCheckpoint := adjusted.ObservedBalance != nil
			if hasCheckpoint {
				observedOn = latestObservationDay(adjusted, cutDay)
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
				ID:              account.ID,
				Name:            account.Name,
				Kind:            account.Kind,
				Enabled:         account.Enabled,
				Archived:        isArchivedDebt(account, adjusted.ObservedBalance),
				Color:           account.Color,
				MinBalance:      account.MinBalance,
				MaxBalance:      account.MaxBalance,
				Balance:         adjusted.Balance,
				ObservedOn:      observedOn,
				HasCheckpoint:   hasCheckpoint,
				SyncOwned:       syncOwned,
				ReadOnly:        s.readOnly || syncOwned,
				ObservedBalance: adjusted.ObservedBalance,
				ObservedAt:      adjusted.ObservedAt,
			}
			rows = append(rows, row)
		}
	}
	output := &accountBalancesOutput{}
	output.Body.Accounts = rows
	output.Body.AsOf = cutDay
	output.Body.Revision = revision
	return output, nil
}

// latestObservationDay returns the UTC day of the latest observation at
// or before asOf, derived from the replay's selected observation so the
// account list agrees with the current position at the same cut.
func latestObservationDay(adjusted types.PositionAccount, asOf types.IsoDate) types.IsoDate {
	if adjusted.ObservedAt == nil {
		return asOf
	}
	return types.IsoDate(time.Unix(*adjusted.ObservedAt, 0).UTC().Format("2006-01-02"))
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
func (s *handler) listTransactions(_ context.Context, input *struct {
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
func (s *handler) listTransactionCatalog(_ context.Context, _ *struct{}) (*transactionCatalogOutput, error) {
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
func (s *handler) listEvaluationSummary(_ context.Context, _ *struct{}) (*evaluationSummaryOutput, error) {
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
func (s *handler) listCheckpoints(_ context.Context, input *struct {
	AccountID string `query:"accountId" doc:"Only checkpoints for this account"`
	Since     string `query:"since" doc:"First date YYYY-MM-DD inclusive (derived from instant)"`
	Until     string `query:"until" doc:"Last date YYYY-MM-DD inclusive (derived from instant)"`
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
			day := types.IsoDate(time.Unix(checkpoint.ObservedAt, 0).UTC().Format("2006-01-02"))
			if input.Since != "" && day < types.IsoDate(input.Since) {
				continue
			}
			if input.Until != "" && day > types.IsoDate(input.Until) {
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
