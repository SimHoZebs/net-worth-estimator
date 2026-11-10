package model

import (
	"context"
	"errors"
	"strings"
	"time"

	"github.com/danielgtaylor/huma/v2"
	"github.com/simhozebs/net-worth-estimator/backend/internal/domain"
	"github.com/simhozebs/net-worth-estimator/backend/internal/store"
	"github.com/simhozebs/net-worth-estimator/backend/internal/types"
)

// Purpose-built reads for row-first clients. Each endpoint answers one
// question a screen actually asks instead of dumping a table. Every
// response carries the model revision (one global content identity), so
// callers that combine queries can compare revisions and refetch on skew
// instead of rendering a torn view.

// isSyncOwned mirrors the frontend rule: row authorship is "user"
// (owner-authored) or
// a sync-owned name set by the server. Any other non-empty author is
// system-owned sync output, matched by exclusion rather than by name.
func isSyncOwned(source string) bool {
	return source != "" && source != "user"
}

// isArchivedDebt hides a paid-off configured liability: an account with
// payment terms whose latest observed balance at or before the viewed
// date is effectively zero. The observed balance comes from the replay's
// selected observation, so same-day instant ordering agrees with the
// current position. Terms, not account kind, select the set.
func isArchivedDebt(terms map[string]types.PaymentTerms, account types.Account, observedBalance *float64) bool {
	if _, ok := terms[account.ID]; !ok || observedBalance == nil {
		return false
	}
	return *observedBalance > -0.005 && *observedBalance < 0.005
}

type accountBalanceRow struct {
	ComponentBalance *float64              `json:"componentBalance,omitempty" doc:"Unrounded modeled balance for a component of one visible account"`
	Display          *types.AccountDisplay `json:"display,omitempty"`
	ID               string                `json:"id"`
	Name             string                `json:"name"`
	Kind             types.AccountKind     `json:"kind"`
	Enabled          bool                  `json:"enabled"`
	Archived         bool                  `json:"archived"`
	Color            *string               `json:"color,omitempty"`
	MinBalance       *float64              `json:"minBalance"`
	MaxBalance       *float64              `json:"maxBalance"`
	Balance          float64               `json:"balance"`
	ObservedOn       types.IsoDate         `json:"observedOn"`
	HasCheckpoint    bool                  `json:"hasCheckpoint"`
	SyncOwned        bool                  `json:"syncOwned"`
	ReadOnly         bool                  `json:"readOnly"`
	// Institution is the bank organization name for the linked bridge
	// account, empty for manual accounts or when the bridge reported
	// none. It identifies where a synced account came from.
	Institution *string `json:"institution,omitempty"`
	// SyncedName is the bridge account name snapshot from the sync
	// link; it can differ from the owner's account name after a rename.
	SyncedName *string `json:"syncedName,omitempty"`
	// Currency is the bridge account currency from the sync link.
	Currency *string `json:"currency,omitempty"`
	// ObservedBalance is the latest observation at or before AsOf,
	// separate from the adjusted modeled Balance. Nil when unobserved.
	ObservedBalance *float64 `json:"observedBalance,omitempty"`
	// ObservedAt is the required observation instant (Unix).
	ObservedAt *int64 `json:"observedAt,omitempty"`
	// AvailableBalance is the latest observation's bank-reported available
	// cash or credit. Nil when the bank reported none.
	AvailableBalance *float64 `json:"availableBalance,omitempty"`
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
	model, err := s.store.LoadModel()
	if err != nil {
		return nil, huma.Error500InternalServerError(err.Error())
	}
	revision, err := store.ModelETag(model)
	if err != nil {
		return nil, huma.Error500InternalServerError(err.Error())
	}
	asOf := types.IsoDate(input.AsOf)
	rawCut := string(asOf)
	if model != nil && rawCut == "" {
		var latest int64
		for _, checkpoint := range model.Checkpoints {
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
	position, err := domain.ResolveCurrentPosition(model, rawCut, types.ModelOverrides{})
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
	// Bridge identity travels on the sync link, keyed by model account.
	// One model account links to at most one bridge account.
	links, linksErr := s.store.ListAccountLinks()
	if linksErr != nil {
		return nil, huma.Error500InternalServerError(linksErr.Error())
	}
	byModelAccount := make(map[string]store.AccountLink, len(links))
	for _, link := range links {
		byModelAccount[link.ModelAccountID] = link
	}
	rows := []accountBalanceRow{}
	if model != nil {
		terms := domain.PaymentTermsByAccount(model)
		components := map[string]bool{}
		for _, a := range model.Accounts {
			if a.Display != nil {
				for _, c := range a.Display.Components {
					components[c.AccountID] = true
				}
			}
		}
		for _, account := range model.Accounts {
			adjusted := byAccount[account.ID]
			observedOn := cutDay
			hasCheckpoint := adjusted.ObservedBalance != nil
			if hasCheckpoint {
				observedOn = latestObservationDay(adjusted, cutDay)
			}
			syncOwned := false
			if model != nil {
				for _, checkpoint := range model.Checkpoints {
					if checkpoint.AccountID == account.ID && isSyncOwned(checkpoint.Source) {
						syncOwned = true
						break
					}
				}
			}
			var institution, syncedName, currency *string
			if link, ok := byModelAccount[account.ID]; ok {
				if strings.TrimSpace(link.Institution) != "" {
					institution = &link.Institution
				}
				if strings.TrimSpace(link.BridgeName) != "" {
					syncedName = &link.BridgeName
				}
				if strings.TrimSpace(link.Currency) != "" {
					currency = &link.Currency
				}
			}
			row := accountBalanceRow{
				Display:          account.Display,
				ID:               account.ID,
				Name:             account.Name,
				Kind:             account.Kind,
				Enabled:          account.Enabled,
				Archived:         isArchivedDebt(terms, account, adjusted.ObservedBalance),
				Color:            account.Color,
				MinBalance:       account.MinBalance,
				MaxBalance:       account.MaxBalance,
				Balance:          adjusted.Balance,
				ObservedOn:       observedOn,
				HasCheckpoint:    hasCheckpoint,
				SyncOwned:        syncOwned,
				ReadOnly:         s.readOnly || syncOwned,
				Institution:      institution,
				SyncedName:       syncedName,
				Currency:         currency,
				ObservedBalance:  adjusted.ObservedBalance,
				ObservedAt:       adjusted.ObservedAt,
				AvailableBalance: adjusted.AvailableBalance,
			}
			if components[account.ID] {
				value := adjusted.UnroundedBalance
				row.ComponentBalance = &value
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
	ID              string                            `json:"id"`
	Name            string                            `json:"name"`
	SourceAccountID *string                           `json:"sourceAccountId"`
	Destinations    []string                          `json:"destinations"`
	Amount          types.TransactionAmountResolution `json:"amount"`
	StartDate       types.IsoDate                     `json:"startDate"`
	EndDate         *types.IsoDate                    `json:"endDate"`
	Priority        *int                              `json:"priority,omitempty"`
	Enabled         bool                              `json:"enabled"`
	SyncOwned       bool                              `json:"syncOwned"`
	ReadOnly        bool                              `json:"readOnly"`
	Claim           *types.TransactionClaim           `json:"claim,omitempty"`
	Pending         bool                              `json:"pending,omitempty"`
	Void            bool                              `json:"void,omitempty"`
	PostedTime      int64                             `json:"postedTime,omitempty"`
	TransactionTime int64                             `json:"transactionTime,omitempty"`
	Category        string                            `json:"category,omitempty"`
	CategorySource  string                            `json:"categorySource,omitempty"`
	// ReceiptIDs is the reverse lookup this row displays, read once for the
	// whole list instead of loading the model document.
	ReceiptIDs []string `json:"receiptIds,omitempty"`
}

// transactionDay renders a unix stamp as a UTC calendar day for display rows.
func transactionDay(stamp int64) types.IsoDate {
	return types.IsoDate(time.Unix(stamp, 0).UTC().Format("2006-01-02"))
}

type transactionListOutput struct {
	Body struct {
		Transactions []transactionRow `json:"transactions"`
		Revision     string           `json:"revision"`
	} `json:"body"`
}

// listTransactions answers "which transactions touch this account" (or all of
// them). Schedules are not transactions: they answer a different
// question and travel through listSchedules. Amount display resolution
// still comes from projection transaction events, which already travel with
// projection results.
func (s *handler) listTransactions(_ context.Context, input *struct {
	AccountID string `query:"accountId" doc:"Only transactions touching this account"`
}) (*transactionListOutput, error) {
	model, err := s.store.LoadModel()
	if err != nil {
		return nil, huma.Error500InternalServerError(err.Error())
	}
	revision, err := store.ModelETag(model)
	if err != nil {
		return nil, huma.Error500InternalServerError(err.Error())
	}
	transactions := []transactionRow{}
	if model != nil {
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
		transactionIDs := make([]string, 0, len(model.Transactions))
		for _, transaction := range model.Transactions {
			if !touches(transaction.SourceAccountID, transaction.Destinations) {
				continue
			}
			transactionIDs = append(transactionIDs, transaction.ID)
			syncOwned := isSyncOwned(transaction.Source)
			startDate := transactionDay(transaction.TransactionTime)
			if startDate == "" {
				startDate = transactionDay(transaction.PostedTime)
			}
			transactions = append(transactions, transactionRow{
				ID:              transaction.ID,
				Name:            transaction.Name,
				SourceAccountID: transaction.SourceAccountID,
				Destinations:    transaction.Destinations,
				Amount:          transaction.Amount,
				StartDate:       startDate,
				Enabled:         transaction.Enabled,
				SyncOwned:       syncOwned,
				// Bank rows are owner-editable including pending and void,
				// so the owner can edit, un-pend, or un-void them.
				ReadOnly:        false,
				Claim:           transaction.Claim,
				Pending:         transaction.Pending,
				Void:            transaction.Void,
				PostedTime:      transaction.PostedTime,
				TransactionTime: transaction.TransactionTime,
			})
		}
		categories, err := s.store.LoadTransactionCategories(transactionIDs)
		if err != nil {
			return nil, huma.Error500InternalServerError(err.Error())
		}
		for index := range transactions {
			if item, ok := categories[transactions[index].ID]; ok {
				transactions[index].Category = item.Category
				transactions[index].CategorySource = item.Source
			}
		}
		if s.receipts != nil {
			links, err := s.receipts.ListLinks()
			if err != nil {
				return nil, huma.Error500InternalServerError(err.Error())
			}
			for index := range transactions {
				transactions[index].ReceiptIDs = links[transactions[index].ID]
			}
		}
	}
	output := &transactionListOutput{}
	output.Body.Transactions = transactions
	output.Body.Revision = revision
	return output, nil
}

type scheduleListOutput struct {
	Body struct {
		Schedules []types.Schedule `json:"schedules"`
		Revision  string           `json:"revision"`
	} `json:"body"`
}

// listSchedules answers "which standing schedules touch this account"
// (or all of them). A schedule owns repetition; it is not a transaction and never
// appears in the transactions list. Rows keep the model's storage order, which is
// the owner's execution priority order.
func (s *handler) listSchedules(_ context.Context, input *struct {
	AccountID string `query:"accountId" doc:"Only schedules touching this account"`
}) (*scheduleListOutput, error) {
	model, err := s.store.LoadModel()
	if err != nil {
		return nil, huma.Error500InternalServerError(err.Error())
	}
	revision, err := store.ModelETag(model)
	if err != nil {
		return nil, huma.Error500InternalServerError(err.Error())
	}
	schedules := []types.Schedule{}
	if model != nil {
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
		for _, schedule := range model.Schedules {
			if !touches(schedule.SourceAccountID, schedule.Destinations) {
				continue
			}
			schedules = append(schedules, schedule)
		}
	}
	output := &scheduleListOutput{}
	output.Body.Schedules = schedules
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
	model, err := s.store.LoadModel()
	if err != nil {
		return nil, huma.Error500InternalServerError(err.Error())
	}
	revision, err := store.ModelETag(model)
	if err != nil {
		return nil, huma.Error500InternalServerError(err.Error())
	}
	output := &transactionCatalogOutput{}
	output.Body.Items = []struct {
		ID   string `json:"id"`
		Kind string `json:"kind"`
		Name string `json:"name"`
	}{}
	if model != nil {
		for _, schedule := range model.Schedules {
			output.Body.Items = append(output.Body.Items, struct {
				ID   string `json:"id"`
				Kind string `json:"kind"`
				Name string `json:"name"`
			}{ID: schedule.ID, Kind: "schedule", Name: schedule.Name})
		}
		for _, transaction := range model.Transactions {
			output.Body.Items = append(output.Body.Items, struct {
				ID   string `json:"id"`
				Kind string `json:"kind"`
				Name string `json:"name"`
			}{ID: transaction.ID, Kind: "transaction", Name: transaction.Name})
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
	model, err := s.store.LoadModel()
	if err != nil {
		return nil, huma.Error500InternalServerError(err.Error())
	}
	revision, err := store.ModelETag(model)
	if err != nil {
		return nil, huma.Error500InternalServerError(err.Error())
	}
	evaluations := types.EmptyEvaluationTables()
	if model != nil {
		evaluations = model.Evaluations
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
	model, err := s.store.LoadModel()
	if err != nil {
		return nil, huma.Error500InternalServerError(err.Error())
	}
	revision, err := store.ModelETag(model)
	if err != nil {
		return nil, huma.Error500InternalServerError(err.Error())
	}
	checkpoints := []types.Checkpoint{}
	if model != nil {
		for _, checkpoint := range model.Checkpoints {
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
