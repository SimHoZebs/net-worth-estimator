// Package gmail owns the Gmail read-only OAuth connection (INT-02):
// explicit scoped consent, server-side token storage and refresh, a
// configurable initial lookback (default 90 days), and the incremental
// scan cursor. It never fetches message bodies: receipt discovery runs in
// INT-03 through short-lived access tokens from this package. Secrets
// (refresh and access tokens, pending OAuth state) stay in the per-user
// store row and never enter API payloads or logs.
package gmail

import (
	"context"
	"crypto/rand"
	"crypto/subtle"
	"encoding/base64"
	"encoding/json"
	"fmt"
	"net/http"
	"net/url"
	"strings"
	"time"

	"golang.org/x/oauth2"
	"golang.org/x/oauth2/google"

	"github.com/simhozebs/net-worth-estimator/backend/internal/store"
)

// ScopeReadonly is the only Gmail scope the product requests. Message
// metadata and bodies are readable; nothing is ever sent, deleted, or
// relabeled, and Drive/Contacts/Calendar scopes are never requested.
const ScopeReadonly = "https://www.googleapis.com/auth/gmail.readonly"

// MaxLookbackDays bounds the configurable initial scan window.
const MaxLookbackDays = 365

// PendingStateTTL bounds an outstanding authorization redirect. A stale
// pending state stays valid only briefly so a leaked or replayed
// authorization response cannot complete consent long after the user
// walked away.
const PendingStateTTL = 10 * time.Minute

// Config wires the Google OAuth client. ClientID, ClientSecret, and
// RedirectURL come from the environment; empty credentials leave the
// service unconfigured and consent endpoints report 503, matching the
// SimpleFIN unconfigured behavior. Test hooks replace the network.
type Config struct {
	ClientID     string
	ClientSecret string
	// RedirectURL is the backend OAuth callback Google redirects to.
	RedirectURL string
	// FrontendBaseURL receives the post-callback redirect with the
	// connection outcome as query parameters.
	FrontendBaseURL string
	// Exchange swaps an authorization code or refresh token for tokens.
	// The default uses the Google token endpoint over HTTPClient.
	Exchange Exchanger
	// HTTPClient carries token-adjacent Google calls (profile lookup,
	// revocation). Tests substitute a fake transport.
	HTTPClient *http.Client
	// Now reports the current time. Tests substitute a fixed clock.
	Now func() time.Time
}

// Exchanger swaps authorization codes and refresh tokens and revokes
// grants. The production implementation is oauth2 over HTTPS; tests fake it.
type Exchanger interface {
	ExchangeCode(ctx context.Context, code string) (*oauth2.Token, error)
	Refresh(ctx context.Context, refreshToken string) (*oauth2.Token, error)
}

func (c Config) now() time.Time {
	if c.Now != nil {
		return c.Now()
	}
	return time.Now()
}

func (c Config) client() *http.Client {
	if c.HTTPClient != nil {
		return c.HTTPClient
	}
	return http.DefaultClient
}

// Service is the stateless Gmail connection facade. Every method takes the
// calling user's scoped store, so credentials never cross users.
type Service struct {
	config Config
	oauth  oauth2.Config
}

// New builds the service. A config without client credentials is valid:
// consent endpoints then report unconfigured until the operator provides them.
func New(config Config) *Service {
	if config.Exchange == nil {
		config.Exchange = &oauthExchange{config: config}
	}
	return &Service{
		config: config,
		oauth: oauth2.Config{
			ClientID:     config.ClientID,
			ClientSecret: config.ClientSecret,
			RedirectURL:  config.RedirectURL,
			Scopes:       []string{ScopeReadonly},
			Endpoint:     google.Endpoint,
		},
	}
}

// Configured reports whether the operator provided OAuth client credentials.
func (s *Service) Configured() bool {
	return s != nil && s.config.ClientID != "" && s.config.ClientSecret != "" && s.config.RedirectURL != ""
}

// oauthExchange is the production Exchanger over the Google token endpoint.
type oauthExchange struct {
	config Config
}

func (e *oauthExchange) ExchangeCode(ctx context.Context, code string) (*oauth2.Token, error) {
	config := oauth2.Config{
		ClientID: e.config.ClientID, ClientSecret: e.config.ClientSecret,
		RedirectURL: e.config.RedirectURL, Scopes: []string{ScopeReadonly}, Endpoint: google.Endpoint,
	}
	return config.Exchange(oauthContext(ctx, e.config), code)
}

func (e *oauthExchange) Refresh(ctx context.Context, refreshToken string) (*oauth2.Token, error) {
	config := oauth2.Config{
		ClientID: e.config.ClientID, ClientSecret: e.config.ClientSecret,
		RedirectURL: e.config.RedirectURL, Scopes: []string{ScopeReadonly}, Endpoint: google.Endpoint,
	}
	return config.TokenSource(oauthContext(ctx, e.config), &oauth2.Token{RefreshToken: refreshToken}).Token()
}

func oauthContext(ctx context.Context, config Config) context.Context {
	if config.HTTPClient != nil {
		return context.WithValue(ctx, oauth2.HTTPClient, config.HTTPClient)
	}
	return ctx
}

// AuthURL starts explicit scoped consent: it records CSRF state on the
// user's row and returns the Google authorization URL carrying exactly the
// read-only scope with offline access (refresh token) and a consent
// prompt, so re-connects re-confirm the account and scope.
func (s *Service) AuthURL(ctx context.Context, st store.Store) (string, error) {
	if s == nil || !s.Configured() {
		return "", ErrNotConfigured
	}
	if strings.TrimSpace(s.config.FrontendBaseURL) == "" {
		return "", fmt.Errorf("%w: no frontend return address configured", ErrNotConfigured)
	}
	state, err := newState()
	if err != nil {
		return "", err
	}
	if err := st.SetGmailPendingState(state, s.config.now().Unix()); err != nil {
		return "", err
	}
	return s.oauth.AuthCodeURL(state,
		oauth2.AccessTypeOffline,
		oauth2.SetAuthURLParam("prompt", "consent"),
		oauth2.SetAuthURLParam("scope", ScopeReadonly),
	), nil
}

func newState() (string, error) {
	raw := make([]byte, 32)
	if _, err := rand.Read(raw); err != nil {
		return "", fmt.Errorf("generate oauth state: %w", err)
	}
	return base64.RawURLEncoding.EncodeToString(raw), nil
}

// Callback completes consent: it validates the CSRF state, exchanges the
// code, resolves the consented account for display, and stores the grant.
// A consumed or expired pending state clears; a mismatched state is
// rejected without clearing so a forged callback cannot wipe an in-flight
// flow, and the code never reaches the exchange.
func (s *Service) Callback(ctx context.Context, st store.Store, code, state string) (store.GmailCredential, error) {
	if s == nil || !s.Configured() {
		return store.GmailCredential{}, ErrNotConfigured
	}
	if strings.TrimSpace(s.config.FrontendBaseURL) == "" {
		return store.GmailCredential{}, fmt.Errorf("%w: no frontend return address configured", ErrNotConfigured)
	}
	credential, err := st.GetGmailCredential()
	if err != nil {
		return store.GmailCredential{}, err
	}
	if credential.PendingState == "" || subtle.ConstantTimeCompare([]byte(state), []byte(credential.PendingState)) != 1 {
		return store.GmailCredential{}, ErrInvalidState
	}
	// Expire stale authorization redirects: a pending state older than
	// the TTL cannot complete consent. It clears like a consumed state
	// so the user starts a fresh redirect.
	if credential.PendingAtUnix <= 0 || s.config.now().Unix()-credential.PendingAtUnix > int64(PendingStateTTL.Seconds()) {
		if err := st.SetGmailPendingState("", 0); err != nil {
			return store.GmailCredential{}, err
		}
		return store.GmailCredential{}, ErrInvalidState
	}
	// Clear the pending state before the exchange so a replayed callback
	// fails closed even if the first exchange succeeded.
	if err := st.SetGmailPendingState("", 0); err != nil {
		return store.GmailCredential{}, err
	}
	if strings.TrimSpace(code) == "" {
		return store.GmailCredential{}, fmt.Errorf("gmail callback: missing authorization code")
	}
	token, err := s.config.Exchange.ExchangeCode(ctx, code)
	if err != nil {
		return store.GmailCredential{}, fmt.Errorf("gmail token exchange: %w", err)
	}
	if token.RefreshToken == "" {
		return store.GmailCredential{}, fmt.Errorf("gmail token exchange: provider returned no refresh token")
	}
	email, err := s.profileEmail(ctx, token.AccessToken)
	if err != nil {
		return store.GmailCredential{}, err
	}
	return st.ConnectGmail(store.GmailCredential{
		RefreshToken: token.RefreshToken, AccessToken: token.AccessToken,
		AccessExpiryUnix: token.Expiry.Unix(), EmailAddress: email, Scopes: ScopeReadonly,
	})
}

// profileEmail resolves the consented account for display. The address is
// the only message-adjacent value INT-02 keeps; bodies and metadata stay
// unfetched until INT-03 scans with a short-lived access token.
func (s *Service) profileEmail(ctx context.Context, accessToken string) (string, error) {
	request, err := http.NewRequestWithContext(ctx, http.MethodGet, "https://www.googleapis.com/gmail/v1/users/me/profile", nil)
	if err != nil {
		return "", err
	}
	request.Header.Set("Authorization", "Bearer "+accessToken)
	response, err := s.config.client().Do(request)
	if err != nil {
		return "", fmt.Errorf("gmail profile: %w", err)
	}
	defer response.Body.Close()
	if response.StatusCode != http.StatusOK {
		return "", fmt.Errorf("gmail profile: unexpected status %d", response.StatusCode)
	}
	var profile struct {
		EmailAddress string `json:"emailAddress"`
	}
	if err := json.NewDecoder(response.Body).Decode(&profile); err != nil {
		return "", fmt.Errorf("gmail profile: %w", err)
	}
	if strings.TrimSpace(profile.EmailAddress) == "" {
		return "", fmt.Errorf("gmail profile: missing account address")
	}
	return profile.EmailAddress, nil
}

// Disconnect revokes the grant at Google (best-effort: revocation failure
// never blocks the local disconnect) and forgets the user's tokens,
// account display, and scan cursor.
func (s *Service) Disconnect(ctx context.Context, st store.Store) error {
	credential, err := st.GetGmailCredential()
	if err != nil {
		return err
	}
	if credential.RefreshToken != "" {
		_ = s.revoke(ctx, credential.RefreshToken)
	}
	return st.ClearGmailCredential()
}

func (s *Service) revoke(ctx context.Context, token string) error {
	form := url.Values{"token": {token}}
	request, err := http.NewRequestWithContext(ctx, http.MethodPost, "https://oauth2.googleapis.com/revoke", strings.NewReader(form.Encode()))
	if err != nil {
		return err
	}
	request.Header.Set("Content-Type", "application/x-www-form-urlencoded")
	response, err := s.config.client().Do(request)
	if err != nil {
		return err
	}
	defer response.Body.Close()
	if response.StatusCode != http.StatusOK {
		return fmt.Errorf("revoke: unexpected status %d", response.StatusCode)
	}
	return nil
}

// ValidToken returns a usable access token, refreshing server-side when
// the stored one is missing or within a minute of expiry. Rotation
// persists before return so concurrent scans share the new grant.
func (s *Service) ValidToken(ctx context.Context, st store.Store) (string, error) {
	if s == nil || !s.Configured() {
		return "", ErrNotConfigured
	}
	credential, err := st.GetGmailCredential()
	if err != nil {
		return "", err
	}
	if !credential.Connected() {
		return "", ErrNotConnected
	}
	if credential.AccessToken != "" && s.config.now().Add(time.Minute).Unix() < credential.AccessExpiryUnix {
		return credential.AccessToken, nil
	}
	token, err := s.config.Exchange.Refresh(ctx, credential.RefreshToken)
	if err != nil {
		return "", fmt.Errorf("gmail token refresh: %w", err)
	}
	if token.AccessToken == "" {
		return "", fmt.Errorf("gmail token refresh: provider returned no access token")
	}
	updated, err := st.UpdateGmailToken(token.AccessToken, token.Expiry.Unix(), token.RefreshToken)
	if err != nil {
		return "", err
	}
	return updated.AccessToken, nil
}

// SetLookback stores the configurable initial scan window in days.
func (s *Service) SetLookback(_ context.Context, st store.Store, days int) (store.GmailCredential, error) {
	if days < 1 || days > MaxLookbackDays {
		return store.GmailCredential{}, fmt.Errorf("gmail lookback: days must be between 1 and %d", MaxLookbackDays)
	}
	return st.SetGmailLookback(days)
}

// ScanWindow derives the next scan range for INT-03: the first scan looks
// back LookbackDays from now; later scans resume incrementally from the
// stored history cursor and never re-read the initial window.
type ScanWindow struct {
	// Incremental reports whether the scan resumes from a cursor.
	Incremental bool
	// HistoryID carries the stored Gmail history cursor for incremental
	// scans, empty for the initial scan.
	HistoryID string
	// After bounds the initial scan window (now minus lookback). It is
	// zero for incremental scans, which the history cursor bounds instead.
	After time.Time
}

// WindowFor derives the scan window from stored connection state without
// network access, so INT-03 can plan scans offline in tests.
func WindowFor(credential store.GmailCredential, now time.Time) ScanWindow {
	if credential.LastHistoryID != "" {
		return ScanWindow{Incremental: true, HistoryID: credential.LastHistoryID}
	}
	lookback := credential.LookbackDays
	if lookback <= 0 {
		lookback = store.DefaultGmailLookbackDays
	}
	return ScanWindow{After: now.AddDate(0, 0, -lookback)}
}

// Window loads the calling user's stored state and derives its scan window.
func (s *Service) Window(_ context.Context, st store.Store) (ScanWindow, error) {
	credential, err := st.GetGmailCredential()
	if err != nil {
		return ScanWindow{}, err
	}
	return WindowFor(credential, s.config.now()), nil
}
