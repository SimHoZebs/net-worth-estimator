package store

import (
	"database/sql"
	"fmt"
	"strings"

	"github.com/simhozebs/net-worth-estimator/backend/internal/types"
)

// Row ownership for bank-data sync coexistence. "model" rows are
// owner/seed content; any other source value is system-owned sync output
// managed only by the sync (PUT payloads cannot create, edit, or delete
// them). The exact sync source name is a backend contract; row ownership
// checks match by exclusion (not "model"), never by provider name.
const (
	SourceModel = "model"
	// SourceSimpleFIN is the sync source written by the current SimpleFIN
	// bank-data provider. A future provider (Plaid, MX, CSV import) writes
	// its own source name; all non-"model" sources share the sync-owned
	// lifecycle below.
	SourceSimpleFIN = "simplefin"
)

// SyncPostingPrefix reserves posting IDs for sync-owned rows. Owner payloads
// carrying it are dropped on save; validation never sees them.
const SyncPostingPrefix = "sync-"

// LegacySyncPostingPrefix is the pre-rename sync namespace. Existing
// databases hold rows under it until their next sync refreshes them, so
// reservation checks and pending cleanup accept both prefixes. New sync
// output always uses SyncPostingPrefix.
const LegacySyncPostingPrefix = "sfin-"

// IsSyncPostingID reports whether an ID belongs to the sync namespace,
// including the legacy prefix (see LegacySyncPostingPrefix).
func IsSyncPostingID(id string) bool {
	return strings.HasPrefix(id, SyncPostingPrefix) ||
		strings.HasPrefix(id, LegacySyncPostingPrefix)
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
			position, checkpoint.Date, checkpoint.AccountID, checkpoint.Balance, syncedSource(checkpoint.Source),
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
		if err := insertPosting(tx, position, &synced[i], syncedSource(synced[i].Source)); err != nil {
			return 0, fmt.Errorf("re-merge synced posting: %w", err)
		}
		position++
	}
	return position, nil
}

func loadSyncedCheckpoints(tx *sql.Tx) ([]types.Checkpoint, error) {
	// Any non-model source is sync-owned. Sources stay per-provider
	// (simplefin, plaid, ...) so metrics and debugging can tell bank-data
	// origins apart; the lifecycle treats them uniformly.
	rows, err := tx.Query(`SELECT date, account_id, balance, source FROM checkpoints WHERE source != ? ORDER BY position`, SourceModel)
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
	rows, err := tx.Query(`SELECT id, name, source_account_id, destinations, amount_resolution_json, posted_time, transaction_time, fulfills_rule_id, fulfills_occurrence_date, enabled, source FROM postings WHERE source != ? ORDER BY position`, SourceModel)
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
	if err := s.db.QueryRow(`SELECT last_sync_at FROM sync_state WHERE id = 1`).Scan(&value); err != nil {
		if err == sql.ErrNoRows {
			return "", nil
		}
		return "", fmt.Errorf("read last sync time: %w", err)
	}
	return value, nil
}

// SetLastSyncTime records a successful sync completion time.
func (s *sqliteStore) SetLastSyncTime(completedAt string) error {
	if _, err := s.db.Exec(`INSERT INTO sync_state (id, last_sync_at) VALUES (1, ?)
		ON CONFLICT(id) DO UPDATE SET last_sync_at = excluded.last_sync_at`, completedAt); err != nil {
		return fmt.Errorf("record last sync time: %w", err)
	}
	return nil
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

// SyncProvision is one bridge account needing link resolution: an
// existing link is touched, otherwise the account is auto-provisioned.
// Manual bindings are made through SaveAccountLink, never here.
type SyncProvision struct {
	BridgeID string
	Name     string
	Currency string
	Kind     types.AccountKind
}

// ProvisionSyncAccounts resolves every seen bridge account to a model
// account in one transaction: existing links get a snapshot touch,
// and unknown accounts get a provisioned account plus an auto link.
// A link whose model account no longer exists resolves to nothing and
// is reported stale: no checkpoints are written for it, nothing is
// auto-recreated, and the link stays for relinking. dryRun rolls
// everything back and still returns the resolved map.
func (s *sqliteStore) ProvisionSyncAccounts(items []SyncProvision, dryRun bool) (map[string]string, int, []string, error) {
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
		if err := tx.QueryRow(`SELECT model_account_id FROM account_links WHERE bridge_account_id = ?`, item.BridgeID).Scan(&modelAccountID); err == nil {
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
	if dryRun {
		return resolved, provisioned, stale, nil
	}
	if err := tx.Commit(); err != nil {
		return nil, 0, nil, fmt.Errorf("provision commit: %w", err)
	}
	return resolved, provisioned, stale, nil
}

// ApplySyncPlan upserts sync checkpoints and refreshes pending seed postings
// in one transaction. Owner rows always win key conflicts. Pending rows are
// snapshot-scoped per card account: existing sync pending rows for the given
// accounts are deleted before the fresh set is inserted. With dryRun the
// transaction rolls back and only counts are returned.
func (s *sqliteStore) ApplySyncPlan(checkpoints []SyncCheckpoint, pending []types.Posting, cardAccounts []string, dryRun bool) (SyncApplySummary, error) {
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

	for _, accountID := range cardAccounts {
		// Clean both the current and legacy pending namespaces so a
		// pre-rename database cannot orphan sfin-pending-* rows.
		patterns := []string{
			SyncPostingPrefix + "pending-" + escapeLike(accountID) + `-%`,
			LegacySyncPostingPrefix + "pending-" + escapeLike(accountID) + `-%`,
		}
		var stale []string
		var deleted int64
		for _, pattern := range patterns {
			rows, err := tx.Query(
				`SELECT id FROM postings WHERE source = ? AND source_account_id = ? AND id LIKE ? ESCAPE '\'`,
				SourceSimpleFIN, accountID, pattern,
			)
			if err != nil {
				return summary, fmt.Errorf("sync read pending: %w", err)
			}
			for rows.Next() {
				var id string
				if err := rows.Scan(&id); err != nil {
					rows.Close()
					return summary, err
				}
				stale = append(stale, id)
			}
			if err := rows.Err(); err != nil {
				rows.Close()
				return summary, fmt.Errorf("sync read pending rows: %w", err)
			}
			rows.Close()
			result, err := tx.Exec(
				`DELETE FROM postings WHERE source = ? AND source_account_id = ? AND id LIKE ? ESCAPE '\'`,
				SourceSimpleFIN, accountID, pattern,
			)
			if err != nil {
				return summary, fmt.Errorf("sync clear pending: %w", err)
			}
			count, err := result.RowsAffected()
			if err != nil {
				return summary, fmt.Errorf("sync pending rows: %w", err)
			}
			deleted += count
		}
		summary.PendingDeleted += int(deleted)
		for _, id := range stale {
			if err := releaseRowID(tx, id); err != nil {
				return summary, err
			}
		}
	}
	nextPostingPosition, err := nextTablePosition(tx, "postings")
	if err != nil {
		return summary, err
	}
	for i := range pending {
		// Sync-owned IDs live in the sync- namespace (plus the legacy sfin-
		// namespace), which owner writes cannot claim, so idempotent
		// re-claim is safe here.
		if _, err := tx.Exec(`INSERT OR IGNORE INTO entity_ids (id, kind) VALUES (?, 'posting')`, pending[i].ID); err != nil {
			return summary, fmt.Errorf("sync claim pending id: %w", err)
		}
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
