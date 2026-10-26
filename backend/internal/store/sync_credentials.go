package store

import (
	"database/sql"
	"encoding/json"
	"fmt"
	"strings"
	"time"
)

// SyncCredential carries the per-plan SimpleFIN Bring-Your-Own-Key state.
// AccessURL is the Bridge secret. BridgeHost and UpdatedAt are display
// metadata safe to return through the API. CardAccounts lists model account
// IDs eligible for pending-charge seeds.
type SyncCredential struct {
	AccessURL    string `json:"-"`
	BridgeHost   string
	UpdatedAt    string
	CardAccounts []string
}

// Configured reports whether a Bridge key is connected.
func (c SyncCredential) Configured() bool { return c.AccessURL != "" }

// GetSyncCredential reports the stored SimpleFIN credential, or a zero
// credential when no key has been connected.
func (s *sqliteStore) GetSyncCredential() (SyncCredential, error) {
	var accessURL, bridgeHost, updatedAt, cardsJSON string
	err := s.db.QueryRow(`SELECT access_url, bridge_host, updated_at, cards_json FROM sync_credentials WHERE id = 1 AND plan_id = :plan_id`).Scan(&accessURL, &bridgeHost, &updatedAt, &cardsJSON)
	if err != nil {
		if err == sql.ErrNoRows {
			return SyncCredential{}, nil
		}
		return SyncCredential{}, fmt.Errorf("read sync credential: %w", err)
	}
	var cards []string
	if cardsJSON != "" {
		if err := json.Unmarshal([]byte(cardsJSON), &cards); err != nil {
			return SyncCredential{}, fmt.Errorf("decode sync cards: %w", err)
		}
	}
	if cards == nil {
		cards = []string{}
	}
	return SyncCredential{AccessURL: accessURL, BridgeHost: bridgeHost, UpdatedAt: updatedAt, CardAccounts: cards}, nil
}

// SetSyncCredential stores the Bridge Access URL with display metadata. An
// empty access URL disconnects the key: host and timestamp clear, card
// selection is kept. Prefer ClearSyncCredential for an explicit disconnect.
func (s *sqliteStore) SetSyncCredential(accessURL, bridgeHost string) (SyncCredential, error) {
	if strings.TrimSpace(accessURL) == "" {
		return s.clearCredentialLocked()
	}
	updatedAt := time.Now().UTC().Format(time.RFC3339)
	if _, err := s.db.Exec(`INSERT INTO sync_credentials (id, access_url, bridge_host, updated_at, cards_json, plan_id)
		VALUES (1, ?, ?, ?, '[]', :plan_id)
		ON CONFLICT(plan_id, id) DO UPDATE SET access_url = excluded.access_url, bridge_host = excluded.bridge_host, updated_at = excluded.updated_at`,
		accessURL, bridgeHost, updatedAt); err != nil {
		return SyncCredential{}, fmt.Errorf("store sync credential: %w", err)
	}
	return s.GetSyncCredential()
}

// ClearSyncCredential disconnects the Bridge key. Card selection and sync
// history stay so a reconnect resumes cleanly.
func (s *sqliteStore) ClearSyncCredential() error {
	_, err := s.clearCredentialLocked()
	return err
}

func (s *sqliteStore) clearCredentialLocked() (SyncCredential, error) {
	if _, err := s.db.Exec(`INSERT INTO sync_credentials (id, access_url, bridge_host, updated_at, cards_json, plan_id)
		VALUES (1, '', '', '', '[]', :plan_id)
		ON CONFLICT(plan_id, id) DO UPDATE SET access_url = '', bridge_host = '', updated_at = ''`); err != nil {
		return SyncCredential{}, fmt.Errorf("clear sync credential: %w", err)
	}
	return s.GetSyncCredential()
}

// GetSyncCards reports the per-plan card account selection.
func (s *sqliteStore) GetSyncCards() ([]string, error) {
	credential, err := s.GetSyncCredential()
	if err != nil {
		return nil, err
	}
	return credential.CardAccounts, nil
}

// SetSyncCards replaces the per-plan card account selection.
func (s *sqliteStore) SetSyncCards(cards []string) ([]string, error) {
	if cards == nil {
		cards = []string{}
	}
	payload, err := json.Marshal(cards)
	if err != nil {
		return nil, fmt.Errorf("encode sync cards: %w", err)
	}
	if _, err := s.db.Exec(`INSERT INTO sync_credentials (id, access_url, bridge_host, updated_at, cards_json, plan_id)
		VALUES (1, '', '', '', ?, :plan_id)
		ON CONFLICT(plan_id, id) DO UPDATE SET cards_json = excluded.cards_json`, string(payload)); err != nil {
		return nil, fmt.Errorf("store sync cards: %w", err)
	}
	return cards, nil
}
