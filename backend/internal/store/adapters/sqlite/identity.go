package sqlite

import (
	"crypto/sha256"
	"database/sql"
	"encoding/hex"
	"encoding/json"
	"errors"
	"time"

	"github.com/simhozebs/net-worth-estimator/backend/internal/authorization"
	"github.com/simhozebs/net-worth-estimator/backend/internal/store"
)

var _ store.IdentityStore = (*Database)(nil)

func tokenHash(token string) string {
	h := sha256.Sum256([]byte(token))
	return hex.EncodeToString(h[:])
}

func (d *Database) Find(token string) ([]byte, bool, error) {
	var data []byte
	err := d.db.QueryRow(`SELECT data FROM sessions WHERE token=? AND expiry>?`, tokenHash(token), time.Now().Unix()).Scan(&data)
	if err == sql.ErrNoRows {
		return nil, false, nil
	}
	return data, err == nil, err
}

func (d *Database) Commit(token string, data []byte, expiry time.Time) error {
	tx, err := d.db.Begin()
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

func (d *Database) Delete(token string) error {
	_, err := d.db.Exec(`DELETE FROM sessions WHERE token=?`, tokenHash(token))
	return err
}

// CreateGrant persists provider credentials. Provider credentials stay in
// identity tables in the app database, never in cookies.
func (d *Database) CreateGrant(g store.Grant) error {
	data, err := json.Marshal(g)
	if err != nil {
		return err
	}
	tx, err := d.db.Begin()
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
		return store.ErrGrantRevoked
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

func (d *Database) FindGrant(id, issuer string) (store.Grant, error) {
	var g store.Grant
	var data []byte
	err := d.db.QueryRow(`SELECT data FROM identity_grants WHERE id=? AND issuer=? AND expiry>?`, id, issuer, time.Now().Unix()).Scan(&data)
	if errors.Is(err, sql.ErrNoRows) {
		return g, nil
	}
	if err != nil {
		return g, err
	}
	err = json.Unmarshal(data, &g)
	return g, err
}

func (d *Database) UpdateGrant(g store.Grant) error {
	data, err := json.Marshal(g)
	if err != nil {
		return err
	}
	result, err := d.db.Exec(`UPDATE identity_grants SET data=? WHERE id=? AND issuer=? AND expiry>?`,
		data, g.ID, g.Issuer, time.Now().Unix())
	if err != nil {
		return err
	}
	n, err := result.RowsAffected()
	if err != nil {
		return err
	}
	if n == 0 {
		return store.ErrGrantRevoked
	}
	return nil
}

func (d *Database) DeleteGrant(id, issuer string) error {
	_, err := d.db.Exec(`DELETE FROM identity_grants WHERE id=? AND issuer=?`, id, issuer)
	return err
}

// DeleteSubjectGrants ends every app session for a subject, for example after
// a password change. Provider tokens are already expired by Casdoor at that
// point; this keeps the local session list honest immediately instead of
// waiting for the next recheck to discard each grant lazily.
func (d *Database) DeleteSubjectGrants(issuer, subject string) error {
	_, err := d.db.Exec(`DELETE FROM identity_grants WHERE issuer=? AND subject=?`, issuer, subject)
	return err
}

func (d *Database) ListGrants(issuer, subject string) ([]store.Grant, error) {
	rows, err := d.db.Query(`SELECT data FROM identity_grants WHERE issuer=? AND subject=? AND expiry>?`, issuer, subject, time.Now().Unix())
	if err != nil {
		return nil, err
	}
	defer rows.Close()
	var out []store.Grant
	for rows.Next() {
		var data []byte
		if err := rows.Scan(&data); err != nil {
			return nil, err
		}
		var g store.Grant
		if err := json.Unmarshal(data, &g); err != nil {
			return nil, err
		}
		out = append(out, g)
	}
	return out, rows.Err()
}

// RevokeGrants records logout and deletes grants. Replay records and grant
// deletion share a transaction. Retries cannot revoke a later login twice,
// and a delayed callback cannot restore an older login.
func (d *Database) RevokeGrants(issuer, subject, sid, jti string, lifetime time.Duration) error {
	tx, err := d.db.Begin()
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

// RemoveGroupMemberships drops social group memberships after the provider
// confirms the account is gone. It delegates to the shared removal path so
// revocation and offline cleanup cannot diverge. It preserves app_accounts
// and private plans. Logout and password changes must not call this.
func (d *Database) RemoveGroupMemberships(issuer, subject string) error {
	if issuer == "" || subject == "" {
		return nil
	}
	return DeleteGroupMemberships(d.db, authorization.ActorKey(issuer, subject))
}
