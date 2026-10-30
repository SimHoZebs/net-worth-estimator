// Package contracts defines the identity API wire types without runtime dependencies.
package contracts

// Browser API wire contracts are shared by handlers and OpenAPI generation.
type Principal struct {
	Subject string `json:"subject"`
	Name    string `json:"name"`
	// Authenticated records a real browser or bearer login. Anonymous
	// requests carry the configured guest subject with Authenticated=false.
	// It never leaves the process as JSON.
	Authenticated bool `json:"-"`
}

type AccountProfile struct {
	Owner       string `json:"owner"`
	Name        string `json:"name"`
	DisplayName string `json:"displayName"`
	Avatar      string `json:"avatar"`
}

type AccountProfileUpdate struct {
	DisplayName *string `json:"displayName,omitempty"`
	Avatar      *string `json:"avatar,omitempty"`
}

type AccountPasswordChange struct {
	OldPassword string `json:"oldPassword"`
	NewPassword string `json:"newPassword"`
}

type SessionResource struct {
	ID          string   `json:"id"`
	Permissions []string `json:"permissions" nullable:"false"`
}

type SessionResponse struct {
	Enabled       bool            `json:"enabled"`
	Provider      string          `json:"provider"`
	Authenticated bool            `json:"authenticated"`
	Allowed       bool            `json:"allowed"`
	AccountURL    string          `json:"accountURL"`
	Resource      SessionResource `json:"resource"`
	User          Principal       `json:"user"`
}

type AccountSession struct {
	ID             string `json:"id"`
	Current        bool   `json:"current"`
	LoginStartedAt string `json:"loginStartedAt"`
	ExpiresAt      string `json:"expiresAt"`
}

type AccountSessions struct {
	Sessions []AccountSession `json:"sessions" nullable:"false"`
}

type AccountPasswordChanged struct {
	Reauth bool `json:"reauth"`
}

type AccountSessionRevoked struct {
	Revoked bool `json:"revoked"`
}

type LogoutResponse struct {
	LogoutURL string `json:"logoutURL"`
}
