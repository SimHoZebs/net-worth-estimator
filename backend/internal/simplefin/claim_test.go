package simplefin

import (
	"context"
	"encoding/base64"
	"net/http"
	"net/http/httptest"
	"net/url"
	"strings"
	"testing"
	"time"
)

func TestDecodeSetupTokenRoundTrip(t *testing.T) {
	claim := "https://bridge.example/simplefin/claim/abc123"
	token := base64.StdEncoding.EncodeToString([]byte(claim))
	decoded, err := DecodeSetupToken(token)
	if err != nil {
		t.Fatalf("decode: %v", err)
	}
	if decoded.String() != claim {
		t.Fatalf("claim = %q, want %q", decoded.String(), claim)
	}
}

func TestDecodeSetupTokenRejects(t *testing.T) {
	// Non-base64.
	if _, err := DecodeSetupToken("not-base64!!!"); err == nil {
		t.Fatal("expected base64 error")
	}
	// Valid base64 but non-https URL.
	httpToken := base64.StdEncoding.EncodeToString([]byte("http://bridge.example/claim/x"))
	if _, err := DecodeSetupToken(httpToken); err == nil {
		t.Fatal("expected https error")
	}
	// Empty.
	if _, err := DecodeSetupToken("  "); err == nil {
		t.Fatal("expected empty error")
	}
	// URL with embedded credentials.
	credToken := base64.StdEncoding.EncodeToString([]byte("https://user:pass@bridge.example/claim/x"))
	if _, err := DecodeSetupToken(credToken); err == nil {
		t.Fatal("expected userinfo error")
	}
}

func TestDecodeSetupTokenVariants(t *testing.T) {
	claim := "https://bridge.example/simplefin/claim/abc123"
	padded := base64.URLEncoding.EncodeToString([]byte(claim))
	if _, err := DecodeSetupToken("  " + padded + "\n"); err != nil {
		t.Fatalf("url encoding with whitespace: %v", err)
	}
	unpadded := base64.RawURLEncoding.EncodeToString([]byte(claim))
	if _, err := DecodeSetupToken(unpadded); err != nil {
		t.Fatalf("raw url encoding: %v", err)
	}
}

func TestClaimAccessURL(t *testing.T) {
	const accessURL = "https://user:pass@bridge.example/simplefin"
	server := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		if r.Method != http.MethodPost {
			t.Errorf("method = %s, want POST", r.Method)
		}
		_, _ = w.Write([]byte(accessURL + "\n"))
	}))
	t.Cleanup(server.Close)
	claimURL, err := url.Parse(server.URL + "/claim/x")
	if err != nil {
		t.Fatalf("parse claim URL: %v", err)
	}
	got, err := ClaimAccessURL(context.Background(), nil, claimURL)
	if err != nil {
		t.Fatalf("claim: %v", err)
	}
	if got != accessURL {
		t.Fatalf("access URL = %q, want %q", got, accessURL)
	}
}

func TestClaimAccessURLMapsServerErrors(t *testing.T) {
	for _, status := range []int{http.StatusBadRequest, http.StatusInternalServerError} {
		server := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, _ *http.Request) {
			w.WriteHeader(status)
		}))
		t.Cleanup(server.Close)
		claimURL, err := url.Parse(server.URL + "/claim/x")
		if err != nil {
			t.Fatalf("parse claim URL: %v", err)
		}
		if _, err := ClaimAccessURL(context.Background(), nil, claimURL); err == nil {
			t.Fatalf("status %d: expected error", status)
		}
	}
}

func TestClaimAccessURLRejectsBadBody(t *testing.T) {
	for _, body := range []string{"", "not-a-url", "http://bridge.example/simplefin"} {
		server := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, _ *http.Request) {
			_, _ = w.Write([]byte(body))
		}))
		t.Cleanup(server.Close)
		claimURL, err := url.Parse(server.URL + "/claim/x")
		if err != nil {
			t.Fatalf("parse claim URL: %v", err)
		}
		if _, err := ClaimAccessURL(context.Background(), nil, claimURL); err == nil {
			t.Fatalf("body %q: expected error", body)
		}
	}
}

func TestClaimTransportErrorHidesPath(t *testing.T) {
	claimURL, err := url.Parse("https://bridge.example/simplefin/claim/single-use-secret")
	if err != nil {
		t.Fatalf("parse claim URL: %v", err)
	}
	broken := &http.Client{Transport: roundTripError{err: errBridgeDown}}
	if _, err := ClaimAccessURL(context.Background(), broken, claimURL); err == nil {
		t.Fatal("expected transport error")
	} else if strings.Contains(err.Error(), "single-use-secret") {
		t.Fatalf("transport error leaked claim path: %q", err.Error())
	}
}

type roundTripError struct{ err error }

func (r roundTripError) RoundTrip(*http.Request) (*http.Response, error) { return nil, r.err }

func TestClaimAccessURLUsedToken(t *testing.T) {
	server := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, _ *http.Request) {
		w.WriteHeader(http.StatusForbidden)
	}))
	t.Cleanup(server.Close)
	claimURL, err := url.Parse(server.URL + "/claim/used")
	if err != nil {
		t.Fatalf("parse claim URL: %v", err)
	}
	if _, err := ClaimAccessURL(context.Background(), nil, claimURL); err == nil {
		t.Fatal("expected used-token error")
	} else if used, ok := err.(*ClaimUsedError); !ok {
		t.Fatalf("error = %T, want ClaimUsedError", used)
	} else if !strings.Contains(used.Error(), server.URL[len("https://"):]) && !strings.Contains(used.Error(), "used") {
		t.Fatalf("used error = %q", used.Error())
	}
}

func TestParseAccessURL(t *testing.T) {
	if _, err := ParseAccessURL("https://user:pass@bridge.example/simplefin"); err != nil {
		t.Fatalf("valid access URL: %v", err)
	}
	if _, err := ParseAccessURL("http://bridge.example/simplefin"); err == nil {
		t.Fatal("expected https-only error")
	}
}

func TestDynamicRunnerUsesStoredCredential(t *testing.T) {
	database := openRunnerStore(t)
	seedRunnerAccounts(t, database)
	if _, err := database.SetSyncCredential("https://user:pass@bridge.example/simplefin", "bridge.example"); err != nil {
		t.Fatalf("store credential: %v", err)
	}
	runner := NewRunnerWithProvider(database, Config{}, func() (string, map[string]struct{}) {
		credential, err := database.GetSyncCredential()
		if err != nil {
			return "", nil
		}
		return credential.AccessURL, nil
	}, nil)
	if !runner.IsConfigured() {
		t.Fatal("runner should be configured after storing credential")
	}
	if got := runner.BridgeHost(); got != "bridge.example" {
		t.Fatalf("host = %q, want bridge.example", got)
	}
}

func TestFetchWithoutCredentialIsNotConfigured(t *testing.T) {
	database := openRunnerStore(t)
	runner := NewRunnerWithProvider(database, Config{}, func() (string, map[string]struct{}) {
		return "", nil
	}, nil)
	if runner.IsConfigured() {
		t.Fatal("empty credential should not be configured")
	}
	if _, err := runner.fetchWithCredential(context.Background(), nowFunc(), nowFunc()); err == nil {
		t.Fatal("expected NotConfiguredError")
	} else if _, ok := err.(*NotConfiguredError); !ok {
		t.Fatalf("error = %T, want NotConfiguredError", err)
	}
}

func TestEffectiveCardsComeFromProvider(t *testing.T) {
	database := openRunnerStore(t)
	runner := NewRunnerWithProvider(database, Config{}, func() (string, map[string]struct{}) {
		return "https://user:pass@bridge.example/simplefin", map[string]struct{}{"db_card": {}}
	}, nil)
	merged := runner.effectiveCards()
	if len(merged) != 1 {
		t.Fatalf("merged = %+v, want only db_card", merged)
	}
	if _, ok := merged["db_card"]; !ok {
		t.Fatalf("merged = %+v, want db_card", merged)
	}
}

func TestNilRunnerIsUnconfigured(t *testing.T) {
	var runner *Runner
	if runner.IsConfigured() {
		t.Fatal("nil runner should not be configured")
	}
	if runner.BridgeHost() != "" {
		t.Fatal("nil runner host should be empty")
	}
}

func TestNewRunnerClientDrivesStatus(t *testing.T) {
	database := openRunnerStore(t)
	runner := NewRunner(database, Config{}, &Client{AccessURL: "https://user:pass@bridge.example/simplefin"})
	if !runner.IsConfigured() {
		t.Fatal("client-backed runner should be configured")
	}
	if got := runner.BridgeHost(); got != "bridge.example" {
		t.Fatalf("host = %q, want bridge.example", got)
	}
}

func nowFunc() (t time.Time) { return time.Now() }
