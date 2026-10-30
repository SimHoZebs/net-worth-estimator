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
	_, err = tx.Exec(`INSERT INTO transaction_source_facts(posting_id, facts_json, user_id) VALUES (?, ?, :user_id)
		ON CONFLICT(user_id, posting_id) DO UPDATE SET facts_json = excluded.facts_json
		WHERE transaction_source_facts.facts_json != excluded.facts_json`, id, string(data))
	return err
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
		FROM transaction_source_facts f JOIN postings p ON p.user_id = f.user_id AND p.id = f.posting_id
		JOIN posting_sync_keys k ON k.user_id = p.user_id AND k.posting_id = p.id
		WHERE f.user_id = :user_id ORDER BY p.id`)
	if err != nil {
		return result, err
	}
	defer rows.Close()
	for rows.Next() {
		var item types.AnalysisTransaction
		var raw string
		if err := rows.Scan(&item.PostingID, &item.AccountID, &item.SourceProvider, &item.Pending, &item.Void, &raw); err != nil {
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
