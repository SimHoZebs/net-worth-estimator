package identity

import (
	"crypto/sha256"
	"database/sql"
	"encoding/hex"
	"errors"
	"fmt"
	"time"

	"github.com/simhozebs/net-worth-estimator/backend/internal/store"
)

// sessionStore implements SCS storage. Session tokens are hashed at rest.
// The application owns an injected connection; isolated tests may own a file.
type sessionStore struct {
	db    *sql.DB
	owned bool
}

func openSessions(path string) (*sessionStore, error) {
	if path == "" {
		return nil, errors.New("sessions require the application database")
	}
	database, err := store.OpenDatabase(path)
	if err != nil {
		return nil, err
	}
	sessions, err := sharedSessions(database.SQL())
	if err != nil {
		database.Close()
		return nil, err
	}
	sessions.owned = true
	return sessions, nil
}

func sharedSessions(db *sql.DB) (*sessionStore, error) {
	if db == nil {
		return nil, errors.New("sessions require the application database")
	}
	// Schema belongs to the deployment setup command. Validate injected handles
	// without creating or repairing tables during identity initialization.
	for _, query := range []string{
		`SELECT token, data, expiry FROM sessions LIMIT 0`,
		`SELECT id, issuer, subject, sid, expiry, data FROM identity_grants LIMIT 0`,
		`SELECT issuer, kind, identifier, seen_at, expiry FROM identity_logout_marks LIMIT 0`,
		`SELECT issuer, jti, expiry FROM identity_logout_tokens LIMIT 0`,
	} {
		rows, err := db.Query(query)
		if err != nil {
			return nil, fmt.Errorf("application identity schema is not ready; run setupdb before startup: %w", err)
		}
		if err := rows.Close(); err != nil {
			return nil, err
		}
	}
	return &sessionStore{db: db}, nil
}

func (s *sessionStore) Close() error {
	if s.owned {
		return s.db.Close()
	}
	return nil
}

func tokenHash(token string) string {
	h := sha256.Sum256([]byte(token))
	return hex.EncodeToString(h[:])
}
func (s *sessionStore) Find(token string) ([]byte, bool, error) {
	var data []byte
	err := s.db.QueryRow(`SELECT data FROM sessions WHERE token=? AND expiry>?`, tokenHash(token), time.Now().Unix()).Scan(&data)
	if err == sql.ErrNoRows {
		return nil, false, nil
	}
	return data, err == nil, err
}
func (s *sessionStore) Commit(token string, data []byte, expiry time.Time) error {
	tx, err := s.db.Begin()
	if err != nil {
		return err
	}
	defer tx.Rollback()
	if _, err := tx.Exec(`DELETE FROM sessions WHERE expiry<=?`, time.Now().Unix()); err != nil {
		return err
	}
	if _, err := tx.Exec(`INSERT INTO sessions(token,data,expiry) VALUES(?,?,?) ON CONFLICT(token) DO UPDATE SET data=excluded.data, expiry=excluded.expiry`, tokenHash(token), data, expiry.Unix()); err != nil {
		return err
	}
	return tx.Commit()
}
func (s *sessionStore) Delete(token string) error {
	_, err := s.db.Exec(`DELETE FROM sessions WHERE token=?`, tokenHash(token))
	return err
}
