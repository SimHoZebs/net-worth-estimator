package store

import (
	"database/sql"
	"encoding/json"
	"fmt"

	"github.com/simhozebs/net-worth-estimator/backend/internal/types"
)

// SyncPosting separates the exact provider identity from the local posting ID.
// The store allocates the UUID. Provider keys are never sanitized or exposed as IDs.
type SyncPosting struct {
	types.Posting
	ProviderAccountID string
	TransactionID     string
}

type postingSyncKey struct {
	provider, accountID, transactionID, postingID string
}

func loadPostingSyncKeys(tx *sql.Tx) ([]postingSyncKey, error) {
	rows, err := tx.Query(`SELECT provider, account_id, transaction_id, posting_id FROM posting_sync_keys`)
	if err != nil {
		return nil, err
	}
	defer rows.Close()
	var keys []postingSyncKey
	for rows.Next() {
		var key postingSyncKey
		if err := rows.Scan(&key.provider, &key.accountID, &key.transactionID, &key.postingID); err != nil {
			return nil, err
		}
		keys = append(keys, key)
	}
	return keys, rows.Err()
}

func insertPostingSyncKey(tx *sql.Tx, key postingSyncKey) error {
	_, err := tx.Exec(`INSERT INTO posting_sync_keys (provider, account_id, transaction_id, posting_id) VALUES (?, ?, ?, ?)`,
		key.provider, key.accountID, key.transactionID, key.postingID)
	return err
}

func applyPendingSnapshot(tx *sql.Tx, incoming []SyncPosting, accounts []string, summary *SyncApplySummary) error {
	position, err := nextTablePosition(tx, "postings")
	if err != nil {
		return err
	}
	seen := map[string]bool{}
	for _, item := range incoming {
		if item.ProviderAccountID == "" || item.TransactionID == "" || item.SourceAccountID == nil {
			return fmt.Errorf("pending sync posting requires exact provider account and transaction identities plus a model account")
		}
		posting := item.Posting
		posting.Source = SourceSimpleFIN
		posting.Pending = true
		posting.Enabled = false
		key := postingSyncKey{provider: SourceSimpleFIN, accountID: item.ProviderAccountID, transactionID: item.TransactionID}
		err := tx.QueryRow(`SELECT posting_id FROM posting_sync_keys WHERE provider = ? AND account_id = ? AND transaction_id = ?`,
			key.provider, key.accountID, key.transactionID).Scan(&key.postingID)
		switch err {
		case sql.ErrNoRows:
			posting.ExecutionOrder = 0
			posting.ID, err = newRowID()
			if err != nil {
				return err
			}
			if err := claimRowID(tx, posting.ID, "posting"); err != nil {
				return err
			}
			if err := insertPosting(tx, position, &posting, SourceSimpleFIN); err != nil {
				return err
			}
			key.postingID = posting.ID
			if err := insertPostingSyncKey(tx, key); err != nil {
				return err
			}
			position++
			summary.PendingInserted++
		case nil:
			posting.ID = key.postingID
			if err := updatePendingPosting(tx, posting); err != nil {
				return err
			}
			summary.PendingUpdated++
		default:
			return err
		}
		seen[posting.ID] = true
	}
	for _, accountID := range accounts {
		rows, err := tx.Query(`SELECT id FROM postings WHERE source = ? AND source_account_id = ? AND pending = 1`, SourceSimpleFIN, accountID)
		if err != nil {
			return err
		}
		var stale []string
		for rows.Next() {
			var id string
			if err := rows.Scan(&id); err != nil {
				rows.Close()
				return err
			}
			if !seen[id] {
				stale = append(stale, id)
			}
		}
		if err := rows.Err(); err != nil {
			rows.Close()
			return err
		}
		rows.Close()
		for _, id := range stale {
			if _, err := tx.Exec(`DELETE FROM postings WHERE id = ?`, id); err != nil {
				return err
			}
			if err := releaseRowID(tx, id); err != nil {
				return err
			}
			summary.PendingDeleted++
		}
	}
	return nil
}

func updatePendingPosting(tx *sql.Tx, posting types.Posting) error {
	amount, err := json.Marshal(posting.Amount)
	if err != nil {
		return err
	}
	destinations, err := json.Marshal(posting.Destinations)
	if err != nil {
		return err
	}
	result, err := tx.Exec(`UPDATE postings SET name = ?, source_account_id = ?, destinations = ?, amount_resolution_json = ?, posted_time = ?, transaction_time = ?, enabled = 0, pending = 1 WHERE id = ? AND source = ?`,
		posting.Name, nullable(posting.SourceAccountID), string(destinations), string(amount), posting.PostedTime, posting.TransactionTime, posting.ID, SourceSimpleFIN)
	if err != nil {
		return err
	}
	count, err := result.RowsAffected()
	if err != nil {
		return err
	}
	if count != 1 {
		return fmt.Errorf("pending sync identity does not reference a provider-owned posting")
	}
	return nil
}
