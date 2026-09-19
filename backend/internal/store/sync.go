package store

import (
	"database/sql"
	"fmt"
	"strings"

	"github.com/simhozebs/net-worth-estimator/backend/internal/types"
)

// Row ownership for SimpleFIN sync coexistence. "model" rows are
// owner/seed content; "simplefin" rows are system-owned sync output managed
// only by the sync (PUT payloads cannot create, edit, or delete them).
const (
	SourceModel     = "model"
	SourceSimpleFIN = "simplefin"
)

// SyncPostingPrefix reserves posting IDs for sync-owned rows. Owner payloads
// carrying it are dropped on save; validation never sees them.
const SyncPostingPrefix = "sfin-"

// IsSyncPostingID reports whether an ID belongs to the sync namespace.
func IsSyncPostingID(id string) bool {
	return strings.HasPrefix(id, SyncPostingPrefix)
}

// syncCheckpointKey identifies an owner/sync checkpoint row for re-merge.
func syncCheckpointKey(accountID, date string) string {
	return accountID + "\x00" + date
}

// nextTablePosition returns MAX(position)+1 for a position-ordered table, or
// 0 when empty. One position-management helper shared by the sync apply and
// document re-merge paths.
func nextTablePosition(tx *sql.Tx, table string) (int, error) {
	var maxPosition sql.NullInt64
	if err := tx.QueryRow(`SELECT MAX(position) FROM ` + table).Scan(&maxPosition); err != nil {
		return 0, fmt.Errorf("next %s position: %w", table, err)
	}
	if maxPosition.Valid {
		return int(maxPosition.Int64) + 1, nil
	}
	return 0, nil
}

// remergeCheckpoints writes owner checkpoints then re-merges sync-owned rows.
// Incoming owner checkpoints win key collisions, so owners always keep an
// override path. Returns the next free position.
func remergeCheckpoints(tx *sql.Tx, incoming []types.Checkpoint, synced []types.Checkpoint, startPosition int) (int, error) {
	incomingKeys := make(map[string]struct{}, len(incoming))
	for _, checkpoint := range incoming {
		incomingKeys[syncCheckpointKey(checkpoint.AccountID, checkpoint.Date)] = struct{}{}
	}
	syncedByKey := make(map[string]types.Checkpoint, len(synced))
	for _, checkpoint := range synced {
		syncedByKey[syncCheckpointKey(checkpoint.AccountID, checkpoint.Date)] = checkpoint
	}
	position := startPosition
	untouchedSyncKeys := make(map[string]struct{})
	for _, checkpoint := range incoming {
		key := syncCheckpointKey(checkpoint.AccountID, checkpoint.Date)
		if synced, ok := syncedByKey[key]; ok && synced.Balance == checkpoint.Balance {
			// Byte-identical round-trip of a sync row: leave it sync-owned.
			untouchedSyncKeys[key] = struct{}{}
			continue
		}
		if _, err := tx.Exec(
			`INSERT INTO checkpoints (position, date, account_id, balance, source) VALUES (?,?,?,?,?)`,
			position, checkpoint.Date, checkpoint.AccountID, checkpoint.Balance, SourceModel,
		); err != nil {
			return 0, fmt.Errorf("insert checkpoint: %w", err)
		}
		position++
	}
	for _, checkpoint := range synced {
		key := syncCheckpointKey(checkpoint.AccountID, checkpoint.Date)
		if _, present := incomingKeys[key]; present {
			if _, untouched := untouchedSyncKeys[key]; !untouched {
				continue
			}
		}
		if _, err := tx.Exec(
			`INSERT INTO checkpoints (position, date, account_id, balance, source) VALUES (?,?,?,?,?)`,
			position, checkpoint.Date, checkpoint.AccountID, checkpoint.Balance, SourceSimpleFIN,
		); err != nil {
			return 0, fmt.Errorf("re-merge synced checkpoint: %w", err)
		}
		position++
	}
	return position, nil
}

// remergePostings writes owner postings (dropping forged sync-namespace IDs)
// then re-merges sync-owned rows. Returns the next free position.
func remergePostings(tx *sql.Tx, incoming []types.Posting, synced []types.Posting, startPosition int) (int, error) {
	position := startPosition
	for i := range incoming {
		if IsSyncPostingID(incoming[i].ID) {
			continue
		}
		if err := insertPosting(tx, position, &incoming[i], SourceModel); err != nil {
			return 0, err
		}
		position++
	}
	for i := range synced {
		if err := insertPosting(tx, position, &synced[i], SourceSimpleFIN); err != nil {
			return 0, fmt.Errorf("re-merge synced posting: %w", err)
		}
		position++
	}
	return position, nil
}

func loadSyncedCheckpoints(tx *sql.Tx) ([]types.Checkpoint, error) {
	rows, err := tx.Query(`SELECT date, account_id, balance, source FROM checkpoints WHERE source = ? ORDER BY position`, SourceSimpleFIN)
	if err != nil {
		return nil, err
	}
	defer rows.Close()
	var checkpoints []types.Checkpoint
	for rows.Next() {
		var checkpoint types.Checkpoint
		if err := rows.Scan(&checkpoint.Date, &checkpoint.AccountID, &checkpoint.Balance, &checkpoint.Source); err != nil {
			return nil, err
		}
		checkpoints = append(checkpoints, checkpoint)
	}
	if err := rows.Err(); err != nil {
		return nil, err
	}
	return checkpoints, rows.Close()
}

func loadSyncedPostings(tx *sql.Tx) ([]types.Posting, error) {
	rows, err := tx.Query(`SELECT id, label, source_account_id, destinations, amount_json, frequency, annual_rate, annual_growth_rate, volatility, start_date, end_date, annual_cap, priority, enabled, source FROM postings WHERE source = ? ORDER BY position`, SourceSimpleFIN)
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

// SyncCheckpoint is a balance observation applied by the sync.
type SyncCheckpoint struct {
	AccountID string
	Date      string
	Balance   float64
}

// SyncApplySummary counts applied sync rows.
type SyncApplySummary struct {
	CheckpointsInserted int  `json:"checkpointsInserted"`
	CheckpointsUpdated  int  `json:"checkpointsUpdated"`
	CheckpointsSkipped  int  `json:"checkpointsSkipped"`
	PendingDeleted      int  `json:"pendingDeleted"`
	PendingInserted     int  `json:"pendingInserted"`
	DryRun              bool `json:"dryRun"`
}

// escapeLike escapes %, _, and the escape character for LIKE patterns.
func escapeLike(value string) string {
	value = strings.ReplaceAll(value, `\`, `\\`)
	value = strings.ReplaceAll(value, `%`, `\%`)
	value = strings.ReplaceAll(value, `_`, `\_`)
	return value
}

// ApplySyncPlan upserts sync checkpoints and refreshes pending seed postings
// in one transaction. Owner rows always win key conflicts. Pending rows are
// snapshot-scoped per card account: existing sync pending rows for the given
// accounts are deleted before the fresh set is inserted. With dryRun the
// transaction rolls back and only counts are returned.
func (s *Store) ApplySyncPlan(checkpoints []SyncCheckpoint, pending []types.Posting, cardAccounts []string, dryRun bool) (SyncApplySummary, error) {
	var summary SyncApplySummary
	summary.DryRun = dryRun
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
			`INSERT OR IGNORE INTO checkpoints (position, date, account_id, balance, source) VALUES (?,?,?,?,?)`,
			nextPosition, checkpoint.Date, checkpoint.AccountID, checkpoint.Balance, SourceSimpleFIN,
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
			`SELECT source, balance FROM checkpoints WHERE account_id = ? AND date = ?`,
			checkpoint.AccountID, checkpoint.Date,
		).Scan(&existingSource, &existingBalance); err != nil {
			return summary, fmt.Errorf("sync read checkpoint conflict: %w", err)
		}
		if existingSource != SourceSimpleFIN {
			summary.CheckpointsSkipped++
			continue
		}
		if _, err := tx.Exec(
			`UPDATE checkpoints SET balance = ? WHERE account_id = ? AND date = ?`,
			checkpoint.Balance, checkpoint.AccountID, checkpoint.Date,
		); err != nil {
			return summary, fmt.Errorf("sync update checkpoint: %w", err)
		}
		summary.CheckpointsUpdated++
	}

	pendingPrefix := SyncPostingPrefix + "pending-"
	for _, accountID := range cardAccounts {
		pattern := pendingPrefix + escapeLike(accountID) + `-%`
		result, err := tx.Exec(
			`DELETE FROM postings WHERE source = ? AND source_account_id = ? AND id LIKE ? ESCAPE '\'`,
			SourceSimpleFIN, accountID, pattern,
		)
		if err != nil {
			return summary, fmt.Errorf("sync clear pending: %w", err)
		}
		deleted, err := result.RowsAffected()
		if err != nil {
			return summary, fmt.Errorf("sync pending rows: %w", err)
		}
		summary.PendingDeleted += int(deleted)
	}
	nextPostingPosition, err := nextTablePosition(tx, "postings")
	if err != nil {
		return summary, err
	}
	for i := range pending {
		if err := insertPosting(tx, nextPostingPosition, &pending[i], SourceSimpleFIN); err != nil {
			return summary, fmt.Errorf("sync insert pending: %w", err)
		}
		nextPostingPosition++
		summary.PendingInserted++
	}

	if dryRun {
		return summary, nil
	}
	if err := tx.Commit(); err != nil {
		return summary, fmt.Errorf("sync commit: %w", err)
	}
	return summary, nil
}
