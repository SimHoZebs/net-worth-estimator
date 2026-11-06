package sqlite

import (
	"encoding/json"
	"fmt"
	"reflect"

	"github.com/simhozebs/net-worth-estimator/backend/internal/types"
)

func supersedeTransactionAmounts(tx *userTx, model *types.FinancialModel, deleted map[string]bool, manualID, syncedID string) error {
	for _, transaction := range model.Transactions {
		if deleted[transaction.ID] {
			continue
		}
		if !supersedeAmountResolution(&transaction.Amount, manualID, syncedID) {
			continue
		}
		encoded, err := json.Marshal(transaction.Amount)
		if err != nil {
			return fmt.Errorf("marshal transaction amount %s: %w", transaction.ID, err)
		}
		if _, err := tx.Exec(`UPDATE transactions SET amount_resolution_json = ? WHERE id = ? AND user_id = :user_id`, string(encoded), transaction.ID); err != nil {
			return fmt.Errorf("move transaction amount reference %s: %w", transaction.ID, err)
		}
	}
	return nil
}

// supersedeRuleAmounts rewrites provider argument references on rules that
// survive the merge, including rules whose route did not touch the manual
// account.
func supersedeRuleAmounts(tx *userTx, model *types.FinancialModel, deleted map[string]bool, manualID, syncedID string) error {
	for _, rule := range model.Schedules {
		if deleted[rule.ID] {
			continue
		}
		if !supersedeAmountResolution(&rule.Amount, manualID, syncedID) {
			continue
		}
		encoded, err := json.Marshal(rule.Amount)
		if err != nil {
			return fmt.Errorf("marshal rule amount %s: %w", rule.ID, err)
		}
		if _, err := tx.Exec(`UPDATE recurrence_rules SET amount_resolution_json = ? WHERE id = ? AND user_id = :user_id`, string(encoded), rule.ID); err != nil {
			return fmt.Errorf("move rule amount reference %s: %w", rule.ID, err)
		}
	}
	return nil
}

func supersedeAmountResolution(amount *types.TransactionAmountResolution, manualID, syncedID string) bool {
	if amount == nil || len(amount.Inputs) == 0 {
		return false
	}
	changed := false
	for name, binding := range amount.Inputs {
		if binding.Source != "provider" || len(binding.Arguments) == 0 {
			continue
		}
		for key, value := range binding.Arguments {
			if replaced := supersedeReplaceValue(value, manualID, syncedID); !reflect.DeepEqual(replaced, value) {
				binding.Arguments[key] = replaced
				changed = true
			}
		}
		amount.Inputs[name] = binding
	}
	return changed
}

// supersedeRules moves rule routes from the manual account to the synced
// account. A rule whose source and destination both land on the synced
// account is a self-transfer and is deleted; claims on that rule go first
// because transaction_claims references the rule without a cascade.
