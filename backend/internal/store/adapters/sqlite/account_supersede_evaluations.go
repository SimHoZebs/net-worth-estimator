package sqlite

import (
	"encoding/json"
	"fmt"
	"strings"

	"github.com/simhozebs/net-worth-estimator/backend/internal/types"
)

func supersedeEvaluations(tx *userTx, manualID, syncedID string, deletedTransactions, deletedRules map[string]bool) error {
	rows, err := tx.Query(`SELECT type, instance_id, config_json FROM evaluations WHERE user_id = :user_id`)
	if err != nil {
		return fmt.Errorf("read evaluations for account merge: %w", err)
	}
	type evaluationRow struct {
		evalType   string
		instanceID string
		config     string
	}
	var pending []evaluationRow
	for rows.Next() {
		var row evaluationRow
		if err := rows.Scan(&row.evalType, &row.instanceID, &row.config); err != nil {
			rows.Close()
			return err
		}
		if supersedeConfigNeedsRewrite(row.config, manualID, deletedTransactions, deletedRules) {
			pending = append(pending, row)
		}
	}
	if err := rows.Err(); err != nil {
		rows.Close()
		return err
	}
	rows.Close()
	for _, row := range pending {
		updated, err := supersedeRewriteConfig(row.evalType, row.config, manualID, syncedID, deletedTransactions, deletedRules)
		if err != nil {
			return fmt.Errorf("rewrite evaluation %s: %w", row.instanceID, err)
		}
		if _, err := tx.Exec(`UPDATE evaluations SET config_json = ? WHERE type = ? AND instance_id = ? AND user_id = :user_id`,
			updated, row.evalType, row.instanceID); err != nil {
			return fmt.Errorf("update evaluation %s: %w", row.instanceID, err)
		}
	}
	return nil
}

func supersedeConfigNeedsRewrite(raw, manualID string, deletedTransactions, deletedRules map[string]bool) bool {
	if strings.Contains(raw, manualID) {
		return true
	}
	for id := range deletedTransactions {
		if strings.Contains(raw, id) {
			return true
		}
	}
	for id := range deletedRules {
		if strings.Contains(raw, id) {
			return true
		}
	}
	return false
}

func supersedeRewriteConfig(evalType, raw, manualID, syncedID string, deletedTransactions, deletedRules map[string]bool) (string, error) {
	switch evalType {
	case types.EvaluationTypeAccountBalance:
		var config types.AccountBalanceConfig
		if err := json.Unmarshal([]byte(raw), &config); err != nil {
			return "", err
		}
		if config.AccountID == manualID {
			config.AccountID = syncedID
		}
		return supersedeMarshal(config)
	case types.EvaluationTypeCycleFulfillment:
		var config types.CycleFulfillmentConfig
		if err := json.Unmarshal([]byte(raw), &config); err != nil {
			return "", err
		}
		config.AccountIDs = supersedeReplaceIDs(config.AccountIDs, manualID, syncedID)
		return supersedeMarshal(config)
	case types.EvaluationTypeTransactionFulfillment:
		var config types.TransactionFulfillmentConfig
		if err := json.Unmarshal([]byte(raw), &config); err != nil {
			return "", err
		}
		config.TransactionIDs = supersedeRemoveIDs(config.TransactionIDs, deletedTransactions)
		return supersedeMarshal(config)
	case types.EvaluationTypeFinancialIndependence:
		var plan types.FIPlan
		if err := json.Unmarshal([]byte(raw), &plan); err != nil {
			return "", err
		}
		sources := plan.Sources[:0]
		for _, source := range plan.Sources {
			if source.TransactionID != "" && deletedTransactions[source.TransactionID] {
				continue
			}
			if source.AccountID == manualID {
				source.AccountID = syncedID
			}
			sources = append(sources, source)
		}
		plan.Sources = sources
		plan.ContinuingTransactionIDs = supersedeRemoveIDs(plan.ContinuingTransactionIDs, deletedTransactions)
		return supersedeMarshal(plan)
	case types.EvaluationTypeWhatIf:
		var config types.WhatIfConfig
		if err := json.Unmarshal([]byte(raw), &config); err != nil {
			return "", err
		}
		accounts := config.AddedAccounts[:0]
		for _, account := range config.AddedAccounts {
			if account.ID == manualID {
				continue
			}
			accounts = append(accounts, account)
		}
		config.AddedAccounts = accounts
		transactions := config.AddedTransactions[:0]
		for _, transaction := range config.AddedTransactions {
			if transaction.SourceAccountID != nil && *transaction.SourceAccountID == manualID {
				replacement := syncedID
				transaction.SourceAccountID = &replacement
			}
			transaction.Destinations = supersedeReplaceIDs(transaction.Destinations, manualID, syncedID)
			supersedeAmountResolution(&transaction.Amount, manualID, syncedID)
			if transaction.SourceAccountID != nil && supersedeContains(transaction.Destinations, *transaction.SourceAccountID) {
				continue
			}
			if transaction.Claim != nil && deletedRules[transaction.Claim.ScheduleID] {
				transaction.Claim = nil
			}
			transactions = append(transactions, transaction)
		}
		config.AddedTransactions = transactions
		rules := config.AddedRules[:0]
		for _, rule := range config.AddedRules {
			if rule.SourceAccountID != nil && *rule.SourceAccountID == manualID {
				replacement := syncedID
				rule.SourceAccountID = &replacement
			}
			rule.Destinations = supersedeReplaceIDs(rule.Destinations, manualID, syncedID)
			if rule.SourceAccountID != nil && supersedeContains(rule.Destinations, *rule.SourceAccountID) {
				continue
			}
			supersedeAmountResolution(&rule.Amount, manualID, syncedID)
			rules = append(rules, rule)
		}
		config.AddedRules = rules
		config.DisabledAccountIDs = supersedeReplaceIDs(config.DisabledAccountIDs, manualID, syncedID)
		config.DisabledTransactionIDs = supersedeRemoveIDs(config.DisabledTransactionIDs, deletedTransactions)
		config.DisabledScheduleIDs = supersedeRemoveIDs(config.DisabledScheduleIDs, deletedRules)
		return supersedeMarshal(config)
	default:
		// Known types are handled explicitly. Leave an unknown future config
		// untouched so validation fails closed instead of rewriting a string
		// that only happens to equal an account ID.
		return raw, nil
	}
}

func supersedeMarshal(value any) (string, error) {
	encoded, err := json.Marshal(value)
	if err != nil {
		return "", err
	}
	return string(encoded), nil
}

func supersedeReplaceValue(value any, oldID, newID string) any {
	switch typed := value.(type) {
	case string:
		if typed == oldID {
			return newID
		}
		return typed
	case []any:
		out := make([]any, 0, len(typed))
		for _, item := range typed {
			out = append(out, supersedeReplaceValue(item, oldID, newID))
		}
		return out
	case map[string]any:
		out := make(map[string]any, len(typed))
		for key, item := range typed {
			out[key] = supersedeReplaceValue(item, oldID, newID)
		}
		return out
	default:
		return value
	}
}
