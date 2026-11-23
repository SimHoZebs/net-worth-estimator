package sqlite

import (
	"database/sql"
	"encoding/json"
	"fmt"
	"strings"

	"github.com/simhozebs/net-worth-estimator/backend/internal/store"
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

// AnalysisInputRevision reports the current analysis input revision without
// loading any findings, so Prepare can skip heavy loads on idle ticks.
func (s *sqliteStore) AnalysisInputRevision() (int64, error) {
	var revision int64
	err := s.db.QueryRow(`SELECT revision FROM analysis_inputs WHERE user_id = :user_id`).Scan(&revision)
	if err == sql.ErrNoRows {
		return 0, nil
	}
	return revision, err
}

func loadAnalysisSnapshot(tx *userTx, revision int64) (types.AnalysisSnapshot, error) {
	result := types.AnalysisSnapshot{Revision: revision, UserID: tx.userID, Transactions: []types.AnalysisTransaction{}}
	rows, err := tx.Query(`SELECT p.id, k.bridge_account_id, k.provider, p.pending, p.void, f.facts_json
		FROM transaction_source_facts f JOIN transactions p ON p.user_id = f.user_id AND p.id = f.transaction_id
		JOIN transaction_sync_keys k ON k.user_id = p.user_id AND k.transaction_id = p.id
		WHERE f.user_id = :user_id ORDER BY p.id`)
	if err != nil {
		return result, err
	}
	bridges := map[string]bool{}
	extraTypes := map[string]string{}
	for rows.Next() {
		var item types.AnalysisTransaction
		var raw string
		if err := rows.Scan(&item.TransactionID, &item.AccountID, &item.SourceProvider, &item.Pending, &item.Void, &raw); err != nil {
			rows.Close()
			return result, err
		}
		if err := json.Unmarshal([]byte(raw), &item.Facts); err != nil {
			rows.Close()
			return result, fmt.Errorf("decode transaction evidence: %w", err)
		}
		if item.AccountID != "" {
			bridges[item.AccountID] = true
			if hint := strings.TrimSpace(item.Facts.Metadata["account_type"]); hint != "" {
				extraTypes[item.AccountID] = hint
			}
		}
		result.Transactions = append(result.Transactions, item)
	}
	rowErr := rows.Err()
	rows.Close()
	if rowErr != nil {
		return result, rowErr
	}
	accounts, err := loadAnalysisAccounts(tx, bridges, extraTypes)
	if err != nil {
		return result, err
	}
	result.Accounts = accounts
	return result, nil
}

// loadAnalysisAccounts collects account-level evidence for the bridge accounts
// that own the snapshot's transactions. It reads the existing account link,
// account, and checkpoint tables; it introduces no analysis-owned storage. The
// bridge type hint rides on the already allowlisted transaction fact metadata.
func loadAnalysisAccounts(tx *userTx, bridges map[string]bool, extraTypes map[string]string) ([]types.AnalysisAccount, error) {
	result := []types.AnalysisAccount{}
	if len(bridges) == 0 {
		return result, nil
	}
	rows, err := tx.Query(`SELECT l.bridge_account_id, l.model_account_id, l.bridge_name, l.institution, COALESCE(a.kind, '')
		FROM account_links l LEFT JOIN accounts a ON a.user_id = l.user_id AND a.id = l.model_account_id
		WHERE l.user_id = :user_id ORDER BY l.bridge_account_id`)
	if err != nil {
		return result, err
	}
	for rows.Next() {
		var account types.AnalysisAccount
		if err := rows.Scan(&account.AccountID, &account.LinkedID, &account.Name, &account.Institution, &account.Kind); err != nil {
			rows.Close()
			return result, err
		}
		if !bridges[account.AccountID] {
			continue
		}
		account.ExtraType = extraTypes[account.AccountID]
		result = append(result, account)
	}
	rowErr := rows.Err()
	rows.Close()
	if rowErr != nil {
		return result, rowErr
	}
	// A negative posted balance paired with a positive available balance is
	// the bridge's credit-card shape: an amount owed with remaining credit.
	debtRows, err := tx.Query(`SELECT DISTINCT l.bridge_account_id FROM checkpoints c
		JOIN account_links l ON l.user_id = c.user_id AND l.model_account_id = c.model_account_id
		JOIN checkpoint_available_balances b ON b.user_id = c.user_id AND b.model_account_id = c.model_account_id AND b.observed_at = c.observed_at
		WHERE c.user_id = :user_id AND c.source = '` + store.SourceBankSync + `' AND c.balance < 0 AND b.available_balance > 0`)
	if err != nil {
		return result, err
	}
	debtLike := map[string]bool{}
	for debtRows.Next() {
		var bridgeID string
		if err := debtRows.Scan(&bridgeID); err != nil {
			debtRows.Close()
			return result, err
		}
		debtLike[bridgeID] = true
	}
	debtErr := debtRows.Err()
	debtRows.Close()
	if debtErr != nil {
		return result, debtErr
	}
	for i := range result {
		result[i].DebtLike = debtLike[result[i].AccountID]
	}
	return result, nil
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
