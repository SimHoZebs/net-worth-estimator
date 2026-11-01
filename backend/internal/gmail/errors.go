package gmail

import "errors"

// ErrNotConfigured reports a Gmail request before the operator provides
// OAuth client credentials.
var ErrNotConfigured = errors.New("gmail is not configured")

// ErrNotConnected reports a Gmail request before the user connects.
var ErrNotConnected = errors.New("gmail is not connected")

// ErrInvalidState reports an OAuth callback whose state does not match the
// outstanding authorization redirect.
var ErrInvalidState = errors.New("gmail authorization state mismatch")
