package sqlite

import (
	"database/sql"
	"encoding/json"
	"fmt"

	"github.com/simhozebs/net-worth-estimator/backend/internal/store"
)

const syncErrorConnectionID = "simplefin"

// SetSyncError stores the last SimpleFIN condition on the generic provider
// connection row. The status column holds display-only JSON; the access URL
// never enters it.
func (s *sqliteStore) SetSyncError(item store.SyncError) error {
	encoded, err := json.Marshal(item)
	if err != nil {
		return fmt.Errorf("encode sync error: %w", err)
	}
	if _, err := s.db.Exec(`INSERT INTO provider_connections (id, provider_key, status, sync_cursor, last_synced_at, user_id)
		VALUES (?, 'simplefin', ?, '', '', :user_id)
		ON CONFLICT(user_id, id) DO UPDATE SET provider_key = excluded.provider_key, status = excluded.status`,
		syncErrorConnectionID, string(encoded)); err != nil {
		return fmt.Errorf("record sync error: %w", err)
	}
	return nil
}

// GetSyncError returns the stored condition, or nil when the last sync was
// clean or none has run.
func (s *sqliteStore) GetSyncError() (*store.SyncError, error) {
	var raw string
	err := s.db.QueryRow(`SELECT status FROM provider_connections WHERE id = ? AND user_id = :user_id`, syncErrorConnectionID).Scan(&raw)
	if err == sql.ErrNoRows {
		return nil, nil
	}
	if err != nil {
		return nil, fmt.Errorf("read sync error: %w", err)
	}
	if raw == "" {
		return nil, nil
	}
	var item store.SyncError
	if err := json.Unmarshal([]byte(raw), &item); err != nil {
		return nil, fmt.Errorf("decode sync error: %w", err)
	}
	return &item, nil
}

// ClearSyncError removes the display-only sync condition.
func (s *sqliteStore) ClearSyncError() error {
	if _, err := s.db.Exec(`DELETE FROM provider_connections WHERE id = ? AND user_id = :user_id`, syncErrorConnectionID); err != nil {
		return fmt.Errorf("clear sync error: %w", err)
	}
	return nil
}
