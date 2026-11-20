package sqlite

import (
	"encoding/json"
	"fmt"
)

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

// supersedeSyncCards moves a manual account selected as a card to the synced
// replacement. Card IDs live in sync_credentials, beside the Bridge key, and
// are validated against the model on every card-set write.
func supersedeSyncCards(tx *userTx, manualID, syncedID string) error {
	raw, found, err := readSettingsJSON(tx, `SELECT cards_json FROM sync_credentials WHERE id = 1 AND user_id = :user_id`)
	if err != nil {
		return fmt.Errorf("read sync cards: %w", err)
	}
	if !found {
		return nil
	}
	cards := []string{}
	if raw != "" {
		if err := json.Unmarshal([]byte(raw), &cards); err != nil {
			return fmt.Errorf("parse sync cards: %w", err)
		}
	}
	cards = supersedeReplaceIDs(cards, manualID, syncedID)
	if err := writeSettingsJSON(tx, `UPDATE sync_credentials SET cards_json = ? WHERE id = 1 AND user_id = :user_id`, cards); err != nil {
		return fmt.Errorf("write sync cards: %w", err)
	}
	return nil
}
