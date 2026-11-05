package sqlite

import (
	"database/sql"
	"fmt"
	"strconv"
	"strings"

	"github.com/simhozebs/net-worth-estimator/backend/internal/types"
)

// syncCheckpointKey identifies an owner/sync checkpoint row for re-merge:
// the account and exact observation instant.
func syncCheckpointKey(accountID string, observedAt int64) string {
	return accountID + "\x00" + strconv.FormatInt(observedAt, 10)
}

// nextTablePosition returns MAX(position)+1 for a position-ordered table, or
// 0 when empty. One position-management helper shared by the sync apply and
// model re-merge paths. Posting display order lives in posting_sim, so a
// "postings" request resolves to that satellite.
func nextTablePosition(tx *userTx, table string) (int, error) {
	if table == "postings" {
		table = "posting_sim"
	}
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
// syncedCheckpoint is a sync-owned checkpoint with its bridge provider.
// Provider stays store-internal: the wire Checkpoint carries authorship,
// and sync plumbing (sync keys, provider routing) never enters owner payloads.
type syncedCheckpoint struct {
	types.Checkpoint
	Provider string
}

func remergeCheckpoints(tx *userTx, incoming []types.Checkpoint, synced []syncedCheckpoint, startPosition int) (int, error) {
	if err := ensureAvailableBalanceSchema(tx); err != nil {
		return 0, fmt.Errorf("ensure available balances: %w", err)
	}
	incomingKeys := make(map[string]struct{}, len(incoming))
	for _, checkpoint := range incoming {
		incomingKeys[syncCheckpointKey(checkpoint.AccountID, checkpoint.ObservedAt)] = struct{}{}
	}
	syncedByKey := make(map[string]syncedCheckpoint, len(synced))
	for _, checkpoint := range synced {
		syncedByKey[syncCheckpointKey(checkpoint.AccountID, checkpoint.ObservedAt)] = checkpoint
	}
	position := startPosition
	untouchedSyncKeys := make(map[string]struct{})
	for _, checkpoint := range incoming {
		key := syncCheckpointKey(checkpoint.AccountID, checkpoint.ObservedAt)
		if synced, ok := syncedByKey[key]; ok && synced.Balance == checkpoint.Balance && equalFloatPtr(synced.AvailableBalance, checkpoint.AvailableBalance) {
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
		if err := upsertAvailableBalanceTx(tx, checkpoint.AccountID, checkpoint.ObservedAt, nil); err != nil {
			return 0, fmt.Errorf("clear available balance: %w", err)
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
			`INSERT INTO checkpoints (position, model_account_id, balance, source, provider, observed_at, user_id, id) VALUES (?,?,?,?,?,?, :user_id, (SELECT COALESCE(MAX(id), 0) + 1 FROM checkpoints WHERE user_id = :user_id))`,
			position, checkpoint.AccountID, checkpoint.Balance, checkpoint.Source, checkpoint.Provider, checkpoint.ObservedAt,
		); err != nil {
			return 0, fmt.Errorf("re-merge synced checkpoint: %w", err)
		}
		if err := upsertAvailableBalanceTx(tx, checkpoint.AccountID, checkpoint.ObservedAt, checkpoint.AvailableBalance); err != nil {
			return 0, fmt.Errorf("re-merge available balance: %w", err)
		}
		position++
	}
	return position, nil
}

func equalFloatPtr(left, right *float64) bool {
	if left == nil || right == nil {
		return left == nil && right == nil
	}
	return *left == *right
}

// remergePostings writes owner postings, then restores authoritative sync rows.
// Execution orders allocate once per batch instead of one MAX query per row.
func remergePostings(tx *userTx, incoming []types.Posting, synced []types.Posting, startPosition int) (int, error) {
	position := startPosition
	syncedIDs := make(map[string]bool, len(synced))
	for _, posting := range synced {
		syncedIDs[posting.ID] = true
	}
	var nextOrder int64
	if err := tx.QueryRow(`SELECT COALESCE(MAX(execution_order), 0) FROM posting_sim WHERE user_id = :user_id`).Scan(&nextOrder); err != nil {
		return 0, fmt.Errorf("read max execution order: %w", err)
	}
	nextOrder++
	allocate := func(posting *types.Posting) {
		if posting.ExecutionOrder == 0 {
			posting.ExecutionOrder = nextOrder
			nextOrder++
		}
	}
	for i := range incoming {
		if syncedIDs[incoming[i].ID] {
			continue
		}
		allocate(&incoming[i])
		if err := insertPosting(tx, position, &incoming[i], SourceUser); err != nil {
			return 0, err
		}
		position++
	}
	for i := range synced {
		allocate(&synced[i])
		if err := insertPosting(tx, position, &synced[i], synced[i].Source); err != nil {
			return 0, fmt.Errorf("re-merge synced posting: %w", err)
		}
		position++
	}
	return position, nil
}

func loadSyncedCheckpoints(tx *userTx) ([]syncedCheckpoint, error) {
	// Any non-user source is sync-owned. The source is one bank category
	// and the provider column names the supplying bridge, so metrics and
	// debugging can tell bank-data origins apart; the lifecycle treats
	// them uniformly.
	query := `SELECT c.model_account_id, c.balance, c.source, c.provider, c.observed_at, NULL
		FROM checkpoints c WHERE c.source != ? AND c.user_id = :user_id ORDER BY c.position`
	var availableTables int
	if err := tx.QueryRow(`SELECT COUNT(*) FROM sqlite_master WHERE type = 'table' AND name = 'checkpoint_available_balances'`).Scan(&availableTables); err != nil {
		return nil, err
	}
	if availableTables == 1 {
		query = `SELECT c.model_account_id, c.balance, c.source, c.provider, c.observed_at, a.available_balance
			FROM checkpoints c LEFT JOIN checkpoint_available_balances a
			ON a.user_id = c.user_id AND a.model_account_id = c.model_account_id AND a.observed_at = c.observed_at
			WHERE c.source != ? AND c.user_id = :user_id ORDER BY c.position`
	}
	rows, err := tx.Query(query, SourceUser)
	if err != nil {
		return nil, err
	}
	defer rows.Close()
	var checkpoints []syncedCheckpoint
	for rows.Next() {
		var checkpoint syncedCheckpoint
		var available sql.NullFloat64
		if err := rows.Scan(&checkpoint.AccountID, &checkpoint.Balance, &checkpoint.Source, &checkpoint.Provider, &checkpoint.ObservedAt, &available); err != nil {
			return nil, err
		}
		checkpoint.AvailableBalance = scanAvailableBalance(available)
		checkpoints = append(checkpoints, checkpoint)
	}
	if err := rows.Err(); err != nil {
		return nil, err
	}
	return checkpoints, rows.Close()
}

func loadSyncedPostings(tx *userTx) ([]types.Posting, error) {
	rows, err := tx.Query(`SELECT `+postingSelect+` `+postingJoins+` WHERE p.source != ? AND p.projection_slice_id IS NULL AND p.user_id = :user_id ORDER BY s.position`, SourceUser)
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

// validateSyncCheckpointSource rejects checkpoints without explicit
// bank provenance. Owner rows are never valid sync input, no source is
// ever defaulted, and the provider is required so same-instant refresh
// matches only the supplying bridge.
func validateSyncCheckpointSource(checkpoint SyncCheckpoint) error {
	if checkpoint.Source == "" {
		return fmt.Errorf("sync checkpoint for %s requires a provider source", checkpoint.AccountID)
	}
	if checkpoint.Source == SourceUser {
		return fmt.Errorf("sync checkpoint for %s carries owner source", checkpoint.AccountID)
	}
	if checkpoint.Source != SourceBankSync {
		return fmt.Errorf("sync checkpoint for %s carries unknown source %q", checkpoint.AccountID, checkpoint.Source)
	}
	if checkpoint.Provider == "" {
		return fmt.Errorf("sync checkpoint for %s requires a provider", checkpoint.AccountID)
	}
	return nil
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
	linkByBridge := map[string]string{}
	if len(items) > 0 {
		placeholders := make([]string, len(items))
		args := make([]any, len(items))
		for i, item := range items {
			placeholders[i] = "?"
			args[i] = item.BridgeID
		}
		rows, err := tx.Query(`SELECT bridge_account_id, model_account_id FROM account_links WHERE bridge_account_id IN (`+strings.Join(placeholders, ",")+`) AND user_id = :user_id`, args...)
		if err != nil {
			return nil, 0, nil, fmt.Errorf("read account links: %w", err)
		}
		for rows.Next() {
			var bridgeID, modelAccountID string
			if err := rows.Scan(&bridgeID, &modelAccountID); err != nil {
				rows.Close()
				return nil, 0, nil, err
			}
			linkByBridge[bridgeID] = modelAccountID
		}
		if err := rows.Err(); err != nil {
			rows.Close()
			return nil, 0, nil, err
		}
		rows.Close()
	}
	existingAccounts := map[string]struct{}{}
	if len(linkByBridge) > 0 {
		ids := make([]string, 0, len(linkByBridge))
		for _, modelID := range linkByBridge {
			ids = append(ids, modelID)
		}
		placeholders := make([]string, len(ids))
		args := make([]any, len(ids))
		for i, id := range ids {
			placeholders[i] = "?"
			args[i] = id
		}
		rows, err := tx.Query(`SELECT id FROM accounts WHERE id IN (`+strings.Join(placeholders, ",")+`) AND user_id = :user_id`, args...)
		if err != nil {
			return nil, 0, nil, fmt.Errorf("check accounts: %w", err)
		}
		for rows.Next() {
			var id string
			if err := rows.Scan(&id); err != nil {
				rows.Close()
				return nil, 0, nil, err
			}
			existingAccounts[id] = struct{}{}
		}
		if err := rows.Err(); err != nil {
			rows.Close()
			return nil, 0, nil, err
		}
		rows.Close()
	}
	for _, item := range items {
		if modelAccountID, ok := linkByBridge[item.BridgeID]; ok {
			if _, exists := existingAccounts[modelAccountID]; !exists {
				stale = append(stale, item.BridgeID)
				continue
			}
			if err := TouchAccountLink(tx, item.BridgeID, item.Name, item.Currency); err != nil {
				return nil, 0, nil, err
			}
			resolved[item.BridgeID] = modelAccountID
			continue
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

// ApplySync upserts sync checkpoints and applies reconciled bank
// directives in one transaction. Owner rows always win key conflicts. The
// directives carry fully resolved lifecycle state; the store verifies
// structural validity (keys present, non-user source, row existence) but
// never interprets provider behavior. Backdated observations are retained
// as distinct instant-keyed rows: chronological replay orders them and the
// latest instant still wins, so a late arrival never rolls current state
// back. A same-instant sync row replaces idempotently; an owner row at the
// same instant keeps precedence.
func (s *sqliteStore) ApplySync(checkpoints []SyncCheckpoint, directives []BankDirective) (SyncApplySummary, error) {
	var summary SyncApplySummary
	tx, err := s.db.Begin()
	if err != nil {
		return summary, fmt.Errorf("sync begin: %w", err)
	}
	defer tx.Rollback()

	if err := ensureAvailableBalanceSchema(tx); err != nil {
		return summary, fmt.Errorf("ensure available balances: %w", err)
	}
	nextPosition, err := nextTablePosition(tx, "checkpoints")
	if err != nil {
		return summary, err
	}
	for _, checkpoint := range checkpoints {
		if err := validateSyncCheckpointSource(checkpoint); err != nil {
			return summary, err
		}
		// Owner rows win key collisions; a sync row from another provider
		// never overwrites this provider's repeat write. Only the same
		// provider refreshes its own checkpoint. Update-first
		// avoids the old insert-then-select-then-update round trips.
		result, err := tx.Exec(
			`UPDATE checkpoints SET balance = ? WHERE model_account_id = ? AND observed_at = ? AND source = ? AND provider = ? AND user_id = :user_id`,
			checkpoint.Balance, checkpoint.AccountID, checkpoint.ObservedAt, checkpoint.Source, checkpoint.Provider,
		)
		if err != nil {
			return summary, fmt.Errorf("sync update checkpoint: %w", err)
		}
		if updated, err := result.RowsAffected(); err != nil {
			return summary, fmt.Errorf("sync checkpoint rows: %w", err)
		} else if updated > 0 {
			if err := upsertAvailableBalanceTx(tx, checkpoint.AccountID, checkpoint.ObservedAt, checkpoint.AvailableBalance); err != nil {
				return summary, fmt.Errorf("sync available balance: %w", err)
			}
			summary.CheckpointsUpdated++
			continue
		}
		result, err = tx.Exec(
			`INSERT OR IGNORE INTO checkpoints (position, model_account_id, balance, source, provider, observed_at, user_id, id) VALUES (?,?,?,?,?,?, :user_id, (SELECT COALESCE(MAX(id), 0) + 1 FROM checkpoints WHERE user_id = :user_id))`,
			nextPosition, checkpoint.AccountID, checkpoint.Balance, checkpoint.Source, checkpoint.Provider, checkpoint.ObservedAt,
		)
		if err != nil {
			return summary, fmt.Errorf("sync insert checkpoint: %w", err)
		}
		inserted, err := result.RowsAffected()
		if err != nil {
			return summary, fmt.Errorf("sync checkpoint rows: %w", err)
		}
		if inserted > 0 {
			if err := upsertAvailableBalanceTx(tx, checkpoint.AccountID, checkpoint.ObservedAt, checkpoint.AvailableBalance); err != nil {
				return summary, fmt.Errorf("sync available balance: %w", err)
			}
			summary.CheckpointsInserted++
			nextPosition++
			continue
		}
		summary.CheckpointsSkipped++
	}

	if err := ensureSuppressionSchema(tx); err != nil {
		return summary, err
	}
	suppressed, err := loadSuppressedKeys(tx)
	if err != nil {
		return summary, err
	}
	if len(suppressed) > 0 {
		kept := directives[:0]
		for _, directive := range directives {
			if directive.Upsert != nil && suppressedUpsert(suppressed, directive.Upsert) {
				continue
			}
			kept = append(kept, directive)
		}
		// Zero the tail so the dropped directives release their references.
		for i := len(kept); i < len(directives); i++ {
			directives[i] = BankDirective{}
		}
		directives = kept
	}

	if err := applyBankDirectives(tx, directives, &summary); err != nil {
		return summary, err
	}

	if err := tx.Commit(); err != nil {
		return summary, fmt.Errorf("sync commit: %w", err)
	}
	// Every applied plan dirties the projection from its earliest date.
	// Direct callers get the same invalidation as the ingest orchestrator.
	if dirty, changed := dirtyFromSync(checkpoints, directives); changed {
		if _, err := s.MarkProjectionDirty(dirty); err != nil {
			return summary, fmt.Errorf("mark projection dirty: %w", err)
		}
	}
	return summary, nil
}
