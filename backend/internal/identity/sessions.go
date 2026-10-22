package identity

import (
	"crypto/sha256"
	"database/sql"
	"encoding/hex"
	"os"
	"path/filepath"
	"time"

	_ "modernc.org/sqlite"
)

// sessionStore implements SCS storage. Session tokens are hashed at rest.
// This database has no financial rows and survives financial imports.
type sessionStore struct{ db *sql.DB }

func openSessions(path string) (*sessionStore, error) {
	if err := os.MkdirAll(filepath.Dir(path), 0o700); err != nil {
		return nil, err
	}
	f, err := os.OpenFile(path, os.O_CREATE|os.O_RDWR, 0o600)
	if err != nil {
		return nil, err
	}
	if err := f.Chmod(0o600); err != nil {
		f.Close()
		return nil, err
	}
	if err := f.Close(); err != nil {
		return nil, err
	}
	db, err := sql.Open("sqlite", path+"?_pragma=journal_mode(WAL)&_pragma=busy_timeout(5000)")
	if err != nil {
		return nil, err
	}
	db.SetMaxOpenConns(1)
	if _, err = db.Exec(`CREATE TABLE IF NOT EXISTS sessions (token TEXT PRIMARY KEY, data BLOB NOT NULL, expiry INTEGER NOT NULL)`); err != nil {
		db.Close()
		return nil, err
	}
	store := &sessionStore{db}
	if err := store.initGrants(); err != nil {
		db.Close()
		return nil, err
	}
	return store, nil
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
