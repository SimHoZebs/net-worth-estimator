package sqlite

import (
	"database/sql"
	"fmt"
	"strings"
	"time"

	"github.com/simhozebs/net-worth-estimator/backend/internal/store"
)

// gmailCredentialsDDL owns the per-user Gmail OAuth state. Fresh databases
// get it from the shared schema; pre-existing databases gain it on first
// Gmail use through ensureGmailSchema, so no operator migration converts
// anything (there are no pre-existing Gmail rows to convert).
const gmailCredentialsDDL = `CREATE TABLE IF NOT EXISTS gmail_credentials (
	user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
	id INTEGER NOT NULL CHECK (id = 1),
	refresh_token TEXT NOT NULL DEFAULT '',
	access_token TEXT NOT NULL DEFAULT '',
	access_expiry INTEGER NOT NULL DEFAULT 0,
	email_address TEXT NOT NULL DEFAULT '',
	scopes TEXT NOT NULL DEFAULT '',
	connected_at TEXT NOT NULL DEFAULT '',
	pending_state TEXT NOT NULL DEFAULT '',
	pending_at INTEGER NOT NULL DEFAULT 0,
	lookback_days INTEGER NOT NULL DEFAULT 90,
	last_history_id TEXT NOT NULL DEFAULT '',
	last_scan_at TEXT NOT NULL DEFAULT '',
	PRIMARY KEY(user_id, id)
)`

func (s *sqliteStore) ensureGmail() error {
	_, err := s.db.Exec(gmailCredentialsDDL)
	if err != nil {
		return fmt.Errorf("ensure gmail credentials: %w", err)
	}
	return nil
}

// GetGmailCredential reports the stored Gmail OAuth state. A missing row
// reads as disconnected with the default lookback; tokens never leave this
// row except to the calling service for server-side Google calls.
func (s *sqliteStore) GetGmailCredential() (store.GmailCredential, error) {
	if err := s.ensureGmail(); err != nil {
		return store.GmailCredential{}, err
	}
	var credential store.GmailCredential
	var connectedAt string
	err := s.db.QueryRow(`SELECT refresh_token, access_token, access_expiry, email_address, scopes, connected_at, pending_state, pending_at, lookback_days, last_history_id, last_scan_at FROM gmail_credentials WHERE id = 1 AND user_id = :user_id`).Scan(
		&credential.RefreshToken, &credential.AccessToken, &credential.AccessExpiryUnix,
		&credential.EmailAddress, &credential.Scopes, &connectedAt,
		&credential.PendingState, &credential.PendingAtUnix,
		&credential.LookbackDays, &credential.LastHistoryID, &credential.LastScanAt)
	if err != nil {
		if err == sql.ErrNoRows {
			return store.GmailCredential{LookbackDays: store.DefaultGmailLookbackDays}, nil
		}
		return store.GmailCredential{}, fmt.Errorf("read gmail credential: %w", err)
	}
	credential.ConnectedAt = connectedAt
	if credential.LookbackDays <= 0 {
		credential.LookbackDays = store.DefaultGmailLookbackDays
	}
	return credential, nil
}

// ConnectGmail stores a Gmail OAuth grant and stamps the connection time.
// Any pending authorization state clears: the grant completes the flow.
func (s *sqliteStore) ConnectGmail(grant store.GmailCredential) (store.GmailCredential, error) {
	if err := s.ensureGmail(); err != nil {
		return store.GmailCredential{}, err
	}
	if strings.TrimSpace(grant.RefreshToken) == "" {
		return store.GmailCredential{}, fmt.Errorf("connect gmail: refresh token is required")
	}
	connectedAt := time.Now().UTC().Format(time.RFC3339)
	lookback := grant.LookbackDays
	if lookback <= 0 {
		if current, err := s.GetGmailCredential(); err == nil && current.LookbackDays > 0 {
			lookback = current.LookbackDays
		} else {
			lookback = store.DefaultGmailLookbackDays
		}
	}
	if _, err := s.db.Exec(`INSERT INTO gmail_credentials (id, refresh_token, access_token, access_expiry, email_address, scopes, connected_at, pending_state, pending_at, lookback_days, last_history_id, last_scan_at, user_id)
		VALUES (1, ?, ?, ?, ?, ?, ?, '', 0, ?, '', '', :user_id)
		ON CONFLICT(user_id, id) DO UPDATE SET refresh_token = excluded.refresh_token, access_token = excluded.access_token, access_expiry = excluded.access_expiry, email_address = excluded.email_address, scopes = excluded.scopes, connected_at = excluded.connected_at, pending_state = '', pending_at = 0, lookback_days = excluded.lookback_days, last_history_id = '', last_scan_at = ''`,
		grant.RefreshToken, grant.AccessToken, grant.AccessExpiryUnix, grant.EmailAddress, grant.Scopes, connectedAt, lookback); err != nil {
		return store.GmailCredential{}, fmt.Errorf("connect gmail: %w", err)
	}
	return s.GetGmailCredential()
}

// UpdateGmailToken replaces the stored access token after a server-side
// refresh. A non-empty refresh token rotates the grant; an empty one keeps
// the existing refresh token, account, and connection time.
func (s *sqliteStore) UpdateGmailToken(accessToken string, accessExpiryUnix int64, refreshToken string) (store.GmailCredential, error) {
	if err := s.ensureGmail(); err != nil {
		return store.GmailCredential{}, err
	}
	if strings.TrimSpace(accessToken) == "" {
		return store.GmailCredential{}, fmt.Errorf("update gmail token: access token is required")
	}
	if strings.TrimSpace(refreshToken) == "" {
		if _, err := s.db.Exec(`UPDATE gmail_credentials SET access_token = ?, access_expiry = ? WHERE id = 1 AND user_id = :user_id`, accessToken, accessExpiryUnix); err != nil {
			return store.GmailCredential{}, fmt.Errorf("update gmail token: %w", err)
		}
	} else {
		if _, err := s.db.Exec(`UPDATE gmail_credentials SET access_token = ?, access_expiry = ?, refresh_token = ? WHERE id = 1 AND user_id = :user_id`, accessToken, accessExpiryUnix, refreshToken); err != nil {
			return store.GmailCredential{}, fmt.Errorf("update gmail token: %w", err)
		}
	}
	return s.GetGmailCredential()
}

// SetGmailLookback stores the configurable initial scan lookback in days.
func (s *sqliteStore) SetGmailLookback(days int) (store.GmailCredential, error) {
	if err := s.ensureGmail(); err != nil {
		return store.GmailCredential{}, err
	}
	if _, err := s.db.Exec(`INSERT INTO gmail_credentials (id, lookback_days, user_id)
		VALUES (1, ?, :user_id)
		ON CONFLICT(user_id, id) DO UPDATE SET lookback_days = excluded.lookback_days`, days); err != nil {
		return store.GmailCredential{}, fmt.Errorf("store gmail lookback: %w", err)
	}
	return s.GetGmailCredential()
}

// SetGmailScanCursor records the incremental scan cursor after a completed
// scan. History ID and completion time persist in one statement.
func (s *sqliteStore) SetGmailScanCursor(historyID, scannedAt string) (store.GmailCredential, error) {
	if err := s.ensureGmail(); err != nil {
		return store.GmailCredential{}, err
	}
	if _, err := s.db.Exec(`INSERT INTO gmail_credentials (id, last_history_id, last_scan_at, user_id)
		VALUES (1, ?, ?, :user_id)
		ON CONFLICT(user_id, id) DO UPDATE SET last_history_id = excluded.last_history_id, last_scan_at = excluded.last_scan_at`, historyID, scannedAt); err != nil {
		return store.GmailCredential{}, fmt.Errorf("store gmail scan cursor: %w", err)
	}
	return s.GetGmailCredential()
}

// SetGmailPendingState records the in-flight OAuth CSRF state.
func (s *sqliteStore) SetGmailPendingState(state string, pendingAtUnix int64) error {
	if err := s.ensureGmail(); err != nil {
		return err
	}
	if _, err := s.db.Exec(`INSERT INTO gmail_credentials (id, pending_state, pending_at, user_id)
		VALUES (1, ?, ?, :user_id)
		ON CONFLICT(user_id, id) DO UPDATE SET pending_state = excluded.pending_state, pending_at = excluded.pending_at`, state, pendingAtUnix); err != nil {
		return fmt.Errorf("store gmail pending state: %w", err)
	}
	return nil
}

// ClearGmailCredential disconnects Gmail: tokens, account display, and
// scan cursor are forgotten. The lookback preference is kept so a
// reconnect resumes with the user's window.
func (s *sqliteStore) ClearGmailCredential() error {
	if err := s.ensureGmail(); err != nil {
		return err
	}
	if _, err := s.db.Exec(`UPDATE gmail_credentials SET refresh_token = '', access_token = '', access_expiry = 0, email_address = '', scopes = '', connected_at = '', pending_state = '', pending_at = 0, last_history_id = '', last_scan_at = '' WHERE id = 1 AND user_id = :user_id`); err != nil {
		return fmt.Errorf("clear gmail credential: %w", err)
	}
	return nil
}
