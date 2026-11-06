package sqlite

import (
	"database/sql"
	"encoding/json"
	"fmt"
	"strings"

	"github.com/simhozebs/net-worth-estimator/backend/internal/types"
)

type transactionSyncKey struct {
	// provider/accountID/bankTransactionID are the exact upstream identities.
	provider, accountID, bankTransactionID, transactionID string
}

func loadTransactionSyncKeys(tx *userTx) ([]transactionSyncKey, error) {
	rows, err := tx.Query(`SELECT provider, bridge_account_id, bank_transaction_id, transaction_id FROM transaction_sync_keys WHERE user_id = :user_id`)
	if err != nil {
		return nil, err
	}
	defer rows.Close()
	var keys []transactionSyncKey
	for rows.Next() {
		var key transactionSyncKey
		if err := rows.Scan(&key.provider, &key.accountID, &key.bankTransactionID, &key.transactionID); err != nil {
			return nil, err
		}
		keys = append(keys, key)
	}
	return keys, rows.Err()
}

func insertTransactionSyncKey(tx *userTx, key transactionSyncKey) error {
	_, err := tx.Exec(`INSERT INTO transaction_sync_keys (provider, bridge_account_id, bank_transaction_id, transaction_id, user_id) VALUES (?, ?, ?, ?, :user_id)`,
		key.provider, key.accountID, key.bankTransactionID, key.transactionID)
	return err
}

// ensureSuppressionSchema creates the do-not-import list on demand so
// databases provisioned before it existed keep working untouched.
func ensureSuppressionSchema(tx *userTx) error {
	_, err := tx.Exec(suppressedSyncKeysDDL)
	return err
}

func ensureSuppressionSchemaDB(db *userDB) error {
	var count int
	if err := db.DB.QueryRow(`SELECT COUNT(*) FROM sqlite_master WHERE type = 'table' AND name = 'suppressed_sync_keys'`).Scan(&count); err != nil {
		return err
	}
	if count == 1 {
		return nil
	}
	_, err := db.DB.Exec(suppressedSyncKeysDDL)
	return err
}

// ListSyncAccountKeys returns every distinct account key recorded for one
// provider, including rows whose account link was removed. The SimpleFIN
// migration guard uses it before provisioning, so a skipped conversion
// cannot create duplicate accounts.
func (s *sqliteStore) ListSyncAccountKeys(provider string) ([]string, error) {
	if err := ensureSuppressionSchemaDB(s.db); err != nil {
		return nil, fmt.Errorf("ensure suppressed sync keys: %w", err)
	}
	rows, err := s.db.Query(`SELECT bridge_account_id FROM transaction_sync_keys WHERE provider = ? AND user_id = :user_id
		UNION
		SELECT bridge_account_id FROM suppressed_sync_keys WHERE provider = ? AND user_id = :user_id
		ORDER BY 1`, provider, provider)
	if err != nil {
		return nil, fmt.Errorf("list sync account keys: %w", err)
	}
	defer rows.Close()
	keys := []string{}
	for rows.Next() {
		var key string
		if err := rows.Scan(&key); err != nil {
			return nil, err
		}
		keys = append(keys, key)
	}
	return keys, rows.Err()
}

// suppressTransactionKeys copies a row's bank ids onto the do-not-import list.
// Keyless owner rows suppress nothing. All placeholders stay positional:
// mixing ? with named arguments misbinds on this driver.
func suppressTransactionKeys(tx *userTx, transactionID string, now int64) error {
	_, err := tx.Exec(`INSERT OR IGNORE INTO suppressed_sync_keys (provider, bridge_account_id, bank_transaction_id, suppressed_at, user_id)
		SELECT provider, bridge_account_id, bank_transaction_id, ?, ? FROM transaction_sync_keys WHERE transaction_id = ? AND user_id = ?`,
		now, tx.userID, transactionID, tx.userID)
	return err
}

func loadSuppressedKeys(tx *userTx) (map[BankKey]struct{}, error) {
	rows, err := tx.Query(`SELECT provider, bridge_account_id, bank_transaction_id FROM suppressed_sync_keys WHERE user_id = :user_id`)
	if err != nil {
		return nil, err
	}
	defer rows.Close()
	out := map[BankKey]struct{}{}
	for rows.Next() {
		var key BankKey
		if err := rows.Scan(&key.Provider, &key.AccountID, &key.TransactionID); err != nil {
			return nil, err
		}
		out[key] = struct{}{}
	}
	return out, rows.Err()
}

// suppressedUpsert reports whether every key of an upsert sits on the
// do-not-import list. A removed charge stays removed: the feed keeps
// sending it, apply keeps skipping it.
func suppressedUpsert(suppressed map[BankKey]struct{}, upsert *BankUpsert) bool {
	if len(upsert.Keys) == 0 {
		return false
	}
	for _, key := range upsert.Keys {
		if _, ok := suppressed[key]; !ok {
			return false
		}
	}
	return true
}

// LoadBankTransactions returns every bank-reported transaction with the upstream
// identities pointing at it. Adapters reconcile snapshots against this.
func (s *sqliteStore) LoadBankTransactions() ([]BankRow, error) {
	rows, err := s.db.Query(`SELECT `+transactionSelect+` `+transactionJoins+` WHERE p.source != ? AND p.projection_slice_id IS NULL AND p.user_id = :user_id ORDER BY s.position`, SourceUser)
	if err != nil {
		return nil, err
	}
	defer rows.Close()
	var out []BankRow
	for rows.Next() {
		var row BankRow
		var err error
		row.Transaction, err = scanTransactionRow(rows)
		if err != nil {
			return nil, err
		}
		out = append(out, row)
	}
	if err := rows.Err(); err != nil {
		return nil, err
	}
	keys, err := s.db.Query(`SELECT provider, bridge_account_id, bank_transaction_id, transaction_id FROM transaction_sync_keys WHERE user_id = :user_id`)
	if err != nil {
		return nil, err
	}
	defer keys.Close()
	byTransaction := map[string][]BankKey{}
	for keys.Next() {
		var provider, account, transaction, transactionID string
		if err := keys.Scan(&provider, &account, &transaction, &transactionID); err != nil {
			return nil, err
		}
		byTransaction[transactionID] = append(byTransaction[transactionID], BankKey{Provider: provider, AccountID: account, TransactionID: transaction})
	}
	if err := keys.Err(); err != nil {
		return nil, err
	}
	for i := range out {
		out[i].Keys = byTransaction[out[i].Transaction.ID]
	}
	return out, nil
}

func validBankKey(key BankKey) bool {
	return key.Provider != "" && key.AccountID != "" && key.TransactionID != ""
}

func resolveBankKeys(tx *userTx, keys []BankKey) (string, error) {
	resolved := ""
	for _, key := range keys {
		if !validBankKey(key) {
			return "", fmt.Errorf("bank key requires provider, account, and transaction identities")
		}
		var transactionID string
		err := tx.QueryRow(`SELECT transaction_id FROM transaction_sync_keys WHERE provider = ? AND bridge_account_id = ? AND bank_transaction_id = ? AND user_id = :user_id`,
			key.Provider, key.AccountID, key.TransactionID).Scan(&transactionID)
		if err == sql.ErrNoRows {
			continue
		}
		if err != nil {
			return "", err
		}
		if resolved != "" && resolved != transactionID {
			return "", fmt.Errorf("bank keys identify different transactions")
		}
		resolved = transactionID
	}
	return resolved, nil
}

// batchResolveBankKeys loads every distinct upsert key in the directive batch
// with chunked tuple-IN queries instead of one point SELECT per key.
func batchResolveBankKeys(tx *userTx, directives []BankDirective) (map[BankKey]string, error) {
	unique := map[BankKey]struct{}{}
	for _, directive := range directives {
		if directive.Upsert == nil {
			continue
		}
		for _, key := range directive.Upsert.Keys {
			if !validBankKey(key) {
				return nil, fmt.Errorf("bank key requires provider, account, and transaction identities")
			}
			unique[key] = struct{}{}
		}
	}
	out := map[BankKey]string{}
	if len(unique) == 0 {
		return out, nil
	}
	keys := make([]BankKey, 0, len(unique))
	for key := range unique {
		keys = append(keys, key)
	}
	const chunkSize = 200
	for start := 0; start < len(keys); start += chunkSize {
		end := start + chunkSize
		if end > len(keys) {
			end = len(keys)
		}
		chunk := keys[start:end]
		tuples := make([]string, len(chunk))
		args := make([]any, 0, len(chunk)*3)
		for i, key := range chunk {
			tuples[i] = "(?,?,?)"
			args = append(args, key.Provider, key.AccountID, key.TransactionID)
		}
		rows, err := tx.Query(`SELECT provider, bridge_account_id, bank_transaction_id, transaction_id FROM transaction_sync_keys WHERE (provider, bridge_account_id, bank_transaction_id) IN (`+strings.Join(tuples, ",")+`) AND user_id = :user_id`, args...)
		if err != nil {
			return nil, err
		}
		for rows.Next() {
			var key BankKey
			var transactionID string
			if err := rows.Scan(&key.Provider, &key.AccountID, &key.TransactionID, &transactionID); err != nil {
				rows.Close()
				return nil, err
			}
			out[key] = transactionID
		}
		if err := rows.Err(); err != nil {
			rows.Close()
			return nil, err
		}
		rows.Close()
	}
	return out, nil
}

func resolveBankKeysFromMap(keys []BankKey, byKey map[BankKey]string) (string, error) {
	resolved := ""
	for _, key := range keys {
		if !validBankKey(key) {
			return "", fmt.Errorf("bank key requires provider, account, and transaction identities")
		}
		transactionID, ok := byKey[key]
		if !ok {
			continue
		}
		if resolved != "" && resolved != transactionID {
			return "", fmt.Errorf("bank keys identify different transactions")
		}
		resolved = transactionID
	}
	return resolved, nil
}

func recordBankKeys(tx *userTx, transactionID string, keys []BankKey) error {
	if len(keys) == 0 {
		return nil
	}
	for _, key := range keys {
		if !validBankKey(key) {
			return fmt.Errorf("bank key requires provider, account, and transaction identities")
		}
	}
	placeholders := make([]string, len(keys))
	args := make([]any, 0, len(keys)*4)
	for i, key := range keys {
		placeholders[i] = "(?,?,?,?, :user_id)"
		args = append(args, key.Provider, key.AccountID, key.TransactionID, transactionID)
	}
	_, err := tx.Exec(`INSERT INTO transaction_sync_keys (provider, bridge_account_id, bank_transaction_id, transaction_id, user_id) VALUES `+strings.Join(placeholders, ","),
		args...)
	return err
}

func writeBankValues(tx *userTx, id string, transaction types.Transaction) error {
	// A claimed row is the owner's recorded occurrence: the feed still
	// delivers its values (same-key settles and converts land here), but it
	// never returns to a pending seed while the authorization still lingers
	// in the feed, and it stays enabled so it keeps participating.
	var claimed int
	_ = tx.QueryRow(`SELECT 1 FROM transaction_claims WHERE transaction_id = ? AND user_id = :user_id`, id).Scan(&claimed)
	pending, enabled := transaction.Pending, transaction.Enabled
	if claimed != 0 {
		pending, enabled = false, true
	}
	amount, err := json.Marshal(transaction.Amount)
	if err != nil {
		return err
	}
	destinations, err := json.Marshal(transaction.Destinations)
	if err != nil {
		return err
	}
	result, err := tx.Exec(`UPDATE transactions SET name = ?, source_account_id = ?, destination_account_ids = ?, amount_resolution_json = ?, posted_time = ?, transaction_time = ?, pending = ?, void = ? WHERE id = ? AND source != ? AND user_id = :user_id`,
		transaction.Name, nullable(transaction.SourceAccountID), string(destinations), string(amount), transaction.PostedTime, transaction.TransactionTime, boolToInt(pending), boolToInt(transaction.Void), id, SourceUser)
	if err != nil {
		return err
	}
	count, err := result.RowsAffected()
	if err != nil {
		return err
	}
	if count != 1 {
		return fmt.Errorf("bank row %s missing or owner-owned", id)
	}
	// Enabled lives in the sim satellite; the core update above never
	// touches it.
	if _, err := tx.Exec(`UPDATE transaction_sim SET enabled = ? WHERE transaction_id = ? AND user_id = :user_id`,
		boolToInt(enabled), id); err != nil {
		return err
	}
	// Settled conversions and bank refreshes reshape automatic visibility
	// in the same write, including pending-to-posted transitions and
	// backdated late inserts, which qualify exactly like pre-existing rows.
	return refreshVisibilityForTransactionTx(tx, id)
}

func checkBankTransaction(transaction types.Transaction) error {
	if transaction.Source == "" || transaction.Source == SourceUser {
		return fmt.Errorf("bank rows must carry a non-user source")
	}
	if _, ok := mirrorAccount(transaction); !ok {
		return fmt.Errorf("bank rows must touch a model account")
	}
	return nil
}

// mirrorAccount returns the single model account a bank-mirrored transaction
// touches: the source account for outflows, the first destination for
// inflows. Bank rows never carry both.
func mirrorAccount(transaction types.Transaction) (string, bool) {
	if transaction.SourceAccountID != nil {
		return *transaction.SourceAccountID, true
	}
	if len(transaction.Destinations) > 0 {
		return transaction.Destinations[0], true
	}
	return "", false
}

// applyBankDirectives executes reconciled bank writes in the caller's
// transaction. Counters classify by before/after state, never by provider
// behavior: inserts split on the carried lifecycle flag, updates count as
// refreshes, conversions and void flips count on actual change.
func applyBankDirectives(tx *userTx, directives []BankDirective, summary *SyncApplySummary) error {
	position, err := nextTablePosition(tx, "transactions")
	if err != nil {
		return err
	}
	var nextOrder int64
	if err := tx.QueryRow(`SELECT COALESCE(MAX(execution_order), 0) FROM transaction_sim WHERE user_id = :user_id`).Scan(&nextOrder); err != nil {
		return fmt.Errorf("read max execution order: %w", err)
	}
	nextOrder++
	byKey, err := batchResolveBankKeys(tx, directives)
	if err != nil {
		return err
	}
	for _, directive := range directives {
		switch {
		case directive.Observe != nil:
			if err := observeBankTransaction(tx, directive.Observe); err != nil {
				return err
			}
		case directive.Void != "":
			// A voided authorization stops participating: translation
			// stores pending/void rows disabled, so the transition
			// clears Enabled alongside the lifecycle flags. Core flags
			// land in transactions, enabled in the sim satellite, in the
			// same transaction; the sim flip runs only when a pending
			// row actually transitioned. The visibility reference is
			// deliberately retained (lazy cleanup): every shared read
			// re-checks void at read time, so the retained row can never
			// serve a withdrawn transaction.
			result, err := tx.Exec(`UPDATE transactions SET pending = 0, void = 1 WHERE id = ? AND source != ? AND pending = 1 AND user_id = :user_id`, directive.Void, SourceUser)
			if err != nil {
				return err
			}
			count, err := result.RowsAffected()
			if err != nil {
				return err
			}
			if count == 1 {
				if _, err := tx.Exec(`UPDATE transaction_sim SET enabled = 0 WHERE transaction_id = ? AND user_id = :user_id`, directive.Void); err != nil {
					return err
				}
				summary.PendingDeleted++
			}
		case directive.Convert != nil:
			conversion := directive.Convert
			if conversion.ID == "" {
				return fmt.Errorf("bank conversion requires a transaction ID")
			}
			if err := checkBankTransaction(conversion.Transaction); err != nil {
				return err
			}
			var present int
			err := tx.QueryRow(`SELECT 1 FROM transactions WHERE id = ? AND user_id = :user_id`, conversion.ID).Scan(&present)
			if err == sql.ErrNoRows {
				// The row was removed after the snapshot loaded: the
				// values have nowhere to land, and the removal stands.
				continue
			}
			if err != nil {
				return err
			}
			if err := writeBankValues(tx, conversion.ID, conversion.Transaction); err != nil {
				return err
			}
			if _, err := tx.Exec(`DELETE FROM transaction_sync_keys WHERE transaction_id = ? AND user_id = :user_id`, conversion.ID); err != nil {
				return err
			}
			if err := recordBankKeys(tx, conversion.ID, conversion.AddKeys); err != nil {
				return err
			}
			if conversion.Facts != nil {
				if err := observeBankTransaction(tx, &BankObservation{Keys: conversion.AddKeys, Facts: *conversion.Facts}); err != nil {
					return err
				}
			}
			summary.SettledConverted++
		case directive.Upsert != nil:
			upsert := directive.Upsert
			if err := checkBankTransaction(upsert.Transaction); err != nil {
				return err
			}
			if len(upsert.Keys) == 0 {
				return fmt.Errorf("bank upsert requires at least one key")
			}
			transactionID, err := resolveBankKeysFromMap(upsert.Keys, byKey)
			if err != nil {
				return err
			}
			transaction := upsert.Transaction
			if transactionID == "" {
				// The adapter carries the resolved participation state
				// (settled on, pending off); the store never overrides it.
				// Execution order always allocates fresh from the batch
				// counter, ignoring any carried value.
				transaction.ExecutionOrder = nextOrder
				nextOrder++
				transaction.ID, err = newRowID()
				if err != nil {
					return err
				}
				if err := claimRowID(tx, transaction.ID, "transaction"); err != nil {
					return err
				}
				if err := insertTransaction(tx, position, &transaction, transaction.Source); err != nil {
					return err
				}
				if err := recordBankKeys(tx, transaction.ID, upsert.Keys); err != nil {
					return err
				}
				if upsert.Facts != nil {
					if err := observeBankTransaction(tx, &BankObservation{Keys: upsert.Keys, Facts: *upsert.Facts}); err != nil {
						return err
					}
				}
				position++
				if transaction.Pending {
					summary.PendingInserted++
				} else {
					summary.SettledInserted++
				}
				continue
			}
			transaction.ID = transactionID
			if err := writeBankValues(tx, transaction.ID, transaction); err != nil {
				return err
			}
			if upsert.Facts != nil {
				if err := observeBankTransaction(tx, &BankObservation{Keys: upsert.Keys, Facts: *upsert.Facts}); err != nil {
					return err
				}
			}
			summary.PendingUpdated++
		default:
			return fmt.Errorf("bank directive sets no action")
		}
	}
	return nil
}
