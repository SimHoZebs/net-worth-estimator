package integration

import (
	"bytes"
	"context"
	"encoding/json"
	"io"
	"net/http"
	"net/http/httptest"
	"net/url"
	"strings"
	"testing"
	"time"

	"golang.org/x/oauth2"

	"github.com/simhozebs/net-worth-estimator/backend/internal/gmail"
)

type gmailFakeExchange struct {
	token *oauth2.Token
}

func (f *gmailFakeExchange) ExchangeCode(_ context.Context, code string) (*oauth2.Token, error) {
	if code == "" {
		return nil, context.DeadlineExceeded
	}
	return f.token, nil
}

func (f *gmailFakeExchange) Refresh(_ context.Context, _ string) (*oauth2.Token, error) {
	return f.token, nil
}

type gmailFakeTransport struct {
	revocations []string
}

func (f *gmailFakeTransport) RoundTrip(request *http.Request) (*http.Response, error) {
	if strings.HasSuffix(request.URL.Path, "/revoke") {
		body, _ := io.ReadAll(request.Body)
		values, _ := url.ParseQuery(string(body))
		f.revocations = append(f.revocations, values.Get("token"))
		return &http.Response{StatusCode: http.StatusOK, Body: http.NoBody, Header: http.Header{}}, nil
	}
	payload, _ := json.Marshal(map[string]string{"emailAddress": "reader@example.com"})
	return &http.Response{
		StatusCode: http.StatusOK,
		Body:       io.NopCloser(bytes.NewReader(payload)),
		Header:     http.Header{},
		Request:    request,
	}, nil
}

func newGmailTestService(transport *gmailFakeTransport) *gmail.Service {
	return gmail.New(gmail.Config{
		ClientID: "test-client", ClientSecret: "test-secret",
		RedirectURL:     "https://api.example/v1/integrations/gmail/callback",
		FrontendBaseURL: "https://app.example",
		Exchange: &gmailFakeExchange{token: &oauth2.Token{
			AccessToken: "access-test", RefreshToken: "refresh-test-secret",
			Expiry: time.Now().Add(time.Hour),
		}},
		HTTPClient: &http.Client{Transport: transport},
	})
}

type gmailCredentialPayload struct {
	Connected    bool   `json:"connected"`
	EmailAddress string `json:"emailAddress"`
	ConnectedAt  string `json:"connectedAt"`
	Scopes       string `json:"scopes"`
	LookbackDays int    `json:"lookbackDays"`
	LastScanAt   string `json:"lastScanAt"`
}

func getGmailCredential(t *testing.T, handler http.Handler) (int, gmailCredentialPayload) {
	t.Helper()
	response := httptest.NewRecorder()
	handler.ServeHTTP(response, httptest.NewRequest(http.MethodGet, "/v1/integrations/gmail/credential", nil))
	var payload gmailCredentialPayload
	if response.Code == http.StatusOK {
		if err := json.Unmarshal(response.Body.Bytes(), &payload); err != nil {
			t.Fatalf("decode gmail credential: %v", err)
		}
	}
	return response.Code, payload
}

func TestGmailCredentialDisconnectedByDefault(t *testing.T) {
	handler := New(openAPIStore(t), Config{})
	code, payload := getGmailCredential(t, handler)
	if code != http.StatusOK {
		t.Fatalf("credential status = %d, want 200", code)
	}
	if payload.Connected || payload.LookbackDays != 90 {
		t.Fatalf("payload = %+v, want disconnected with 90-day default", payload)
	}
}

func TestGmailMutationsNeedConfiguration(t *testing.T) {
	handler := New(openAPIStore(t), Config{})
	for _, request := range []*http.Request{
		httptest.NewRequest(http.MethodGet, "/v1/integrations/gmail/auth-url", nil),
		httptest.NewRequest(http.MethodDelete, "/v1/integrations/gmail/credential", nil),
		func() *http.Request {
			body := bytes.NewReader([]byte(`{"lookbackDays":45}`))
			r := httptest.NewRequest(http.MethodPut, "/v1/integrations/gmail/lookback", body)
			r.Header.Set("Content-Type", "application/json")
			return r
		}(),
	} {
		response := httptest.NewRecorder()
		handler.ServeHTTP(response, request)
		if response.Code != http.StatusServiceUnavailable {
			t.Fatalf("%s %s status = %d, want 503, body %s", request.Method, request.URL.Path, response.Code, response.Body.String())
		}
	}
}

func TestGmailConnectCallbackDisconnectFlow(t *testing.T) {
	transport := &gmailFakeTransport{}
	handler := New(openAPIStore(t), Config{GmailService: newGmailTestService(transport), GmailFrontendBaseURL: "https://app.example"})

	authResponse := httptest.NewRecorder()
	handler.ServeHTTP(authResponse, httptest.NewRequest(http.MethodGet, "/v1/integrations/gmail/auth-url", nil))
	if authResponse.Code != http.StatusOK {
		t.Fatalf("auth-url status = %d, body %s", authResponse.Code, authResponse.Body.String())
	}
	var authPayload struct {
		URL string `json:"url"`
	}
	if err := json.Unmarshal(authResponse.Body.Bytes(), &authPayload); err != nil {
		t.Fatalf("decode auth url: %v", err)
	}
	parsed, err := url.Parse(authPayload.URL)
	if err != nil {
		t.Fatalf("parse auth url: %v", err)
	}
	query := parsed.Query()
	if query.Get("scope") != "https://www.googleapis.com/auth/gmail.readonly" {
		t.Fatalf("scope = %q, want exactly readonly", query.Get("scope"))
	}
	if query.Get("state") == "" {
		t.Fatal("auth url carries no state")
	}

	callback := httptest.NewRecorder()
	handler.ServeHTTP(callback, httptest.NewRequest(http.MethodGet, "/v1/integrations/gmail/callback?code=auth-code&state="+query.Get("state"), nil))
	if callback.Code != http.StatusFound {
		t.Fatalf("callback status = %d, want 302, body %s", callback.Code, callback.Body.String())
	}
	location, err := url.Parse(callback.Header().Get("Location"))
	if err != nil {
		t.Fatalf("parse redirect: %v", err)
	}
	if location.Query().Get("gmail") != "connected" {
		t.Fatalf("redirect = %q, want gmail=connected", callback.Header().Get("Location"))
	}

	code, payload := getGmailCredential(t, handler)
	if code != http.StatusOK || !payload.Connected {
		t.Fatalf("credential = %+v, status %d, want connected", payload, code)
	}
	if payload.EmailAddress != "reader@example.com" || payload.ConnectedAt == "" || payload.Scopes == "" {
		t.Fatalf("payload = %+v, want account display, time, and scopes", payload)
	}

	lookback := httptest.NewRecorder()
	body := bytes.NewReader([]byte(`{"lookbackDays":45}`))
	lookbackRequest := httptest.NewRequest(http.MethodPut, "/v1/integrations/gmail/lookback", body)
	lookbackRequest.Header.Set("Content-Type", "application/json")
	handler.ServeHTTP(lookback, lookbackRequest)
	if lookback.Code != http.StatusOK {
		t.Fatalf("lookback status = %d, body %s", lookback.Code, lookback.Body.String())
	}
	var lookbackPayload gmailCredentialPayload
	if err := json.Unmarshal(lookback.Body.Bytes(), &lookbackPayload); err != nil {
		t.Fatalf("decode lookback: %v", err)
	}
	if lookbackPayload.LookbackDays != 45 {
		t.Fatalf("lookback = %+v, want 45 days", lookbackPayload)
	}

	badLookback := httptest.NewRecorder()
	badBody := bytes.NewReader([]byte(`{"lookbackDays":400}`))
	badRequest := httptest.NewRequest(http.MethodPut, "/v1/integrations/gmail/lookback", badBody)
	badRequest.Header.Set("Content-Type", "application/json")
	handler.ServeHTTP(badLookback, badRequest)
	if badLookback.Code != http.StatusBadRequest {
		t.Fatalf("bad lookback status = %d, want 400", badLookback.Code)
	}

	providers := getIntegrations(t, handler)
	var gmailEntry *integrationEntry
	for i := range providers {
		if providers[i].ID == "gmail" {
			gmailEntry = &providers[i]
		}
	}
	if gmailEntry == nil {
		t.Fatalf("providers = %+v, want a gmail entry", providers)
	}
	if !gmailEntry.Connected || gmailEntry.Detail != "reader@example.com" || gmailEntry.ConnectedAt == "" {
		t.Fatalf("gmail entry = %+v, want connected with account display", gmailEntry)
	}
	raw, err := json.Marshal(providers)
	if err != nil {
		t.Fatalf("marshal: %v", err)
	}
	if bytes.Contains(raw, []byte("refresh-test-secret")) || bytes.Contains(raw, []byte("access-test")) {
		t.Fatalf("integrations listing leaked a secret: %s", raw)
	}

	remove := httptest.NewRecorder()
	handler.ServeHTTP(remove, httptest.NewRequest(http.MethodDelete, "/v1/integrations/gmail/credential", nil))
	if remove.Code != http.StatusOK {
		t.Fatalf("disconnect status = %d, body %s", remove.Code, remove.Body.String())
	}
	if len(transport.revocations) != 1 || transport.revocations[0] != "refresh-test-secret" {
		t.Fatalf("revocations = %v, want the stored grant revoked", transport.revocations)
	}
	code, payload = getGmailCredential(t, handler)
	if code != http.StatusOK || payload.Connected {
		t.Fatalf("credential = %+v, status %d, want disconnected", payload, code)
	}
	if payload.LookbackDays != 45 {
		t.Fatalf("lookback after disconnect = %d, want kept 45", payload.LookbackDays)
	}
	raw, err = json.Marshal(payload)
	if err != nil {
		t.Fatalf("marshal: %v", err)
	}
	if bytes.Contains(raw, []byte("refresh-test-secret")) || bytes.Contains(raw, []byte("access-test")) {
		t.Fatalf("credential payload leaked a secret: %s", raw)
	}
}

func TestGmailCallbackRejectsForgedState(t *testing.T) {
	transport := &gmailFakeTransport{}
	handler := New(openAPIStore(t), Config{GmailService: newGmailTestService(transport), GmailFrontendBaseURL: "https://app.example"})

	callback := httptest.NewRecorder()
	handler.ServeHTTP(callback, httptest.NewRequest(http.MethodGet, "/v1/integrations/gmail/callback?code=auth-code&state=forged", nil))
	if callback.Code != http.StatusFound {
		t.Fatalf("callback status = %d, want 302", callback.Code)
	}
	location, err := url.Parse(callback.Header().Get("Location"))
	if err != nil {
		t.Fatalf("parse redirect: %v", err)
	}
	if location.Query().Get("gmail") != "error" {
		t.Fatalf("redirect = %q, want gmail=error", callback.Header().Get("Location"))
	}
	_, payload := getGmailCredential(t, handler)
	if payload.Connected {
		t.Fatalf("credential = %+v, want still disconnected", payload)
	}
}

func TestGmailWritesAreForbiddenInReadOnlyMode(t *testing.T) {
	transport := &gmailFakeTransport{}
	handler := New(openAPIStore(t), Config{GmailService: newGmailTestService(transport), GmailFrontendBaseURL: "https://app.example", ReadOnly: true})

	authResponse := httptest.NewRecorder()
	handler.ServeHTTP(authResponse, httptest.NewRequest(http.MethodGet, "/v1/integrations/gmail/auth-url", nil))
	if authResponse.Code != http.StatusForbidden {
		t.Fatalf("auth-url status = %d, want 403, body %s", authResponse.Code, authResponse.Body.String())
	}

	callback := httptest.NewRecorder()
	handler.ServeHTTP(callback, httptest.NewRequest(http.MethodGet, "/v1/integrations/gmail/callback?code=auth-code&state=whatever", nil))
	if callback.Code != http.StatusForbidden {
		t.Fatalf("callback status = %d, want 403", callback.Code)
	}

	// Reads stay available in read-only mode.
	if code, _ := getGmailCredential(t, handler); code != http.StatusOK {
		t.Fatalf("credential status = %d, want 200", code)
	}
}
