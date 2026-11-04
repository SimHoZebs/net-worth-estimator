package sqlite

import (
	"encoding/json"
	"fmt"
	"strings"

	"github.com/simhozebs/net-worth-estimator/backend/internal/types"
)

func supersedeEvaluations(tx *userTx, manualID, syncedID string, deletedPostings, deletedRules map[string]bool) error {
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
		if supersedeConfigNeedsRewrite(row.config, manualID, deletedPostings, deletedRules) {
			pending = append(pending, row)
		}
	}
	if err := rows.Err(); err != nil {
		rows.Close()
		return err
	}
	rows.Close()
	for _, row := range pending {
		updated, err := supersedeRewriteConfig(row.evalType, row.config, manualID, syncedID, deletedPostings, deletedRules)
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

func supersedeConfigNeedsRewrite(raw, manualID string, deletedPostings, deletedRules map[string]bool) bool {
	if strings.Contains(raw, manualID) {
		return true
	}
	for id := range deletedPostings {
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

func supersedeRewriteConfig(evalType, raw, manualID, syncedID string, deletedPostings, deletedRules map[string]bool) (string, error) {
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
	case types.EvaluationTypePostingFulfillment:
		var config types.PostingFulfillmentConfig
		if err := json.Unmarshal([]byte(raw), &config); err != nil {
			return "", err
		}
		config.PostingIDs = supersedeRemoveIDs(config.PostingIDs, deletedPostings)
		return supersedeMarshal(config)
	case types.EvaluationTypeFinancialIndependence:
		var plan types.FIPlan
		if err := json.Unmarshal([]byte(raw), &plan); err != nil {
			return "", err
		}
		sources := plan.Sources[:0]
		for _, source := range plan.Sources {
			if source.PostingID != "" && deletedPostings[source.PostingID] {
				continue
			}
			if source.AccountID == manualID {
				source.AccountID = syncedID
			}
			sources = append(sources, source)
		}
		plan.Sources = sources
		plan.ContinuingPostingIDs = supersedeRemoveIDs(plan.ContinuingPostingIDs, deletedPostings)
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
		postings := config.AddedPostings[:0]
		for _, posting := range config.AddedPostings {
			if posting.SourceAccountID != nil && *posting.SourceAccountID == manualID {
				replacement := syncedID
				posting.SourceAccountID = &replacement
			}
			posting.Destinations = supersedeReplaceIDs(posting.Destinations, manualID, syncedID)
			supersedeAmountResolution(&posting.Amount, manualID, syncedID)
			if posting.SourceAccountID != nil && supersedeContains(posting.Destinations, *posting.SourceAccountID) {
				continue
			}
			if posting.Claim != nil && deletedRules[posting.Claim.RuleID] {
				posting.Claim = nil
			}
			postings = append(postings, posting)
		}
		config.AddedPostings = postings
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
		config.DisabledPostingIDs = supersedeRemoveIDs(config.DisabledPostingIDs, deletedPostings)
		config.DisabledRuleIDs = supersedeRemoveIDs(config.DisabledRuleIDs, deletedRules)
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
