package sqlite

import (
	"database/sql"
	"fmt"
	"strconv"

	"github.com/simhozebs/net-worth-estimator/backend/internal/types"
)

// syncCheckpointKey identifies an owner/sync checkpoint row for re-merge:
// the account and exact observation instant.
func syncCheckpointKey(accountID string, observedAt int64) string {
	return accountID + "\x00" + strconv.FormatInt(observedAt, 10)
}

// nextTablePosition returns MAX(position)+1 for a position-ordered table, or
// 0 when empty. One position-management helper shared by the sync apply and
// model re-merge paths.
func nextTablePosition(tx *userTx, table string) (int, error) {
	var maxPosition sql.NullInt64
	if err := tx.QueryRow(`SELECT MAX(position) FROM ` + table + ` WHERE user_id = :user_id`).Scan(&maxPosition); err != nil {
		return 0, fmt.Errorf("next %s position: %w", table, err)
	}
	if maxPosition.Valid {
		return int(maxPosition.Int64) + 1, nil
	}
	return 0, nil
}

// remergeCheckpoints writes owner checkpoints then re-merges sync-owned rows.
// Incoming owner checkpoints win key collisions, so owners always keep an
// override path. The key carries the exact instant: several observations
// per account/day survive, and an owner row wins only at its own instant.
func remergeCheckpoints(tx *userTx, incoming []types.Checkpoint, synced []types.Checkpoint, startPosition int) (int, error) {
	incomingKeys := make(map[string]struct{}, len(incoming))
	for _, checkpoint := range incoming {
		incomingKeys[syncCheckpointKey(checkpoint.AccountID, checkpoint.ObservedAt)] = struct{}{}
	}
	syncedByKey := make(map[string]types.Checkpoint, len(synced))
	for _, checkpoint := range synced {
		syncedByKey[syncCheckpointKey(checkpoint.AccountID, checkpoint.ObservedAt)] = checkpoint
	}
	position := startPosition
	untouchedSyncKeys := make(map[string]struct{})
	for _, checkpoint := range incoming {
		key := syncCheckpointKey(checkpoint.AccountID, checkpoint.ObservedAt)
		if synced, ok := syncedByKey[key]; ok && synced.Balance == checkpoint.Balance {
			// Byte-identical round-trip of a sync row: leave it sync-owned.
			untouchedSyncKeys[key] = struct{}{}
			continue
		}
		if _, err := tx.Exec(
			`INSERT INTO checkpoints (position, model_account_id, balance, source, observed_at, user_id, id) VALUES (?,?,?,?,?, :user_id, (SELECT COALESCE(MAX(id), 0) + 1 FROM checkpoints WHERE user_id = :user_id))`,
			position, checkpoint.AccountID, checkpoint.Balance, SourceUser, checkpoint.ObservedAt,
		); err != nil {
			return 0, fmt.Errorf("insert checkpoint: %w", err)
		}
		position++
	}
	for _, checkpoint := range synced {
		key := syncCheckpointKey(checkpoint.AccountID, checkpoint.ObservedAt)
		if _, present := incomingKeys[key]; present {
			if _, untouched := untouchedSyncKeys[key]; !untouched {
				continue
			}
		}
		if _, err := tx.Exec(
			`INSERT INTO checkpoints (position, model_account_id, balance, source, observed_at, user_id, id) VALUES (?,?,?,?,?, :user_id, (SELECT COALESCE(MAX(id), 0) + 1 FROM checkpoints WHERE user_id = :user_id))`,
			position, checkpoint.AccountID, checkpoint.Balance, syncedSource(checkpoint.Source), checkpoint.ObservedAt,
		); err != nil {
			return 0, fmt.Errorf("re-merge synced checkpoint: %w", err)
		}
		position++
	}
	return position, nil
}

// remergePostings writes owner postings, then restores authoritative sync rows.
func remergePostings(tx *userTx, incoming []types.Posting, synced []types.Posting, startPosition int) (int, error) {
	position := startPosition
	syncedIDs := make(map[string]bool, len(synced))
	for _, posting := range synced {
		syncedIDs[posting.ID] = true
	}
	for i := range incoming {
		if syncedIDs[incoming[i].ID] {
			continue
		}
		if err := insertPosting(tx, position, &incoming[i], SourceUser); err != nil {
			return 0, err
		}
		position++
	}
	for i := range synced {
		if err := insertPosting(tx, position, &synced[i], syncedSource(synced[i].Source)); err != nil {
			return 0, fmt.Errorf("re-merge synced posting: %w", err)
		}
		position++
	}
	return position, nil
}

func loadSyncedCheckpoints(tx *userTx) ([]types.Checkpoint, error) {
	// Any non-model source is sync-owned. Sources stay per-provider
	// (simplefin, plaid, ...) so metrics and debugging can tell bank-data
	// origins apart; the lifecycle treats them uniformly.
	rows, err := tx.Query(`SELECT model_account_id, balance, source, observed_at FROM checkpoints WHERE source != ? AND user_id = :user_id ORDER BY position`, SourceUser)
	if err != nil {
		return nil, err
	}
	defer rows.Close()
	var checkpoints []types.Checkpoint
	for rows.Next() {
		var checkpoint types.Checkpoint
		if err := rows.Scan(&checkpoint.AccountID, &checkpoint.Balance, &checkpoint.Source, &checkpoint.ObservedAt); err != nil {
			return nil, err
		}
		checkpoints = append(checkpoints, checkpoint)
	}
	if err := rows.Err(); err != nil {
		return nil, err
	}
	return checkpoints, rows.Close()
}

func loadSyncedPostings(tx *userTx) ([]types.Posting, error) {
	rows, err := tx.Query(`SELECT id, name, source_account_id, destinations, amount_resolution_json, posted_time, transaction_time, fulfills_rule_id, fulfills_occurrence_date, enabled, source, pending, void, execution_order FROM postings WHERE source != ? AND user_id = :user_id ORDER BY position`, SourceUser)
	if err != nil {
		return nil, err
	}
	defer rows.Close()
	var postings []types.Posting
	for rows.Next() {
		posting, err := scanPostingRow(rows)
		if err != nil {
			return nil, err
		}
		postings = append(postings, posting)
	}
	if err := rows.Err(); err != nil {
		return nil, err
	}
	return postings, rows.Close()
}

// syncedSource preserves a sync row's provider source on re-merge,
// defaulting blank sources to the current provider.
func syncedSource(source string) string {
	if source == "" {
		return SourceSimpleFIN
	}
	return source
}

// GetLastSyncTime reports the last successful sync completion time, or ""
// when no sync has completed (fresh or cleared database).
func (s *sqliteStore) GetLastSyncTime() (string, error) {
	var value string
	if err := s.db.QueryRow(`SELECT last_sync_at FROM sync_state WHERE id = 1 AND user_id = :user_id`).Scan(&value); err != nil {
		if err == sql.ErrNoRows {
			return "", nil
		}
		return "", fmt.Errorf("read last sync time: %w", err)
	}
	return value, nil
}

// SetLastSyncTime records a successful sync completion time.
func (s *sqliteStore) SetLastSyncTime(completedAt string) error {
	if _, err := s.db.Exec(`INSERT INTO sync_state (id, last_sync_at, user_id) VALUES (1, ?, :user_id)
		ON CONFLICT(user_id, id) DO UPDATE SET last_sync_at = excluded.last_sync_at`, completedAt); err != nil {
		return fmt.Errorf("record last sync time: %w", err)
	}
	return nil
}

// ProvisionSyncAccounts resolves every seen bridge account to a model
// account in one transaction: existing links get a snapshot touch,
// and unknown accounts get a provisioned account plus an auto link.
// A link whose model account no longer exists resolves to nothing and
// is reported stale: no checkpoints are written for it, nothing is
// auto-recreated, and the link stays for relinking.
func (s *sqliteStore) ProvisionSyncAccounts(items []SyncProvision) (map[string]string, int, []string, error) {
	resolved := map[string]string{}
	var stale []string
	provisioned := 0
	tx, err := s.db.Begin()
	if err != nil {
		return nil, 0, nil, fmt.Errorf("provision begin: %w", err)
	}
	defer tx.Rollback()
	for _, item := range items {
		var modelAccountID string
		if err := tx.QueryRow(`SELECT model_account_id FROM account_links WHERE bridge_account_id = ? AND user_id = :user_id`, item.BridgeID).Scan(&modelAccountID); err == nil {
			exists, err := accountExists(tx, modelAccountID)
			if err != nil {
				return nil, 0, nil, err
			}
			if !exists {
				stale = append(stale, item.BridgeID)
				continue
			}
			if err := TouchAccountLink(tx, item.BridgeID, item.Name, item.Currency); err != nil {
				return nil, 0, nil, err
			}
			resolved[item.BridgeID] = modelAccountID
			continue
		} else if err != sql.ErrNoRows {
			return nil, 0, nil, fmt.Errorf("read account link %s: %w", item.BridgeID, err)
		}
		modelAccountID, created, err := EnsureLinkedAccount(tx, item.BridgeID, item.Name, item.Currency, item.Kind)
		if err != nil {
			return nil, 0, nil, err
		}
		if created {
			provisioned++
		}
		resolved[item.BridgeID] = modelAccountID
	}
	if err := tx.Commit(); err != nil {
		return nil, 0, nil, fmt.Errorf("provision commit: %w", err)
	}
	return resolved, provisioned, stale, nil
}

// ApplySyncPlan upserts sync checkpoints and applies reconciled bank
// directives in one transaction. Owner rows always win key conflicts. The
// directives carry fully resolved lifecycle state; the store verifies
// structural validity (keys present, non-user source, row existence) but
// never interprets provider behavior. Backdated observations are retained
// as distinct instant-keyed rows: chronological replay orders them and the
// latest instant still wins, so a late arrival never rolls current state
// back. A same-instant sync row replaces idempotently; an owner row at the
// same instant keeps precedence.
func (s *sqliteStore) ApplySyncPlan(checkpoints []SyncCheckpoint, directives []BankDirective) (SyncApplySummary, error) {
	var summary SyncApplySummary
	tx, err := s.db.Begin()
	if err != nil {
		return summary, fmt.Errorf("sync begin: %w", err)
	}
	defer tx.Rollback()

	nextPosition, err := nextTablePosition(tx, "checkpoints")
	if err != nil {
		return summary, err
	}
	for _, checkpoint := range checkpoints {
		result, err := tx.Exec(
			`INSERT OR IGNORE INTO checkpoints (position, model_account_id, balance, source, observed_at, user_id, id) VALUES (?,?,?,?,?, :user_id, (SELECT COALESCE(MAX(id), 0) + 1 FROM checkpoints WHERE user_id = :user_id))`,
			nextPosition, checkpoint.AccountID, checkpoint.Balance, SourceSimpleFIN, checkpoint.ObservedAt,
		)
		if err != nil {
			return summary, fmt.Errorf("sync insert checkpoint: %w", err)
		}
		inserted, err := result.RowsAffected()
		if err != nil {
			return summary, fmt.Errorf("sync checkpoint rows: %w", err)
		}
		if inserted > 0 {
			summary.CheckpointsInserted++
			nextPosition++
			continue
		}
		var existingSource string
		var existingBalance float64
		if err := tx.QueryRow(
			`SELECT source, balance FROM checkpoints WHERE model_account_id = ? AND observed_at = ? AND user_id = :user_id`,
			checkpoint.AccountID, checkpoint.ObservedAt,
		).Scan(&existingSource, &existingBalance); err != nil {
			return summary, fmt.Errorf("sync read checkpoint conflict: %w", err)
		}
		if existingSource != SourceSimpleFIN {
			summary.CheckpointsSkipped++
			continue
		}
		if _, err := tx.Exec(
			`UPDATE checkpoints SET balance = ? WHERE model_account_id = ? AND observed_at = ? AND user_id = :user_id`,
			checkpoint.Balance, checkpoint.AccountID, checkpoint.ObservedAt,
		); err != nil {
			return summary, fmt.Errorf("sync update checkpoint: %w", err)
		}
		summary.CheckpointsUpdated++
	}

	if err := applyBankDirectives(tx, directives, &summary); err != nil {
		return summary, err
	}

	if err := tx.Commit(); err != nil {
		return summary, fmt.Errorf("sync commit: %w", err)
	}
	return summary, nil
}
