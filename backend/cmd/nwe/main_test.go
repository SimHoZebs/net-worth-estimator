package main

import (
	"encoding/json"
	"io"
	"net/http"
	"net/http/httptest"
	"os"
	"strings"
	"sync/atomic"
	"testing"
	"time"
)

type fakeDevice struct {
	approved atomic.Bool
	polls    atomic.Int64
}

func (f *fakeDevice) handler(t *testing.T) http.Handler {
	t.Helper()
	return http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		write := func(status int, payload map[string]any) {
			w.Header().Set("Content-Type", "application/json")
			w.WriteHeader(status)
			_ = json.NewEncoder(w).Encode(payload)
		}
		switch r.URL.Path {
		case "/v1/auth/device/start":
			write(http.StatusOK, map[string]any{"verificationUri": "https://id.test/device", "userCode": "USER-1", "deviceCode": "device-1", "expiresIn": 600, "interval": 1})
		case "/v1/auth/device/poll":
			var input struct {
				DeviceCode string `json:"deviceCode"`
			}
			_ = json.NewDecoder(r.Body).Decode(&input)
			if input.DeviceCode != "device-1" {
				write(http.StatusGone, map[string]any{"detail": "expired"})
				return
			}
			f.polls.Add(1)
			if !f.approved.Load() {
				write(http.StatusOK, map[string]any{"status": "pending"})
				return
			}
			write(http.StatusOK, map[string]any{"status": "complete", "subject": "editor", "accessToken": "access-1", "refreshToken": "refresh-1", "expiresIn": 3600})
		case "/v1/auth/device/refresh":
			var input struct {
				RefreshToken string `json:"refreshToken"`
			}
			_ = json.NewDecoder(r.Body).Decode(&input)
			if input.RefreshToken != "refresh-1" && input.RefreshToken != "refresh-2" {
				write(http.StatusUnauthorized, map[string]any{"detail": "invalid"})
				return
			}
			write(http.StatusOK, map[string]any{"status": "complete", "subject": "editor", "accessToken": "access-2", "refreshToken": "refresh-2", "expiresIn": 3600})
		case "/v1/auth/session":
			if r.Header.Get("Authorization") == "" {
				write(http.StatusUnauthorized, map[string]any{"detail": "auth"})
				return
			}
			write(http.StatusOK, map[string]any{"resource": map[string]any{"id": "accounts/test"}})
		case "/echo":
			write(http.StatusOK, map[string]any{"authorization": r.Header.Get("Authorization"), "resource": r.Header.Get("Waypoint-Resource")})
		default:
			write(http.StatusNotFound, map[string]any{"detail": "nope"})
		}
	})
}

func TestCLILoginCachesTokensAndResource(t *testing.T) {
	t.Setenv("XDG_CONFIG_HOME", t.TempDir())
	t.Setenv("NWE_API", "")
	fake := &fakeDevice{}
	fake.approved.Store(true)
	server := httptest.NewServer(fake.handler(t))
	defer server.Close()
	if err := run([]string{"login", "--api", server.URL}); err != nil {
		t.Fatal(err)
	}
	got, err := loadCredentials()
	if err != nil {
		t.Fatal(err)
	}
	if got.AccessToken != "access-1" || got.RefreshToken != "refresh-1" || got.Subject != "editor" || got.ResourceID != "accounts/test" {
		t.Fatalf("cached=%+v", got)
	}
	if got.Expiry.IsZero() {
		t.Fatal("missing expiry")
	}
}

func TestCLILoginRejectsSurplusArgs(t *testing.T) {
	t.Setenv("XDG_CONFIG_HOME", t.TempDir())
	if err := run([]string{"login", "oops"}); err == nil {
		t.Fatal("expected usage error")
	}
	if err := run([]string{"status", "oops"}); err == nil {
		t.Fatal("expected usage error")
	}
	if err := run([]string{"logout", "oops"}); err == nil {
		t.Fatal("expected usage error")
	}
	if err := run([]string{"api", "--api", "http://127.0.0.1:9", "GET", "/echo", "oops"}); err == nil {
		t.Fatal("expected usage error")
	}
}

func TestCLIAPIForwardsHeadersAndRefreshes(t *testing.T) {
	t.Setenv("XDG_CONFIG_HOME", t.TempDir())
	t.Setenv("NWE_API", "")
	fake := &fakeDevice{}
	fake.approved.Store(true)
	server := httptest.NewServer(fake.handler(t))
	defer server.Close()
	if err := run([]string{"login", "--api", server.URL}); err != nil {
		t.Fatal(err)
	}
	out := capture(t, func() {
		if err := run([]string{"api", "--api", server.URL, "GET", "/echo"}); err != nil {
			t.Fatal(err)
		}
	})
	if !strings.Contains(out, "Bearer access-1") || !strings.Contains(out, "accounts/test") {
		t.Fatalf("headers not forwarded: %s", out)
	}
}

func capture(t *testing.T, fn func()) string {
	t.Helper()
	old := os.Stdout
	reader, writer, err := os.Pipe()
	if err != nil {
		t.Fatal(err)
	}
	os.Stdout = writer
	defer func() { os.Stdout = old }()
	fn()
	_ = writer.Close()
	os.Stdout = old
	raw, _ := io.ReadAll(reader)
	return string(raw)
}

func TestTokenExpiryFloor(t *testing.T) {
	if got := tokenExpiry(0); time.Until(got) < time.Hour-5*time.Second {
		t.Fatalf("zero expiry=%v want ~1h floor", got)
	}
	if got := tokenExpiry(-5); time.Until(got) < time.Hour-5*time.Second {
		t.Fatalf("negative expiry=%v want ~1h floor", got)
	}
}

func TestCLIAPIRejectsRelativePath(t *testing.T) {
	t.Setenv("XDG_CONFIG_HOME", t.TempDir())
	if err := run([]string{"api", "GET", "v1/accounts"}); err == nil {
		t.Fatal("expected path error")
	}
}

func TestCLIApiRecoversStaleResource(t *testing.T) {
	t.Setenv("XDG_CONFIG_HOME", t.TempDir())
	t.Setenv("NWE_API", "")
	staleServer := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		if strings.HasSuffix(r.URL.Path, "/v1/auth/session") {
			w.Header().Set("Content-Type", "application/json")
			_, _ = w.Write([]byte(`{"resource":{"id":"accounts/fresh"}}`))
			return
		}
		w.Header().Set("Waypoint-Resource", "accounts/fresh")
		w.WriteHeader(http.StatusConflict)
	}))
	defer staleServer.Close()
	if err := saveCredentials(credentials{Subject: "editor", ResourceID: "accounts/stale", AccessToken: "access-1", RefreshToken: "refresh-1", Expiry: time.Now().Add(time.Hour)}); err != nil {
		t.Fatal(err)
	}
	if err := run([]string{"api", "--api", staleServer.URL, "GET", "/echo"}); err == nil {
		t.Fatal("expected final 409 without recovery path")
	}
	got, err := loadCredentials()
	if err != nil {
		t.Fatal(err)
	}
	if got.ResourceID != "accounts/fresh" {
		t.Fatalf("resource=%q want accounts/fresh", got.ResourceID)
	}
}
