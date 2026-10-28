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

// BankKey is one exact upstream identity for a bank row. A row can hold
// several across its life (a pending authorization key, then a posted key).
type BankKey struct {
	Provider      string
	AccountID     string
	TransactionID string
}

// BankRow is one stored bank-reported posting with every upstream identity
// pointing at it. Adapters read these to reconcile a snapshot without
// reimplementing storage.
type BankRow struct {
	Posting types.Posting
	Keys    []BankKey
}

// BankDirective is one reconciled bank write. Adapters translate provider
// behavior into these; the store applies them without interpreting how the
// provider represents lifecycle. Exactly one action is set.
type BankDirective struct {
	// Upsert inserts the posting under a new UUID and records Keys, or
	// updates the row those keys already identify.
	Upsert *BankUpsert
	// Convert rewrites the named row with settled values and replaces its
	// keys with AddKeys. The UUID survives.
	Convert *BankConvert
	// Void marks the named row void. It stays visible; nothing is deleted.
	Void string
}

// BankUpsert carries full row values for insert-or-update by key.
type BankUpsert struct {
	Posting types.Posting
	Keys    []BankKey
}

// BankConvert carries settled values for an existing row the adapter
// matched, plus replacement keys. Rotation is total: every key on the row
// is retired in-transaction before AddKeys are recorded, so a key added
// between load and apply cannot survive as a dangling pending key.
type BankConvert struct {
	ID      string
	Posting types.Posting
	AddKeys []BankKey
}

type postingSyncKey struct {
	// provider/accountID/transactionID are the exact upstream identities. An
	// older mapper sanitized transaction keys, so rows written before exact
	// keys cannot recover their originals; they are preserved as-is until the
	// next authoritative snapshot for their accounts replaces that legacy
	// pending set and establishes exact keys.
	provider, accountID, transactionID, postingID string
}

func loadPostingSyncKeys(tx *planTx) ([]postingSyncKey, error) {
	rows, err := tx.Query(`SELECT provider, account_id, transaction_id, posting_id FROM posting_sync_keys WHERE plan_id = :plan_id`)
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

func insertPostingSyncKey(tx *planTx, key postingSyncKey) error {
	_, err := tx.Exec(`INSERT INTO posting_sync_keys (provider, account_id, transaction_id, posting_id, plan_id) VALUES (?, ?, ?, ?, :plan_id)`,
		key.provider, key.accountID, key.transactionID, key.postingID)
	return err
}

// LoadBankPostings returns every bank-reported posting with the upstream
// identities pointing at it. Adapters reconcile snapshots against this.
func (s *sqliteStore) LoadBankPostings() ([]BankRow, error) {
	rows, err := s.db.Query(`SELECT id, name, source_account_id, destinations, amount_resolution_json, posted_time, transaction_time, fulfills_rule_id, fulfills_occurrence_date, enabled, source, pending, void, execution_order FROM postings WHERE source != ? AND plan_id = :plan_id ORDER BY position`, SourceUser)
	if err != nil {
		return nil, err
	}
	defer rows.Close()
	var out []BankRow
	for rows.Next() {
		var row BankRow
		var err error
		row.Posting, err = scanPostingRow(rows)
		if err != nil {
			return nil, err
		}
		out = append(out, row)
	}
	if err := rows.Err(); err != nil {
		return nil, err
	}
	keys, err := s.db.Query(`SELECT provider, account_id, transaction_id, posting_id FROM posting_sync_keys WHERE plan_id = :plan_id`)
	if err != nil {
		return nil, err
	}
	defer keys.Close()
	byPosting := map[string][]BankKey{}
	for keys.Next() {
		var provider, account, transaction, postingID string
		if err := keys.Scan(&provider, &account, &transaction, &postingID); err != nil {
			return nil, err
		}
		byPosting[postingID] = append(byPosting[postingID], BankKey{Provider: provider, AccountID: account, TransactionID: transaction})
	}
	if err := keys.Err(); err != nil {
		return nil, err
	}
	for i := range out {
		out[i].Keys = byPosting[out[i].Posting.ID]
	}
	return out, nil
}

func validBankKey(key BankKey) bool {
	return key.Provider != "" && key.AccountID != "" && key.TransactionID != ""
}

func resolveBankKeys(tx *planTx, keys []BankKey) (string, error) {
	resolved := ""
	for _, key := range keys {
		if !validBankKey(key) {
			return "", fmt.Errorf("bank key requires provider, account, and transaction identities")
		}
		var postingID string
		err := tx.QueryRow(`SELECT posting_id FROM posting_sync_keys WHERE provider = ? AND account_id = ? AND transaction_id = ? AND plan_id = :plan_id`,
			key.Provider, key.AccountID, key.TransactionID).Scan(&postingID)
		if err == sql.ErrNoRows {
			continue
		}
		if err != nil {
			return "", err
		}
		if resolved != "" && resolved != postingID {
			return "", fmt.Errorf("bank keys identify different postings")
		}
		resolved = postingID
	}
	return resolved, nil
}

func recordBankKeys(tx *planTx, postingID string, keys []BankKey) error {
	for _, key := range keys {
		if !validBankKey(key) {
			return fmt.Errorf("bank key requires provider, account, and transaction identities")
		}
		if err := insertPostingSyncKey(tx, postingSyncKey{provider: key.Provider, accountID: key.AccountID, transactionID: key.TransactionID, postingID: postingID}); err != nil {
			return err
		}
	}
	return nil
}

func writeBankValues(tx *planTx, id string, posting types.Posting) error {
	amount, err := json.Marshal(posting.Amount)
	if err != nil {
		return err
	}
	destinations, err := json.Marshal(posting.Destinations)
	if err != nil {
		return err
	}
	result, err := tx.Exec(`UPDATE postings SET name = ?, source_account_id = ?, destinations = ?, amount_resolution_json = ?, posted_time = ?, transaction_time = ?, pending = ?, void = ? WHERE id = ? AND source != ? AND plan_id = :plan_id`,
		posting.Name, nullable(posting.SourceAccountID), string(destinations), string(amount), posting.PostedTime, posting.TransactionTime, boolToInt(posting.Pending), boolToInt(posting.Void), id, SourceUser)
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
	return nil
}

func checkBankPosting(posting types.Posting) error {
	if posting.Source == "" || posting.Source == SourceUser {
		return fmt.Errorf("bank rows must carry a non-user source")
	}
	if _, ok := mirrorAccount(posting); !ok {
		return fmt.Errorf("bank rows must touch a model account")
	}
	return nil
}

// mirrorAccount returns the single model account a bank-mirrored posting
// touches: the source account for outflows, the first destination for
// inflows. Bank rows never carry both.
func mirrorAccount(posting types.Posting) (string, bool) {
	if posting.SourceAccountID != nil {
		return *posting.SourceAccountID, true
	}
	if len(posting.Destinations) > 0 {
		return posting.Destinations[0], true
	}
	return "", false
}

// applyBankDirectives executes reconciled bank writes in the caller's
// transaction. Counters classify by before/after state, never by provider
// behavior: inserts split on the carried lifecycle flag, updates count as
// refreshes, conversions and void flips count on actual change.
func applyBankDirectives(tx *planTx, directives []BankDirective, summary *SyncApplySummary) error {
	position, err := nextTablePosition(tx, "postings")
	if err != nil {
		return err
	}
	for _, directive := range directives {
		switch {
		case directive.Void != "":
			result, err := tx.Exec(`UPDATE postings SET pending = 0, void = 1 WHERE id = ? AND source != ? AND pending = 1 AND plan_id = :plan_id`, directive.Void, SourceUser)
			if err != nil {
				return err
			}
			count, err := result.RowsAffected()
			if err != nil {
				return err
			}
			if count == 1 {
				summary.PendingDeleted++
			}
		case directive.Convert != nil:
			conversion := directive.Convert
			if conversion.ID == "" {
				return fmt.Errorf("bank conversion requires a posting ID")
			}
			if err := checkBankPosting(conversion.Posting); err != nil {
				return err
			}
			if err := writeBankValues(tx, conversion.ID, conversion.Posting); err != nil {
				return err
			}
			if _, err := tx.Exec(`DELETE FROM posting_sync_keys WHERE posting_id = ? AND plan_id = :plan_id`, conversion.ID); err != nil {
				return err
			}
			if err := recordBankKeys(tx, conversion.ID, conversion.AddKeys); err != nil {
				return err
			}
			summary.SettledConverted++
		case directive.Upsert != nil:
			upsert := directive.Upsert
			if err := checkBankPosting(upsert.Posting); err != nil {
				return err
			}
			if len(upsert.Keys) == 0 {
				return fmt.Errorf("bank upsert requires at least one key")
			}
			postingID, err := resolveBankKeys(tx, upsert.Keys)
			if err != nil {
				return err
			}
			posting := upsert.Posting
			if postingID == "" {
				posting.Enabled = false
				posting.ExecutionOrder = 0
				posting.ID, err = newRowID()
				if err != nil {
					return err
				}
				if err := claimRowID(tx, posting.ID, "posting"); err != nil {
					return err
				}
				if err := insertPosting(tx, position, &posting, posting.Source); err != nil {
					return err
				}
				if err := recordBankKeys(tx, posting.ID, upsert.Keys); err != nil {
					return err
				}
				position++
				if posting.Pending {
					summary.PendingInserted++
				} else {
					summary.SettledInserted++
				}
				continue
			}
			posting.ID = postingID
			if err := writeBankValues(tx, posting.ID, posting); err != nil {
				return err
			}
			summary.PendingUpdated++
		default:
			return fmt.Errorf("bank directive sets no action")
		}
	}
	return nil
}
