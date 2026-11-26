package sqlite

import (
	"fmt"

	"github.com/simhozebs/net-worth-estimator/backend/internal/types"
)

func supersedeSafeSpending(tx *userTx, manualID, syncedID string, deletedTransactions, deletedRules map[string]bool) error {
	return rewriteSafeSpendingSettings(tx, func(settings *types.SafeSpendingSettings) {
		settings.AccountIDs = replaceIDs(settings.AccountIDs, manualID, syncedID)
		settings.SpendingAccountIDs = replaceIDs(settings.SpendingAccountIDs, manualID, syncedID)
		settings.TransactionIDs = removeIDs(settings.TransactionIDs, deletedTransactions)
		settings.IncomeScheduleIDs = removeIDs(settings.IncomeScheduleIDs, deletedRules)
	})
}

// rewriteSafeSpendingSettings applies one in-transaction transformation while
// preserving every unrelated setting and each list's nil-versus-empty shape.
func rewriteSafeSpendingSettings(tx *userTx, rewrite func(*types.SafeSpendingSettings)) error {
	raw, found, err := readSettingsJSON(tx, `SELECT settings_json FROM safe_spending_settings WHERE id = 1 AND user_id = :user_id`)
	if err != nil {
		return fmt.Errorf("read safe spending settings: %w", err)
	}
	if !found {
		return nil
	}
	settings, err := decodeSafeSpendingSettings(raw)
	if err != nil {
		return fmt.Errorf("parse safe spending settings: %w", err)
	}
	rewrite(settings)
	if err := writeSettingsJSON(tx, `UPDATE safe_spending_settings SET settings_json = ? WHERE id = 1 AND user_id = :user_id`, settings); err != nil {
		return fmt.Errorf("write safe spending settings: %w", err)
	}
	return nil
}
