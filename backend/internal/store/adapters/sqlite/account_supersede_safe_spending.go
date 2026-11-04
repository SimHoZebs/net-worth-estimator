package sqlite

import (
	"database/sql"
	"encoding/json"
	"fmt"

	"github.com/simhozebs/net-worth-estimator/backend/internal/types"
)

func supersedeSafeSpending(tx *userTx, manualID, syncedID string, deletedPostings, deletedRules map[string]bool) error {
	var raw string
	if err := tx.QueryRow(`SELECT settings_json FROM safe_spending_settings WHERE id = 1 AND user_id = :user_id`).Scan(&raw); err != nil {
		if err == sql.ErrNoRows {
			return nil
		}
		return fmt.Errorf("read safe spending settings: %w", err)
	}
	var settings types.SafeSpendingSettings
	if err := json.Unmarshal([]byte(raw), &settings); err != nil {
		return fmt.Errorf("parse safe spending settings: %w", err)
	}
	settings.AccountIDs = supersedeReplaceIDs(settings.AccountIDs, manualID, syncedID)
	settings.SpendingAccountIDs = supersedeReplaceIDs(settings.SpendingAccountIDs, manualID, syncedID)
	settings.IncomeAccountIDs = supersedeReplaceIDs(settings.IncomeAccountIDs, manualID, syncedID)
	settings.TransactionIDs = supersedeRemoveIDs(settings.TransactionIDs, deletedPostings)
	settings.IncomeRuleIDs = supersedeRemoveIDs(settings.IncomeRuleIDs, deletedRules)
	encoded, err := json.Marshal(settings)
	if err != nil {
		return fmt.Errorf("encode safe spending settings: %w", err)
	}
	if _, err := tx.Exec(`UPDATE safe_spending_settings SET settings_json = ? WHERE id = 1 AND user_id = :user_id`, string(encoded)); err != nil {
		return fmt.Errorf("update safe spending settings: %w", err)
	}
	return nil
}

// supersedeSyncCards moves a manual account selected as a card to the synced
// replacement. Card IDs live in sync_credentials, beside the Bridge key, and
// are validated against the model on every card-set write.
func supersedeSyncCards(tx *userTx, manualID, syncedID string) error {
	var raw string
	if err := tx.QueryRow(`SELECT cards_json FROM sync_credentials WHERE id = 1 AND user_id = :user_id`).Scan(&raw); err != nil {
		if err == sql.ErrNoRows {
			return nil
		}
		return fmt.Errorf("read sync cards: %w", err)
	}
	cards := []string{}
	if raw != "" {
		if err := json.Unmarshal([]byte(raw), &cards); err != nil {
			return fmt.Errorf("parse sync cards: %w", err)
		}
	}
	cards = supersedeReplaceIDs(cards, manualID, syncedID)
	encoded, err := json.Marshal(cards)
	if err != nil {
		return fmt.Errorf("encode sync cards: %w", err)
	}
	if _, err := tx.Exec(`UPDATE sync_credentials SET cards_json = ? WHERE id = 1 AND user_id = :user_id`, string(encoded)); err != nil {
		return fmt.Errorf("update sync cards: %w", err)
	}
	return nil
}
