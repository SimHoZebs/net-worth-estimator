package store

import (
	"errors"
	"time"
)

// ErrGrantRevoked reports a provider grant was revoked.
var ErrGrantRevoked = errors.New("provider grant was revoked")

// Grant is provider credentials stored in identity tables in the app
// database, never in cookies. An application session holds only an opaque
// grant reference.
type Grant struct {
	ID, Issuer, Subject, SID, Name, Nonce string
	AccessToken, RefreshToken, IDToken    string
	LoginStartedAt, TokenExpiry           int64
	CheckedAt, Expiry                     int64
}

// IdentityStore is the persistence seam for sessions and provider grants.
// Backends implement these methods. The identity service depends only on
// this interface, never on SQL, files, or driver handles.
type IdentityStore interface {
	Find(token string) ([]byte, bool, error)
	Commit(token string, data []byte, expiry time.Time) error
	Delete(token string) error
	CreateGrant(g Grant) error
	FindGrant(id, issuer string) (Grant, error)
	UpdateGrant(g Grant) error
	DeleteGrant(id, issuer string) error
	DeleteSubjectGrants(issuer, subject string) error
	ListGrants(issuer, subject string) ([]Grant, error)
	RevokeGrants(issuer, subject, sid, jti string, lifetime time.Duration) error
	RemoveGroupMemberships(issuer, subject string) error
}
