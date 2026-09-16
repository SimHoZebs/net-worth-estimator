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

	var maxPosition sql.NullInt64
	if err := tx.QueryRow(`SELECT MAX(position) FROM checkpoints`).Scan(&maxPosition); err != nil {
		return summary, fmt.Errorf("sync checkpoint position: %w", err)
	}
	nextPosition := 0
	if maxPosition.Valid {
		nextPosition = int(maxPosition.Int64) + 1
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
	var maxPostingPosition sql.NullInt64
	if err := tx.QueryRow(`SELECT MAX(position) FROM postings`).Scan(&maxPostingPosition); err != nil {
		return summary, fmt.Errorf("sync posting position: %w", err)
	}
	nextPostingPosition := 0
	if maxPostingPosition.Valid {
		nextPostingPosition = int(maxPostingPosition.Int64) + 1
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
