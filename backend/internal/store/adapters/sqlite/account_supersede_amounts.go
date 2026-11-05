package sqlite

import (
	"encoding/json"
	"fmt"
	"reflect"

	"github.com/simhozebs/net-worth-estimator/backend/internal/types"
)

func supersedePostingAmounts(tx *userTx, model *types.FinancialModel, deleted map[string]bool, manualID, syncedID string) error {
	for _, posting := range model.Postings {
		if deleted[posting.ID] {
			continue
		}
		if !supersedeAmountResolution(&posting.Amount, manualID, syncedID) {
			continue
		}
		encoded, err := json.Marshal(posting.Amount)
		if err != nil {
			return fmt.Errorf("marshal posting amount %s: %w", posting.ID, err)
		}
		if _, err := tx.Exec(`UPDATE postings SET amount_resolution_json = ? WHERE id = ? AND user_id = :user_id`, string(encoded), posting.ID); err != nil {
			return fmt.Errorf("move posting amount reference %s: %w", posting.ID, err)
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

func supersedeAmountResolution(amount *types.PostingAmountResolution, manualID, syncedID string) bool {
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
// because posting_claims references the rule without a cascade.
