package identity

import (
	"database/sql"
	"encoding/json"
	"errors"
	"time"
)

var errGrantRevoked = errors.New("provider grant was revoked")

// Provider credentials stay in the private identity database, never in cookies.
// An application session holds only an opaque grant reference.
type grant struct {
	ID, Issuer, Subject, SID, Name, Nonce string
	AccessToken, RefreshToken, IDToken    string
	LoginStartedAt, TokenExpiry           int64
	CheckedAt, Expiry                     int64
}

func (s *sessionStore) initGrants() error {
	_, err := s.db.Exec(`
		CREATE TABLE IF NOT EXISTS identity_grants (
			id TEXT PRIMARY KEY, issuer TEXT NOT NULL, subject TEXT NOT NULL,
			sid TEXT NOT NULL, expiry INTEGER NOT NULL, data BLOB NOT NULL
		);
		CREATE INDEX IF NOT EXISTS identity_grant_subject ON identity_grants(issuer, subject, sid);
		CREATE TABLE IF NOT EXISTS identity_logout_marks (
			issuer TEXT NOT NULL, kind TEXT NOT NULL, identifier TEXT NOT NULL,
			seen_at INTEGER NOT NULL, expiry INTEGER NOT NULL,
			PRIMARY KEY(issuer, kind, identifier)
		);
		CREATE TABLE IF NOT EXISTS identity_logout_tokens (
			issuer TEXT NOT NULL, jti TEXT NOT NULL, expiry INTEGER NOT NULL,
			PRIMARY KEY(issuer, jti)
		);
	`)
	return err
}

func (s *sessionStore) createGrant(g grant) error {
	data, err := json.Marshal(g)
	if err != nil {
		return err
	}
	tx, err := s.db.Begin()
	if err != nil {
		return err
	}
	defer tx.Rollback()
	var revoked bool
	err = tx.QueryRow(`SELECT EXISTS(SELECT 1 FROM identity_logout_marks WHERE issuer=? AND seen_at>=? AND expiry>? AND (
		(kind='subject' AND identifier=?) OR (kind='sid' AND ?<>'' AND identifier=?) OR
		(kind='fallback' AND ?='' AND identifier=?)))`, g.Issuer, g.LoginStartedAt, time.Now().Unix(),
		g.Subject, g.SID, g.SID, g.SID, g.Subject).Scan(&revoked)
	if err != nil {
		return err
	}
	if revoked {
		return errGrantRevoked
	}
	if _, err = tx.Exec(`DELETE FROM identity_grants WHERE expiry<=?`, time.Now().Unix()); err != nil {
		return err
	}
	if _, err = tx.Exec(`INSERT INTO identity_grants(id,issuer,subject,sid,expiry,data) VALUES(?,?,?,?,?,?)`,
		g.ID, g.Issuer, g.Subject, g.SID, g.Expiry, data); err != nil {
		return err
	}
	return tx.Commit()
}

func (s *sessionStore) findGrant(id, issuer string) (grant, error) {
	var g grant
	var data []byte
	err := s.db.QueryRow(`SELECT data FROM identity_grants WHERE id=? AND issuer=? AND expiry>?`, id, issuer, time.Now().Unix()).Scan(&data)
	if errors.Is(err, sql.ErrNoRows) {
		return g, nil
	}
	if err != nil {
		return g, err
	}
	err = json.Unmarshal(data, &g)
	return g, err
}

func (s *sessionStore) updateGrant(g grant) error {
	data, err := json.Marshal(g)
	if err != nil {
		return err
	}
	result, err := s.db.Exec(`UPDATE identity_grants SET data=? WHERE id=? AND issuer=? AND expiry>?`,
		data, g.ID, g.Issuer, time.Now().Unix())
	if err != nil {
		return err
	}
	n, err := result.RowsAffected()
	if err != nil {
		return err
	}
	if n == 0 {
		return errGrantRevoked
	}
	return nil
}

func (s *sessionStore) deleteGrant(id, issuer string) error {
	_, err := s.db.Exec(`DELETE FROM identity_grants WHERE id=? AND issuer=?`, id, issuer)
	return err
}

// Replay records and grant deletion share a transaction. Retries cannot revoke
// a later login twice, and a delayed callback cannot restore an older login.
func (s *sessionStore) revokeGrants(issuer, subject, sid, jti string, lifetime time.Duration) error {
	tx, err := s.db.Begin()
	if err != nil {
		return err
	}
	defer tx.Rollback()
	now := time.Now()
	for _, table := range []string{"identity_logout_tokens", "identity_logout_marks"} {
		if _, err := tx.Exec(`DELETE FROM `+table+` WHERE expiry<=?`, now.Unix()); err != nil {
			return err
		}
	}
	result, err := tx.Exec(`INSERT INTO identity_logout_tokens(issuer,jti,expiry) VALUES(?,?,?) ON CONFLICT DO NOTHING`, issuer, jti, now.Add(5*time.Minute).Unix())
	if err != nil {
		return err
	}
	n, err := result.RowsAffected()
	if err != nil {
		return err
	}
	if n == 0 {
		return tx.Commit()
	}
	mark := func(kind, identifier string) error {
		_, err := tx.Exec(`INSERT INTO identity_logout_marks(issuer,kind,identifier,seen_at,expiry) VALUES(?,?,?,?,?)
			ON CONFLICT(issuer,kind,identifier) DO UPDATE SET seen_at=excluded.seen_at,expiry=excluded.expiry`,
			issuer, kind, identifier, now.UnixNano(), now.Add(max(lifetime, 15*time.Minute)).Unix())
		return err
	}
	if subject != "" {
		kind := "subject"
		if sid != "" {
			// Casdoor 4.23 omits sid from its ID token. Revoke that user's
			// grants conservatively when the precise provider session is unknown.
			kind = "fallback"
		}
		if err := mark(kind, subject); err != nil {
			return err
		}
		_, err = tx.Exec(`DELETE FROM identity_grants WHERE issuer=? AND subject=? AND (?='' OR sid='' OR sid=?)`, issuer, subject, sid, sid)
	} else {
		_, err = tx.Exec(`DELETE FROM identity_grants WHERE issuer=? AND sid=?`, issuer, sid)
	}
	if err != nil {
		return err
	}
	if sid != "" {
		if err := mark("sid", sid); err != nil {
			return err
		}
	}
	return tx.Commit()
}
