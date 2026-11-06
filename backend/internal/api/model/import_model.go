package model

import (
	"context"
	"encoding/json"
	"fmt"

	"github.com/danielgtaylor/huma/v2"
	"github.com/simhozebs/net-worth-estimator/backend/internal/api/internal/modelstate"
	"github.com/simhozebs/net-worth-estimator/backend/internal/domain"
	"github.com/simhozebs/net-worth-estimator/backend/internal/store"
	"github.com/simhozebs/net-worth-estimator/backend/internal/types"
)

// importModel replaces the reviewed model. The server owns the diff:
// authored fields come from the document, server-owned lifecycle fields stay
// as stored, and row order follows the document. Every row is validated
// against the resulting candidate before any write starts. Writes are per
// row, so a store failure after the first write leaves the applied prefix;
// callers must reload authoritative state after an error.
type importModelBody struct {
	Model types.FinancialModel `json:"model"`
}

type importModelOutput struct {
	Body struct {
		Issues   []types.ModelValidationIssue `json:"issues"`
		Saved    bool                         `json:"saved"`
		Revision string                       `json:"revision"`
	} `json:"body"`
}

func (s *handler) importModel(_ context.Context, input *struct {
	Body importModelBody `json:"body"`
}) (*importModelOutput, error) {
	current, err := s.store.LoadModel()
	if err != nil {
		return nil, huma.Error500InternalServerError(err.Error())
	}
	candidate := input.Body.Model
	mergeStoredLifecycle(&candidate, current)
	issues := domain.ValidateFinancialModel(&candidate)
	for _, issue := range issues {
		if issue.Severity == types.SeverityError {
			output := &importModelOutput{}
			output.Body.Issues = issues
			output.Body.Saved = false
			output.Body.Revision, _ = modelstate.CurrentRevision(s.store)
			return output, nil
		}
	}
	if current != nil {
		if err := applyImportedModel(s.store, current, &candidate); err != nil {
			return nil, huma.Error422UnprocessableEntity(err.Error())
		}
	} else {
		if err := createImportedModel(s.store, &candidate); err != nil {
			return nil, huma.Error422UnprocessableEntity(err.Error())
		}
	}
	revision, revErr := modelstate.CurrentRevision(s.store)
	if revErr != nil {
		return nil, huma.Error500InternalServerError(revErr.Error())
	}
	output := &importModelOutput{}
	output.Body.Issues = issues
	output.Body.Saved = true
	output.Body.Revision = revision
	return output, nil
}

// mergeStoredLifecycle keeps server-owned fields for rows that already exist.
func mergeStoredLifecycle(candidate *types.FinancialModel, current *types.FinancialModel) {
	if current == nil {
		return
	}
	transactions := map[string]types.Transaction{}
	for _, transaction := range current.Transactions {
		transactions[transaction.ID] = transaction
	}
	for index := range candidate.Transactions {
		stored, ok := transactions[candidate.Transactions[index].ID]
		if !ok {
			continue
		}
		candidate.Transactions[index].Source = stored.Source
		candidate.Transactions[index].Pending = stored.Pending
		candidate.Transactions[index].Void = stored.Void
		candidate.Transactions[index].ExecutionOrder = stored.ExecutionOrder
	}
	checkpoints := map[string]types.Checkpoint{}
	for _, checkpoint := range current.Checkpoints {
		checkpoints[importCheckpointKey(checkpoint)] = checkpoint
	}
	for index := range candidate.Checkpoints {
		if stored, ok := checkpoints[importCheckpointKey(candidate.Checkpoints[index])]; ok {
			candidate.Checkpoints[index].Source = stored.Source
		}
	}
}

func importCheckpointKey(checkpoint types.Checkpoint) string {
	return fmt.Sprintf("%s\x00%d", checkpoint.AccountID, checkpoint.ObservedAt)
}

// applyImportedModel reconciles the reviewed document against the stored
// model. Writes are per row, matching the documented multi-row import
// promise; every row was validated against the candidate first.
func applyImportedModel(st store.Store, current *types.FinancialModel, next *types.FinancialModel) error {
	// Deletions run children-first so account removal cannot strand rows.
	for _, transaction := range current.Transactions {
		if !containsID(next.Transactions, transaction.ID, func(row types.Transaction) string { return row.ID }) {
			if err := st.DeleteTransaction(transaction.ID); err != nil && !store.IsNotFound(err) {
				return err
			}
		}
	}
	for _, checkpoint := range current.Checkpoints {
		if !containsCheckpoint(next.Checkpoints, checkpoint) {
			if err := st.DeleteCheckpointAt(checkpoint.AccountID, checkpoint.ObservedAt); err != nil && !store.IsNotFound(err) {
				return err
			}
		}
	}
	for _, purchase := range current.PlannedPurchases {
		if !containsID(next.PlannedPurchases, purchase.ID, func(row types.PlannedPurchase) string { return row.ID }) {
			if err := st.DeletePlannedPurchase(purchase.ID); err != nil && !store.IsNotFound(err) {
				return err
			}
		}
	}
	if err := deleteMissingEvaluations(st, current, next); err != nil {
		return err
	}

	// Upserts keep authored fields. Accounts exist before rows that
	// reference them, and schedules before transaction claims.
	for _, account := range next.Accounts {
		if containsID(current.Accounts, account.ID, func(row types.Account) string { return row.ID }) {
			if _, err := st.UpdateAccount(account); err != nil {
				return err
			}
		} else if _, err := st.CreateAccount(account); err != nil {
			return err
		}
	}
	for _, schedule := range next.Schedules {
		if containsID(current.Schedules, schedule.ID, func(row types.Schedule) string { return row.ID }) {
			if _, err := st.UpdateSchedule(schedule); err != nil {
				return err
			}
		} else if _, err := st.CreateSchedule(schedule); err != nil {
			return err
		}
	}
	for _, transaction := range next.Transactions {
		if containsID(current.Transactions, transaction.ID, func(row types.Transaction) string { return row.ID }) {
			if _, err := st.UpdateTransaction(transaction); err != nil {
				return err
			}
		} else if _, err := st.CreateTransaction(transaction); err != nil {
			return err
		}
	}

	// Remove schedules after transaction writes release or move their claims.
	for _, schedule := range current.Schedules {
		if !containsID(next.Schedules, schedule.ID, func(row types.Schedule) string { return row.ID }) {
			if err := st.DeleteSchedule(schedule.ID); err != nil && !store.IsNotFound(err) {
				return err
			}
		}
	}
	// Remove accounts after the rows that reference them are gone.
	for _, account := range current.Accounts {
		if !containsID(next.Accounts, account.ID, func(row types.Account) string { return row.ID }) {
			if err := st.DeleteAccount(account.ID); err != nil && !store.IsNotFound(err) {
				return err
			}
		}
	}
	for _, checkpoint := range next.Checkpoints {
		if _, err := st.SaveCheckpoint(checkpoint); err != nil {
			return err
		}
	}
	for _, purchase := range next.PlannedPurchases {
		if containsID(current.PlannedPurchases, purchase.ID, func(row types.PlannedPurchase) string { return row.ID }) {
			if _, err := st.UpdatePlannedPurchase(purchase); err != nil {
				return err
			}
		} else if _, err := st.CreatePlannedPurchase(purchase); err != nil {
			return err
		}
	}
	if err := upsertEvaluations(st, next); err != nil {
		return err
	}

	// Restore the document's ordering.
	accountIDs := make([]string, len(next.Accounts))
	for index, account := range next.Accounts {
		accountIDs[index] = account.ID
	}
	transactionIDs := make([]string, len(next.Transactions))
	for index, transaction := range next.Transactions {
		transactionIDs[index] = transaction.ID
	}
	scheduleIDs := make([]string, len(next.Schedules))
	for index, schedule := range next.Schedules {
		scheduleIDs[index] = schedule.ID
	}
	purchaseIDs := make([]string, len(next.PlannedPurchases))
	for index, purchase := range next.PlannedPurchases {
		purchaseIDs[index] = purchase.ID
	}
	if err := reorderIDs(accountIDs, func(id, beforeID string) error { return st.MoveAccount(id, beforeID) }); err != nil {
		return err
	}
	if err := reorderIDs(transactionIDs, func(id, beforeID string) error { return st.MoveTransaction(id, beforeID) }); err != nil {
		return err
	}
	if err := reorderIDs(scheduleIDs, func(id, beforeID string) error { return st.MoveSchedule(id, beforeID) }); err != nil {
		return err
	}
	if err := reorderIDs(purchaseIDs, func(id, beforeID string) error { return st.MovePlannedPurchase(id, beforeID) }); err != nil {
		return err
	}
	return nil
}

func createImportedModel(st store.Store, next *types.FinancialModel) error {
	for _, account := range next.Accounts {
		if _, err := st.CreateAccount(account); err != nil {
			return err
		}
	}
	for _, checkpoint := range next.Checkpoints {
		if _, err := st.SaveCheckpoint(checkpoint); err != nil {
			return err
		}
	}
	for _, schedule := range next.Schedules {
		if _, err := st.CreateSchedule(schedule); err != nil {
			return err
		}
	}
	for _, transaction := range next.Transactions {
		if _, err := st.CreateTransaction(transaction); err != nil {
			return err
		}
	}
	for _, purchase := range next.PlannedPurchases {
		if _, err := st.CreatePlannedPurchase(purchase); err != nil {
			return err
		}
	}
	return upsertEvaluations(st, next)
}

func deleteMissingEvaluations(st store.Store, current, next *types.FinancialModel) error {
	for _, table := range evaluationTables(current) {
		for _, instance := range table.rows {
			if !containsInstance(evaluationTables(next), table.kind, instance.InstanceID) {
				if err := st.DeleteEvaluation(instance.InstanceID); err != nil && !store.IsNotFound(err) {
					return err
				}
			}
		}
	}
	return nil
}

func upsertEvaluations(st store.Store, next *types.FinancialModel) error {
	for _, table := range evaluationTables(next) {
		for _, instance := range table.rows {
			config, err := evaluationConfig(instance.Config)
			if err != nil {
				return fmt.Errorf("evaluation %s config: %w", instance.InstanceID, err)
			}
			update := store.EvaluationUpdate{
				Type:       table.kind,
				InstanceID: instance.InstanceID,
				Name:       instance.Name,
				Enabled:    instance.Enabled,
				Config:     config,
			}
			if _, err := st.UpdateEvaluation(update); err != nil {
				if !store.IsNotFound(err) {
					return err
				}
				if _, err := st.CreateEvaluation(update); err != nil {
					return err
				}
			}
		}
	}
	return nil
}

type evaluationTable struct {
	kind string
	rows []types.EvaluationInstance[types.JsonValue]
}

func evaluationTables(model *types.FinancialModel) []evaluationTable {
	if model == nil {
		return nil
	}
	evaluations := model.Evaluations
	return []evaluationTable{
		{kind: "financialIndependence", rows: evaluations.FinancialIndependence},
		{kind: "netWorthThreshold", rows: evaluations.NetWorthThreshold},
		{kind: "accountBalance", rows: evaluations.AccountBalance},
		{kind: "transactionFulfillment", rows: evaluations.TransactionFulfillment},
		{kind: "cycleFulfillment", rows: evaluations.CycleFulfillment},
		{kind: "plannedPurchases", rows: evaluations.PlannedPurchases},
		{kind: "whatIf", rows: evaluations.WhatIf},
	}
}

// evaluationConfig converts one authored evaluation config to the store's
// generic object form. A non-object config is an error, never a silent drop.
func evaluationConfig(value types.JsonValue) (map[string]any, error) {
	if value == nil {
		return map[string]any{}, nil
	}
	raw, err := json.Marshal(value)
	if err != nil {
		return nil, err
	}
	var config map[string]any
	if err := json.Unmarshal(raw, &config); err != nil {
		return nil, fmt.Errorf("config must be a JSON object")
	}
	return config, nil
}

func containsInstance(tables []evaluationTable, kind, instanceID string) bool {
	for _, table := range tables {
		if table.kind != kind {
			continue
		}
		for _, instance := range table.rows {
			if instance.InstanceID == instanceID {
				return true
			}
		}
	}
	return false
}

func containsID[T any](rows []T, id string, getID func(T) string) bool {
	for _, row := range rows {
		if getID(row) == id {
			return true
		}
	}
	return false
}

// reorderIDs walks the document from the end so each move anchors before its
// successor. The store's move appends when beforeID is empty.
func reorderIDs(ids []string, move func(id, beforeID string) error) error {
	for index := len(ids) - 1; index >= 0; index-- {
		beforeID := ""
		if index+1 < len(ids) {
			beforeID = ids[index+1]
		}
		if err := move(ids[index], beforeID); err != nil {
			return err
		}
	}
	return nil
}

func containsCheckpoint(rows []types.Checkpoint, target types.Checkpoint) bool {
	for _, row := range rows {
		if row.AccountID == target.AccountID && row.ObservedAt == target.ObservedAt {
			return true
		}
	}
	return false
}
