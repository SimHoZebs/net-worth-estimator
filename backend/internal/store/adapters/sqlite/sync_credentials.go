package sqlite

import (
	"database/sql"
	"fmt"
	"strings"
	"time"
)

// GetSyncCredential reports the stored SimpleFIN credential, or a zero
// credential when no key has been connected.
func (s *sqliteStore) GetSyncCredential() (SyncCredential, error) {
	var accessURL, bridgeHost, updatedAt string
	err := s.db.QueryRow(`SELECT access_url, bridge_host, updated_at FROM sync_credentials WHERE id = 1 AND user_id = :user_id`).Scan(&accessURL, &bridgeHost, &updatedAt)
	if err != nil {
		if err == sql.ErrNoRows {
			return SyncCredential{}, nil
		}
		return SyncCredential{}, fmt.Errorf("read sync credential: %w", err)
	}
	return SyncCredential{AccessURL: accessURL, BridgeHost: bridgeHost, UpdatedAt: updatedAt}, nil
}

// SetSyncCredential stores the Bridge Access URL with display metadata. An
// empty access URL disconnects the key: host and timestamp clear. Prefer
// ClearSyncCredential for an explicit disconnect.
func (s *sqliteStore) SetSyncCredential(accessURL, bridgeHost string) (SyncCredential, error) {
	if strings.TrimSpace(accessURL) == "" {
		return s.clearCredentialLocked()
	}
	updatedAt := time.Now().UTC().Format(time.RFC3339)
	if _, err := s.db.Exec(`INSERT INTO sync_credentials (id, access_url, bridge_host, updated_at, cards_json, user_id)
		VALUES (1, ?, ?, ?, '[]', :user_id)
		ON CONFLICT(user_id, id) DO UPDATE SET access_url = excluded.access_url, bridge_host = excluded.bridge_host, updated_at = excluded.updated_at`,
		accessURL, bridgeHost, updatedAt); err != nil {
		return SyncCredential{}, fmt.Errorf("store sync credential: %w", err)
	}
	return s.GetSyncCredential()
}

// ClearSyncCredential disconnects the Bridge key. Sync history stays so a
// reconnect resumes cleanly.
func (s *sqliteStore) ClearSyncCredential() error {
	_, err := s.clearCredentialLocked()
	return err
}

func (s *sqliteStore) clearCredentialLocked() (SyncCredential, error) {
	if _, err := s.db.Exec(`INSERT INTO sync_credentials (id, access_url, bridge_host, updated_at, cards_json, user_id)
		VALUES (1, '', '', '', '[]', :user_id)
		ON CONFLICT(user_id, id) DO UPDATE SET access_url = '', bridge_host = '', updated_at = ''`); err != nil {
		return SyncCredential{}, fmt.Errorf("clear sync credential: %w", err)
	}
	return s.GetSyncCredential()
}
