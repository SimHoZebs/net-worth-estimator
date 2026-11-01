package integrations

import (
	"context"
	"encoding/json"
	"path/filepath"
	"strings"
	"testing"

	"github.com/simhozebs/net-worth-estimator/backend/internal/authorization"
	"github.com/simhozebs/net-worth-estimator/backend/internal/gmail"
	"github.com/simhozebs/net-worth-estimator/backend/internal/store"
	"github.com/simhozebs/net-worth-estimator/backend/internal/store/adapters/sqlite"
)

func openGmailUserStore(t *testing.T, database *sqlite.Database, subject string) store.Store {
	t.Helper()
	userStore, err := database.EnsureUser(authorization.ActorKey("https://identity.example", subject), "https://identity.example", subject)
	if err != nil {
		t.Fatalf("ensure user %s: %v", subject, err)
	}
	return userStore
}

func unconfiguredGmailService() *gmail.Service {
	return gmail.New(gmail.Config{})
}

func TestGmailRegistryListsBothProviders(t *testing.T) {
	database, err := sqlite.SetupDatabase(filepath.Join(t.TempDir(), "registry.db"))
	if err != nil {
		t.Fatalf("setup: %v", err)
	}
	defer database.Close()
	userStore := openGmailUserStore(t, database, "alice")

	registry := NewRegistry(NewSimpleFIN(userStore, nil), NewGmail(userStore, nil))
	if ids := registry.IDs(); len(ids) != 2 || ids[0] != SimpleFINID || ids[1] != GmailID {
		t.Fatalf("IDs = %v, want [simplefin gmail]", ids)
	}
	entries, err := registry.Snapshot(context.Background())
	if err != nil {
		t.Fatalf("snapshot: %v", err)
	}
	if len(entries) != 2 || entries[1].ID != GmailID || entries[1].Connected {
		t.Fatalf("entries = %+v, want disconnected gmail second", entries)
	}
}

func TestGmailStatusConnectedReportsDisplayOnly(t *testing.T) {
	database, err := sqlite.SetupDatabase(filepath.Join(t.TempDir(), "connected.db"))
	if err != nil {
		t.Fatalf("setup: %v", err)
	}
	defer database.Close()
	userStore := openGmailUserStore(t, database, "alice")
	if _, err := userStore.ConnectGmail(store.GmailCredential{
		RefreshToken: "refresh-secret", AccessToken: "access-secret",
		AccessExpiryUnix: 2_000_000_000, EmailAddress: "alice@example.com", Scopes: "gmail.readonly",
	}); err != nil {
		t.Fatalf("connect: %v", err)
	}
	if _, err := userStore.SetGmailScanCursor("history-7", "2026-10-26T00:00:00Z"); err != nil {
		t.Fatalf("cursor: %v", err)
	}

	adapter := NewGmail(userStore, unconfiguredGmailService())
	if adapter.ID() != GmailID {
		t.Fatalf("ID = %q, want %q", adapter.ID(), GmailID)
	}
	status, err := adapter.Status(context.Background())
	if err != nil {
		t.Fatalf("status: %v", err)
	}
	if !status.Connected || status.Detail != "alice@example.com" || status.ConnectedAt == "" {
		t.Fatalf("status = %+v, want connected with account display", status)
	}
	if status.LastSyncAt != "2026-10-26T00:00:00Z" {
		t.Fatalf("status = %+v, want last scan time", status)
	}
	encoded, err := json.Marshal(status)
	if err != nil {
		t.Fatalf("marshal: %v", err)
	}
	if strings.Contains(string(encoded), "refresh-secret") || strings.Contains(string(encoded), "access-secret") {
		t.Fatalf("status snapshot leaked a secret: %s", encoded)
	}
}

func TestGmailStatusIsolatesUsersInOneDatabase(t *testing.T) {
	database, err := sqlite.SetupDatabase(filepath.Join(t.TempDir(), "shared.db"))
	if err != nil {
		t.Fatalf("setup: %v", err)
	}
	defer database.Close()
	const issuer = "https://identity.example"
	alice := openGmailUserStore(t, database, "alice")
	bob, err := database.EnsureUser(authorization.ActorKey(issuer, "bob"), issuer, "bob")
	if err != nil {
		t.Fatalf("ensure bob: %v", err)
	}
	if _, err := alice.ConnectGmail(store.GmailCredential{
		RefreshToken: "refresh-alice-secret", EmailAddress: "alice@example.com", Scopes: "gmail.readonly",
	}); err != nil {
		t.Fatalf("alice connect: %v", err)
	}

	aliceStatus, err := NewGmail(alice, nil).Status(context.Background())
	if err != nil {
		t.Fatalf("alice status: %v", err)
	}
	bobStatus, err := NewGmail(bob, nil).Status(context.Background())
	if err != nil {
		t.Fatalf("bob status: %v", err)
	}
	if !aliceStatus.Connected || aliceStatus.Detail != "alice@example.com" {
		t.Fatalf("alice status = %+v, want connected", aliceStatus)
	}
	if bobStatus.Connected || bobStatus.Detail != "" {
		t.Fatalf("bob status = %+v, want disconnected; grant crossed users", bobStatus)
	}
	encoded, err := json.Marshal(bobStatus)
	if err != nil {
		t.Fatalf("marshal: %v", err)
	}
	if strings.Contains(string(encoded), "refresh-alice-secret") {
		t.Fatalf("bob snapshot leaked alice's secret: %s", encoded)
	}
}
