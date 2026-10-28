package store

import (
	"database/sql"
	"encoding/json"
	"fmt"
	"math"
	"strconv"
	"strings"

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

func applyPendingSnapshot(tx *planTx, incoming []SyncPosting, settled []SyncPosting, accounts []string, summary *SyncApplySummary) error {
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
		err := tx.QueryRow(`SELECT posting_id FROM posting_sync_keys WHERE provider = ? AND account_id = ? AND transaction_id = ? AND plan_id = :plan_id`,
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
	used := map[int]bool{}
	for _, accountID := range accounts {
		rows, err := tx.Query(`SELECT id FROM postings WHERE source = ? AND source_account_id = ? AND plan_id = :plan_id`, SourceSimpleFIN, accountID)
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
			converted, err := convertSettledPosting(tx, id, settled, used, summary)
			if err != nil {
				return err
			}
			if converted {
				continue
			}
			stillPending, err := voidPendingPosting(tx, id)
			if err != nil {
				return err
			}
			if stillPending {
				summary.PendingDeleted++
			}
		}
	}
	return insertSettledPostings(tx, settled, used, summary)
}

// insertSettledPostings materializes posted charges that matched no vanished
// pending row as new disabled owner rows. Provider keys make repeat feeds
// idempotent. A candidate matching a still-present pending row is skipped:
// it converts when that row vanishes instead of duplicating it now.
func insertSettledPostings(tx *planTx, settled []SyncPosting, used map[int]bool, summary *SyncApplySummary) error {
	position, err := nextTablePosition(tx, "postings")
	if err != nil {
		return err
	}
	present, err := loadSyncedPostings(tx)
	if err != nil {
		return err
	}
	for i, item := range settled {
		if used[i] {
			continue
		}
		if item.ProviderAccountID == "" || item.TransactionID == "" || item.SourceAccountID == nil {
			return fmt.Errorf("settled sync posting requires exact provider account and transaction identities plus a model account")
		}
		key := postingSyncKey{provider: SourceSimpleFIN, accountID: item.ProviderAccountID, transactionID: item.TransactionID}
		var existing string
		err := tx.QueryRow(`SELECT posting_id FROM posting_sync_keys WHERE provider = ? AND account_id = ? AND transaction_id = ? AND plan_id = :plan_id`,
			key.provider, key.accountID, key.transactionID).Scan(&existing)
		if err == nil {
			continue
		}
		if err != sql.ErrNoRows {
			return err
		}
		deferred := false
		for _, pending := range present {
			if settleMatch(pending, item) {
				deferred = true
				break
			}
		}
		if deferred {
			continue
		}
		posting := item.Posting
		posting.Source = SourceModel
		posting.Pending = false
		posting.Enabled = false
		posting.ExecutionOrder = 0
		posting.ID, err = newRowID()
		if err != nil {
			return err
		}
		if err := claimRowID(tx, posting.ID, "posting"); err != nil {
			return err
		}
		if err := insertPosting(tx, position, &posting, SourceModel); err != nil {
			return err
		}
		key.postingID = posting.ID
		if err := insertPostingSyncKey(tx, key); err != nil {
			return err
		}
		position++
		summary.SettledInserted++
	}
	return nil
}

// settleMatchWindowSeconds bounds pending-to-settled matching: charges
// usually finalize within days, and a wider window risks joining two
// distinct same-merchant charges.
const settleMatchWindowSeconds = 7 * 24 * 3600

func postingAmountCents(posting types.Posting) (int64, bool) {
	if posting.Amount.Resolver != "expression" {
		return 0, false
	}
	raw, ok := posting.Amount.Config["expression"].(string)
	if !ok {
		return 0, false
	}
	value, err := strconv.ParseFloat(strings.TrimSpace(raw), 64)
	if err != nil || math.IsNaN(value) || math.IsInf(value, 0) {
		return 0, false
	}
	return int64(math.Round(value * 100)), true
}

func settleMatch(stale types.Posting, candidate SyncPosting) bool {
	staleAccount, ok := mirrorAccount(stale)
	if !ok {
		return false
	}
	candidateAccount, ok := mirrorAccount(candidate.Posting)
	if !ok || staleAccount != candidateAccount {
		return false
	}
	staleCents, ok := postingAmountCents(stale)
	if !ok {
		return false
	}
	candidateCents, ok := postingAmountCents(candidate.Posting)
	if !ok || staleCents != candidateCents {
		return false
	}
	gap := candidate.TransactionTime - stale.TransactionTime
	if gap < -settleMatchWindowSeconds || gap > settleMatchWindowSeconds {
		return false
	}
	a, b := strings.ToUpper(strings.TrimSpace(candidate.Name)), strings.ToUpper(strings.TrimSpace(stale.Name))
	return strings.Contains(a, b) || strings.Contains(b, a)
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

// convertSettledPosting converts one vanished bank row (pending or void)
// into a settled owner row when exactly one settled candidate strictly
// matches it. The UUID
// survives, so any future evidence stays linked; the row becomes owner-owned
// and projection-disabled pending the owner's review. It reports whether a
// conversion happened; otherwise the caller deletes the row.
func convertSettledPosting(tx *planTx, id string, settled []SyncPosting, used map[int]bool, summary *SyncApplySummary) (bool, error) {
	rows, err := tx.Query(`SELECT id, name, source_account_id, destinations, amount_resolution_json, posted_time, transaction_time, fulfills_rule_id, fulfills_occurrence_date, enabled, source, pending, execution_order FROM postings WHERE id = ? AND plan_id = :plan_id`, id)
	if err != nil {
		return false, err
	}
	defer rows.Close()
	if !rows.Next() {
		return false, rows.Err()
	}
	stale, err := scanPostingRow(rows)
	if err != nil {
		return false, err
	}
	match := -1
	for i, candidate := range settled {
		if used[i] || !settleMatch(stale, candidate) {
			continue
		}
		if match != -1 {
			return false, nil
		}
		match = i
	}
	if match == -1 {
		return false, nil
	}
	used[match] = true
	candidate := settled[match]
	amount, err := json.Marshal(candidate.Amount)
	if err != nil {
		return false, fmt.Errorf("marshal settled amount %s: %w", id, err)
	}
	result, err := tx.Exec(`UPDATE postings SET name = ?, amount_resolution_json = ?, posted_time = ?, transaction_time = ?, source = ?, pending = 0, enabled = 0 WHERE id = ? AND source = ? AND plan_id = :plan_id`,
		candidate.Name, string(amount), candidate.PostedTime, candidate.TransactionTime, SourceModel, id, SourceSimpleFIN)
	if err != nil {
		return false, err
	}
	count, err := result.RowsAffected()
	if err != nil {
		return false, err
	}
	if count != 1 {
		return false, fmt.Errorf("settled conversion missed its pending row")
	}
	if _, err := tx.Exec(`DELETE FROM posting_sync_keys WHERE posting_id = ? AND plan_id = :plan_id`, id); err != nil {
		return false, err
	}
	summary.SettledConverted++
	return true, nil
}

func updatePendingPosting(tx *planTx, posting types.Posting) error {
	amount, err := json.Marshal(posting.Amount)
	if err != nil {
		return err
	}
	destinations, err := json.Marshal(posting.Destinations)
	if err != nil {
		return err
	}
	result, err := tx.Exec(`UPDATE postings SET name = ?, source_account_id = ?, destinations = ?, amount_resolution_json = ?, posted_time = ?, transaction_time = ?, enabled = 0, pending = 1 WHERE id = ? AND source = ? AND plan_id = :plan_id`,
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

// voidPendingPosting retires a bank-vanished pending row to void without
// deleting it: the authorization is gone but the record stays visible. It
// reports whether the row was still pending; already-void rows are a no-op
// so repeat feeds cause no churn. The sync key survives, so a reappearing
// authorization heals the row back to pending through the normal update
// path, and a posted match can still convert it to settled.
func voidPendingPosting(tx *planTx, id string) (bool, error) {
	result, err := tx.Exec(`UPDATE postings SET pending = 0 WHERE id = ? AND source = ? AND pending = 1 AND plan_id = :plan_id`, id, SourceSimpleFIN)
	if err != nil {
		return false, err
	}
	count, err := result.RowsAffected()
	if err != nil {
		return false, err
	}
	return count == 1, nil
}
