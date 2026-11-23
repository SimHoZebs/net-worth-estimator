package sqlite

import "fmt"

func supersedeSafeSpending(tx *userTx, manualID, syncedID string, deletedTransactions, deletedRules map[string]bool) error {
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
	settings.AccountIDs = supersedeReplaceIDs(settings.AccountIDs, manualID, syncedID)
	settings.SpendingAccountIDs = supersedeReplaceIDs(settings.SpendingAccountIDs, manualID, syncedID)
	settings.TransactionIDs = supersedeRemoveIDs(settings.TransactionIDs, deletedTransactions)
	settings.IncomeScheduleIDs = supersedeRemoveIDs(settings.IncomeScheduleIDs, deletedRules)
	if err := writeSettingsJSON(tx, `UPDATE safe_spending_settings SET settings_json = ? WHERE id = 1 AND user_id = :user_id`, settings); err != nil {
		return fmt.Errorf("write safe spending settings: %w", err)
	}
	return nil
}
