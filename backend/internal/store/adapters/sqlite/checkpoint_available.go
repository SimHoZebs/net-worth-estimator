package sqlite

import (
	"database/sql"
)

// upsertAvailableBalanceTx writes the bank-reported available figure for one
// checkpoint. A nil value deletes the sidecar row, so an owner replacement or
// a later report without the field never leaves stale evidence behind.
func upsertAvailableBalanceTx(tx *userTx, accountID string, observedAt int64, value *float64) error {
	if value == nil {
		_, err := tx.Exec(`DELETE FROM checkpoint_available_balances WHERE model_account_id = ? AND observed_at = ? AND user_id = :user_id`, accountID, observedAt)
		return err
	}
	_, err := tx.Exec(`INSERT INTO checkpoint_available_balances (model_account_id, observed_at, available_balance, user_id) VALUES (?,?,?, :user_id)
		ON CONFLICT(user_id, model_account_id, observed_at) DO UPDATE SET available_balance = excluded.available_balance`, accountID, observedAt, *value)
	return err
}

// scanAvailableBalance reads a nullable sidecar column.
func scanAvailableBalance(raw sql.NullFloat64) *float64 {
	if !raw.Valid {
		return nil
	}
	value := raw.Float64
	return &value
}
