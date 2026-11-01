package gmail

import (
	"bytes"
	"context"
	"encoding/json"
	"errors"
	"io"
	"net/http"
	"net/url"
	"strings"
	"testing"
	"time"

	"golang.org/x/oauth2"

	"github.com/simhozebs/net-worth-estimator/backend/internal/authorization"
	"github.com/simhozebs/net-worth-estimator/backend/internal/store"
	"github.com/simhozebs/net-worth-estimator/backend/internal/store/adapters/sqlite"
)

type fakeExchange struct {
	codeToken    *oauth2.Token
	refreshToken *oauth2.Token
	exchangeErr  error
	refreshErr   error
	codes        []string
	refreshes    []string
}

func (f *fakeExchange) ExchangeCode(_ context.Context, code string) (*oauth2.Token, error) {
	f.codes = append(f.codes, code)
	if f.exchangeErr != nil {
		return nil, f.exchangeErr
	}
	return f.codeToken, nil
}

func (f *fakeExchange) Refresh(_ context.Context, refreshToken string) (*oauth2.Token, error) {
	f.refreshes = append(f.refreshes, refreshToken)
	if f.refreshErr != nil {
		return nil, f.refreshErr
	}
	return f.refreshToken, nil
}

type fakeRoundTripper struct {
	profileEmail string
	profileCode  int
	revocations  []string
}

func (f *fakeRoundTripper) RoundTrip(request *http.Request) (*http.Response, error) {
	if strings.HasSuffix(request.URL.Path, "/revoke") {
		body := make([]byte, 512)
		n, _ := request.Body.Read(body)
		values, _ := url.ParseQuery(string(body[:n]))
		f.revocations = append(f.revocations, values.Get("token"))
		return &http.Response{StatusCode: http.StatusOK, Body: http.NoBody, Header: http.Header{}}, nil
	}
	payload, _ := json.Marshal(map[string]string{"emailAddress": f.profileEmail})
	return &http.Response{
		StatusCode: f.profileCode,
		Body:       io.NopCloser(bytes.NewReader(payload)),
		Header:     http.Header{},
		Request:    request,
	}, nil
}

func openTestStore(t *testing.T, name string) (store.Store, *sqlite.Database) {
	t.Helper()
	database, err := sqlite.SetupDatabase(t.TempDir() + "/" + name + ".db")
	if err != nil {
		t.Fatalf("setup: %v", err)
	}
	t.Cleanup(func() { _ = database.Close() })
	userStore, err := database.EnsureUser(authorization.ActorKey("https://identity.example", name), "https://identity.example", name)
	if err != nil {
		t.Fatalf("ensure user %s: %v", name, err)
	}
	return userStore, database
}

func testService(exchange *fakeExchange, transport *fakeRoundTripper) *Service {
	return New(Config{
		ClientID: "test-client", ClientSecret: "test-secret",
		RedirectURL:     "https://api.example/v1/integrations/gmail/callback",
		FrontendBaseURL: "https://app.example",
		Exchange:        exchange,
		HTTPClient:      &http.Client{Transport: transport},
		Now:             func() time.Time { return time.Date(2026, 11, 1, 12, 0, 0, 0, time.UTC) },
	})
}

func TestUnconfiguredServiceReports503Shape(t *testing.T) {
	service := New(Config{})
	if service.Configured() {
		t.Fatal("empty config reports configured")
	}
	st, _ := openTestStore(t, "alice")
	if _, err := service.AuthURL(context.Background(), st); !errors.Is(err, ErrNotConfigured) {
		t.Fatalf("auth url err = %v, want not configured", err)
	}
	if _, err := service.Callback(context.Background(), st, "code", "state"); !errors.Is(err, ErrNotConfigured) {
		t.Fatalf("callback err = %v, want not configured", err)
	}
	if _, err := service.ValidToken(context.Background(), st); !errors.Is(err, ErrNotConfigured) {
		t.Fatalf("valid token err = %v, want not configured", err)
	}
}

func TestAuthURLCarriesReadonlyScopeAndState(t *testing.T) {
	exchange := &fakeExchange{}
	service := testService(exchange, &fakeRoundTripper{})
	st, _ := openTestStore(t, "alice")
	raw, err := service.AuthURL(context.Background(), st)
	if err != nil {
		t.Fatalf("auth url: %v", err)
	}
	parsed, err := url.Parse(raw)
	if err != nil {
		t.Fatalf("parse auth url: %v", err)
	}
	query := parsed.Query()
	if query.Get("scope") != ScopeReadonly {
		t.Fatalf("scope = %q, want exactly the readonly scope", query.Get("scope"))
	}
	if query.Get("access_type") != "offline" || query.Get("prompt") != "consent" || query.Get("response_type") != "code" {
		t.Fatalf("consent params = %v, want offline access with a consent prompt", query)
	}
	if query.Get("state") == "" {
		t.Fatal("auth url carries no state")
	}
	stored, err := st.GetGmailCredential()
	if err != nil {
		t.Fatalf("stored credential: %v", err)
	}
	if stored.PendingState != query.Get("state") || stored.RefreshToken != "" {
		t.Fatalf("stored = %+v, want pending state without a grant", stored)
	}
}

func TestCallbackConnectsAndClearsState(t *testing.T) {
	exchange := &fakeExchange{codeToken: &oauth2.Token{
		AccessToken: "access-1", RefreshToken: "refresh-1",
		Expiry: time.Date(2026, 11, 1, 13, 0, 0, 0, time.UTC),
	}}
	service := testService(exchange, &fakeRoundTripper{profileEmail: "alice@example.com", profileCode: http.StatusOK})
	st, _ := openTestStore(t, "alice")
	raw, err := service.AuthURL(context.Background(), st)
	if err != nil {
		t.Fatalf("auth url: %v", err)
	}
	parsed, _ := url.Parse(raw)
	connected, err := service.Callback(context.Background(), st, "auth-code-1", parsed.Query().Get("state"))
	if err != nil {
		t.Fatalf("callback: %v", err)
	}
	if !connected.Connected() || connected.EmailAddress != "alice@example.com" || connected.ConnectedAt == "" {
		t.Fatalf("connected = %+v, want account display and connection time", connected)
	}
	if connected.Scopes != ScopeReadonly {
		t.Fatalf("scopes = %q, want the readonly scope recorded", connected.Scopes)
	}
	stored, _ := st.GetGmailCredential()
	if stored.PendingState != "" {
		t.Fatalf("pending state = %q, want cleared after connect", stored.PendingState)
	}
	if stored.RefreshToken != "refresh-1" || stored.AccessToken != "access-1" {
		t.Fatalf("stored tokens changed shape: %+v", stored)
	}
}

func TestCallbackRejectsStateMismatchAndClearsNothingElse(t *testing.T) {
	exchange := &fakeExchange{codeToken: &oauth2.Token{AccessToken: "a", RefreshToken: "r", Expiry: time.Now().Add(time.Hour)}}
	service := testService(exchange, &fakeRoundTripper{profileEmail: "alice@example.com", profileCode: http.StatusOK})
	st, _ := openTestStore(t, "alice")
	if _, err := service.AuthURL(context.Background(), st); err != nil {
		t.Fatalf("auth url: %v", err)
	}
	if _, err := service.Callback(context.Background(), st, "auth-code-1", "forged-state"); !errors.Is(err, ErrInvalidState) {
		t.Fatalf("callback err = %v, want state mismatch", err)
	}
	if len(exchange.codes) != 0 {
		t.Fatalf("exchange ran %d times on forged state", len(exchange.codes))
	}
	stored, _ := st.GetGmailCredential()
	if stored.Connected() {
		t.Fatalf("stored = %+v, want still disconnected", stored)
	}
}

func TestCallbackFailsClosedWithoutRefreshToken(t *testing.T) {
	exchange := &fakeExchange{codeToken: &oauth2.Token{AccessToken: "a", Expiry: time.Now().Add(time.Hour)}}
	service := testService(exchange, &fakeRoundTripper{profileEmail: "alice@example.com", profileCode: http.StatusOK})
	st, _ := openTestStore(t, "alice")
	raw, _ := service.AuthURL(context.Background(), st)
	parsed, _ := url.Parse(raw)
	if _, err := service.Callback(context.Background(), st, "auth-code-1", parsed.Query().Get("state")); err == nil {
		t.Fatal("callback succeeded without a refresh token")
	}
	stored, _ := st.GetGmailCredential()
	if stored.Connected() {
		t.Fatalf("stored = %+v, want disconnected without a refresh token", stored)
	}
}

func TestValidTokenRefreshesServerSide(t *testing.T) {
	exchange := &fakeExchange{
		codeToken:    &oauth2.Token{AccessToken: "access-1", RefreshToken: "refresh-1", Expiry: time.Date(2026, 11, 1, 13, 0, 0, 0, time.UTC)},
		refreshToken: &oauth2.Token{AccessToken: "access-2", RefreshToken: "refresh-1", Expiry: time.Date(2026, 11, 1, 14, 0, 0, 0, time.UTC)},
	}
	service := testService(exchange, &fakeRoundTripper{profileEmail: "alice@example.com", profileCode: http.StatusOK})
	st, _ := openTestStore(t, "alice")
	raw, _ := service.AuthURL(context.Background(), st)
	parsed, _ := url.Parse(raw)
	if _, err := service.Callback(context.Background(), st, "code-1", parsed.Query().Get("state")); err != nil {
		t.Fatalf("callback: %v", err)
	}
	// Fresh access token passes through without a refresh call.
	token, err := service.ValidToken(context.Background(), st)
	if err != nil || token != "access-1" {
		t.Fatalf("token = %q, err %v", token, err)
	}
	if len(exchange.refreshes) != 0 {
		t.Fatalf("refreshed %d times for a fresh token", len(exchange.refreshes))
	}
	// Expire the access token; the service refreshes and persists rotation.
	if _, err := st.UpdateGmailToken("access-1", time.Date(2026, 11, 1, 12, 0, 30, 0, time.UTC).Unix(), ""); err != nil {
		t.Fatalf("expire token: %v", err)
	}
	token, err = service.ValidToken(context.Background(), st)
	if err != nil || token != "access-2" {
		t.Fatalf("token = %q, err %v, want refreshed", token, err)
	}
	if len(exchange.refreshes) != 1 || exchange.refreshes[0] != "refresh-1" {
		t.Fatalf("refreshes = %v, want one server-side refresh", exchange.refreshes)
	}
	stored, _ := st.GetGmailCredential()
	if stored.AccessToken != "access-2" {
		t.Fatalf("stored access = %q, want persisted rotation", stored.AccessToken)
	}
}

func TestDisconnectRevokesAndForgets(t *testing.T) {
	exchange := &fakeExchange{codeToken: &oauth2.Token{AccessToken: "a", RefreshToken: "refresh-gone", Expiry: time.Now().Add(time.Hour)}}
	transport := &fakeRoundTripper{profileEmail: "alice@example.com", profileCode: http.StatusOK}
	service := testService(exchange, transport)
	st, _ := openTestStore(t, "alice")
	raw, _ := service.AuthURL(context.Background(), st)
	parsed, _ := url.Parse(raw)
	if _, err := service.Callback(context.Background(), st, "code-1", parsed.Query().Get("state")); err != nil {
		t.Fatalf("callback: %v", err)
	}
	if _, err := service.SetLookback(context.Background(), st, 30); err != nil {
		t.Fatalf("lookback: %v", err)
	}
	if err := service.Disconnect(context.Background(), st); err != nil {
		t.Fatalf("disconnect: %v", err)
	}
	if len(transport.revocations) != 1 || transport.revocations[0] != "refresh-gone" {
		t.Fatalf("revocations = %v, want the stored grant revoked", transport.revocations)
	}
	cleared, _ := st.GetGmailCredential()
	if cleared.Connected() || cleared.EmailAddress != "" {
		t.Fatalf("cleared = %+v, want forgotten tokens and account", cleared)
	}
	if cleared.LookbackDays != 30 {
		t.Fatalf("lookback after disconnect = %d, want kept 30", cleared.LookbackDays)
	}
}

func TestLookbackValidation(t *testing.T) {
	service := testService(&fakeExchange{}, &fakeRoundTripper{})
	st, _ := openTestStore(t, "alice")
	for _, days := range []int{0, -7, MaxLookbackDays + 1} {
		if _, err := service.SetLookback(context.Background(), st, days); err == nil {
			t.Fatalf("lookback %d accepted", days)
		}
	}
	updated, err := service.SetLookback(context.Background(), st, 45)
	if err != nil || updated.LookbackDays != 45 {
		t.Fatalf("lookback = %+v, err %v", updated, err)
	}
}

func TestWindowInitialAndIncremental(t *testing.T) {
	now := time.Date(2026, 11, 1, 12, 0, 0, 0, time.UTC)
	initial := WindowFor(store.GmailCredential{LookbackDays: 90}, now)
	if initial.Incremental || initial.HistoryID != "" {
		t.Fatalf("initial = %+v, want full lookback scan", initial)
	}
	if got := now.Sub(initial.After); got != 90*24*time.Hour {
		t.Fatalf("initial after = %v, want 90 days back", initial.After)
	}
	defensive := WindowFor(store.GmailCredential{}, now)
	if defensive.After.IsZero() || now.Sub(defensive.After) != 90*24*time.Hour {
		t.Fatalf("zero lookback after = %v, want 90-day default", defensive.After)
	}
	next := WindowFor(store.GmailCredential{LookbackDays: 90, LastHistoryID: "history-9", LastScanAt: "2026-10-26T00:00:00Z"}, now)
	if !next.Incremental || next.HistoryID != "history-9" || !next.After.IsZero() {
		t.Fatalf("incremental = %+v, want cursor-bounded resumption", next)
	}
}

func TestUsersIsolateCredentialsInOneDatabase(t *testing.T) {
	exchange := &fakeExchange{codeToken: &oauth2.Token{AccessToken: "a", RefreshToken: "refresh-alice", Expiry: time.Now().Add(time.Hour)}}
	service := testService(exchange, &fakeRoundTripper{profileEmail: "alice@example.com", profileCode: http.StatusOK})
	alice, database := openTestStore(t, "alice")
	bob, err := database.EnsureUser(authorization.ActorKey("https://identity.example", "bob"), "https://identity.example", "bob")
	if err != nil {
		t.Fatalf("ensure bob: %v", err)
	}
	raw, _ := service.AuthURL(context.Background(), alice)
	parsed, _ := url.Parse(raw)
	if _, err := service.Callback(context.Background(), alice, "code-1", parsed.Query().Get("state")); err != nil {
		t.Fatalf("alice callback: %v", err)
	}
	bobCredential, err := bob.GetGmailCredential()
	if err != nil {
		t.Fatalf("bob credential: %v", err)
	}
	if bobCredential.Connected() {
		t.Fatalf("bob credential = %+v, want disconnected; alice's grant crossed users", bobCredential)
	}
	encoded, err := json.Marshal(bobCredential)
	if err != nil {
		t.Fatalf("marshal: %v", err)
	}
	if strings.Contains(string(encoded), "refresh-alice") {
		t.Fatalf("bob credential leaked alice's secret: %s", encoded)
	}
	if _, err := service.ValidToken(context.Background(), bob); !errors.Is(err, ErrNotConnected) {
		t.Fatalf("bob token err = %v, want not connected", err)
	}
}

func TestCallbackRejectsExpiredPendingState(t *testing.T) {
	exchange := &fakeExchange{codeToken: &oauth2.Token{AccessToken: "a", RefreshToken: "r", Expiry: time.Now().Add(time.Hour)}}
	service := testService(exchange, &fakeRoundTripper{profileEmail: "alice@example.com", profileCode: http.StatusOK})
	st, _ := openTestStore(t, "alice")
	raw, err := service.AuthURL(context.Background(), st)
	if err != nil {
		t.Fatalf("auth url: %v", err)
	}
	parsed, _ := url.Parse(raw)
	state := parsed.Query().Get("state")
	// Age the pending redirect past the TTL without touching the state.
	stored, err := st.GetGmailCredential()
	if err != nil {
		t.Fatalf("stored credential: %v", err)
	}
	if err := st.SetGmailPendingState(stored.PendingState, time.Date(2026, 11, 1, 12, 0, 0, 0, time.UTC).Add(-PendingStateTTL-time.Minute).Unix()); err != nil {
		t.Fatalf("age pending state: %v", err)
	}
	if _, err := service.Callback(context.Background(), st, "auth-code-1", state); !errors.Is(err, ErrInvalidState) {
		t.Fatalf("callback err = %v, want state mismatch for expired redirect", err)
	}
	if len(exchange.codes) != 0 {
		t.Fatalf("exchange ran %d times on expired state", len(exchange.codes))
	}
	cleared, _ := st.GetGmailCredential()
	if cleared.PendingState != "" || cleared.Connected() {
		t.Fatalf("stored = %+v, want cleared pending without a grant", cleared)
	}
}

func TestConsentNeedsFrontendReturnAddress(t *testing.T) {
	service := New(Config{
		ClientID: "test-client", ClientSecret: "test-secret",
		RedirectURL: "https://api.example/v1/integrations/gmail/callback",
		Exchange:    &fakeExchange{},
		Now:         func() time.Time { return time.Date(2026, 11, 1, 12, 0, 0, 0, time.UTC) },
	})
	st, _ := openTestStore(t, "alice")
	if _, err := service.AuthURL(context.Background(), st); !errors.Is(err, ErrNotConfigured) {
		t.Fatalf("auth url err = %v, want not configured without a return address", err)
	}
	if _, err := service.Callback(context.Background(), st, "code", "state"); !errors.Is(err, ErrNotConfigured) {
		t.Fatalf("callback err = %v, want not configured without a return address", err)
	}
}
