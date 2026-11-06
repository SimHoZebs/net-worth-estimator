package sqlite

import (
	"database/sql"
	"encoding/json"
	"fmt"

	"github.com/simhozebs/net-worth-estimator/backend/internal/types"
)

func observeBankTransaction(tx *userTx, observation *BankObservation) error {
	id, err := resolveBankKeys(tx, observation.Keys)
	if err != nil || id == "" {
		return err
	} // Deferred/unmapped transactions have no canonical identity yet.
	data, err := json.Marshal(observation.Facts)
	if err != nil {
		return err
	}
	_, err = tx.Exec(`INSERT INTO transaction_source_facts(transaction_id, facts_json, user_id) VALUES (?, ?, :user_id)
		ON CONFLICT(user_id, transaction_id) DO UPDATE SET facts_json = excluded.facts_json
		WHERE transaction_source_facts.facts_json != excluded.facts_json`, id, string(data))
	if err != nil {
		return err
	}
	if err := ensureCategorySchema(tx); err != nil {
		return fmt.Errorf("ensure transaction categories: %w", err)
	}
	provider := ""
	if len(observation.Keys) > 0 {
		provider = observation.Keys[0].Provider
	}
	return setBankTransactionCategory(tx, id, provider, observation.Facts)
}

func analysisRevision(tx *userTx) (int64, error) {
	var revision int64
	err := tx.QueryRow(`SELECT revision FROM analysis_inputs WHERE user_id = :user_id`).Scan(&revision)
	if err == sql.ErrNoRows {
		return 0, nil
	}
	return revision, err
}

func loadAnalysisSnapshot(tx *userTx, revision int64) (types.AnalysisSnapshot, error) {
	result := types.AnalysisSnapshot{Revision: revision, Transactions: []types.AnalysisTransaction{}}
	rows, err := tx.Query(`SELECT p.id, k.bridge_account_id, k.provider, p.pending, p.void, f.facts_json
		FROM transaction_source_facts f JOIN transactions p ON p.user_id = f.user_id AND p.id = f.transaction_id
		JOIN transaction_sync_keys k ON k.user_id = p.user_id AND k.transaction_id = p.id
		WHERE f.user_id = :user_id ORDER BY p.id`)
	if err != nil {
		return result, err
	}
	defer rows.Close()
	for rows.Next() {
		var item types.AnalysisTransaction
		var raw string
		if err := rows.Scan(&item.TransactionID, &item.AccountID, &item.SourceProvider, &item.Pending, &item.Void, &raw); err != nil {
			return result, err
		}
		if err := json.Unmarshal([]byte(raw), &item.Facts); err != nil {
			return result, fmt.Errorf("decode transaction evidence: %w", err)
		}
		result.Transactions = append(result.Transactions, item)
	}
	return result, rows.Err()
}

// ListAnalysisUsers discovers saved input revisions without a request or sync hook.
func (d *Database) ListAnalysisUsers() ([]string, error) {
	rows, err := d.db.Query(`SELECT user_id FROM analysis_inputs ORDER BY user_id`)
	if err != nil {
		return nil, err
	}
	defer rows.Close()
	var ids []string
	for rows.Next() {
		var id string
		if err := rows.Scan(&id); err != nil {
			return nil, err
		}
		ids = append(ids, id)
	}
	return ids, rows.Err()
}
