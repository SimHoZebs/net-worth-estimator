package identity

import (
	"context"
	"github.com/simhozebs/net-worth-estimator/backend/internal/store"
	"net/http"
	"net/http/httptest"
	"os"
	"path/filepath"
	"testing"
	"time"

	"github.com/simhozebs/net-worth-estimator/backend/internal/store/adapters/sqlite"
)

func TestIdentityUsesSharedApplicationDatabaseAcrossRestart(t *testing.T) {
	p := newIDP(t)
	path := filepath.Join(t.TempDir(), "app.db")
	database, err := sqlite.SetupDatabase(path)
	if err != nil {
		t.Fatal(err)
	}
	defer database.Close()
	fallback := filepath.Join(t.TempDir(), "must-not-exist.db")
	s := newService(t, p, fallback, func(c *Config) { c.Store = database })
	if s.store.(*sqlite.Database) != database {
		t.Fatal("identity did not retain the shared connection")
	}
	server := httptest.NewServer(s.Wrap(http.HandlerFunc(func(w http.ResponseWriter, _ *http.Request) { w.WriteHeader(204) })))
	client := testClient(t)
	r := signIn(t, s, p, server, client, false)
	r.Body.Close()
	if r.StatusCode != http.StatusFound {
		t.Fatalf("sign in=%d", r.StatusCode)
	}
	g := currentGrant(t, s)
	for _, table := range []string{"sessions", "identity_grants", "identity_logout_marks", "identity_logout_tokens"} {
		var name string
		if err := database.SQL().QueryRow(`SELECT name FROM sqlite_master WHERE type='table' AND name=?`, table).Scan(&name); err != nil {
			t.Fatalf("shared table %s missing: %v", table, err)
		}
	}
	if err := s.store.Commit("storage-test-token", []byte("session data"), time.Now().Add(time.Hour)); err != nil {
		t.Fatal(err)
	}
	if err := s.store.RevokeGrants(p.server.URL, "revoked-user", "", "logout-token", time.Hour); err != nil {
		t.Fatal(err)
	}
	server.Close()
	if err := s.Close(); err != nil {
		t.Fatal(err)
	}
	if err := database.SQL().PingContext(context.Background()); err != nil {
		t.Fatalf("identity closed the application connection: %v", err)
	}
	if _, err := os.Stat(fallback); !os.IsNotExist(err) {
		t.Fatalf("identity opened fallback path with an injected connection: %v", err)
	}
	if err := database.Close(); err != nil {
		t.Fatal(err)
	}
	reopened, err := sqlite.OpenDatabase(path)
	if err != nil {
		t.Fatal(err)
	}
	defer reopened.Close()
	restarted := newService(t, p, "", func(c *Config) { c.Store = reopened })
	data, found, err := restarted.store.Find("storage-test-token")
	if err != nil || !found || string(data) != "session data" {
		t.Fatalf("session did not persist: data=%q found=%v err=%v", data, found, err)
	}
	persisted, err := restarted.store.FindGrant(g.ID, p.server.URL)
	if err != nil || persisted.Subject != g.Subject || persisted.AccessToken != g.AccessToken {
		t.Fatalf("grant did not persist: %+v %v", persisted, err)
	}
	var logoutToken string
	if err := reopened.SQL().QueryRow(`SELECT jti FROM identity_logout_tokens WHERE issuer=? AND jti=?`, p.server.URL, "logout-token").Scan(&logoutToken); err != nil {
		t.Fatalf("logout replay token did not persist: %v", err)
	}
	if err := restarted.store.CreateGrant(store.Grant{ID: "late-callback", Issuer: p.server.URL, Subject: "revoked-user", LoginStartedAt: time.Now().Add(-time.Hour).UnixNano(), Expiry: time.Now().Add(time.Hour).Unix()}); err != store.ErrGrantRevoked {
		t.Fatalf("logout mark did not block a delayed callback: %v", err)
	}
	restartedServer := httptest.NewServer(restarted.Wrap(http.HandlerFunc(func(w http.ResponseWriter, _ *http.Request) { w.WriteHeader(204) })))
	defer restartedServer.Close()
	if status := writeStatus(t, client, restartedServer.URL); status != 204 {
		t.Fatalf("persisted login status=%d", status)
	}
}

func TestIdentityStartupFailureDoesNotCloseSharedDatabase(t *testing.T) {
	database, err := sqlite.SetupDatabase(filepath.Join(t.TempDir(), "app.db"))
	if err != nil {
		t.Fatal(err)
	}
	defer database.Close()
	var provider *httptest.Server
	provider = httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, _ *http.Request) {
		respond(w, map[string]any{
			"issuer": provider.URL, "authorization_endpoint": provider.URL + "/authorize",
			"token_endpoint": provider.URL + "/token", "jwks_uri": provider.URL + "/jwks",
		})
	}))
	defer provider.Close()
	_, err = New(context.Background(), Config{
		Provider: "casdoor", Issuer: provider.URL, PublicURL: "http://localhost:8080",
		ClientID: "waypoint", ClientSecret: "secret", Store: database,
	})
	if err == nil {
		t.Fatal("identity accepted a provider without revocation support")
	}
	if err := database.SQL().Ping(); err != nil {
		t.Fatalf("failed identity startup closed the application connection: %v", err)
	}
}
