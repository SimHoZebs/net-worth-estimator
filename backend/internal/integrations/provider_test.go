package integrations

import (
	"context"
	"encoding/json"
	"path/filepath"
	"strings"
	"testing"

	"github.com/simhozebs/net-worth-estimator/backend/internal/authorization"
	"github.com/simhozebs/net-worth-estimator/backend/internal/simplefin"
	"github.com/simhozebs/net-worth-estimator/backend/internal/store"
	"github.com/simhozebs/net-worth-estimator/backend/internal/store/adapters/sqlite"
)

func TestRegistrySnapshotListsProvidersInOrder(t *testing.T) {
	registry := NewRegistry(staticProvider{id: "b"}, staticProvider{id: "a"})
	entries, err := registry.Snapshot(context.Background())
	if err != nil {
		t.Fatalf("snapshot: %v", err)
	}
	if len(entries) != 2 || entries[0].ID != "b" || entries[1].ID != "a" {
		t.Fatalf("entries = %+v, want [b a] in registration order", entries)
	}
	if got := registry.IDs(); len(got) != 2 || got[0] != "b" || got[1] != "a" {
		t.Fatalf("IDs = %v, want [b a]", got)
	}
}

func TestNilRegistrySnapshotsEmpty(t *testing.T) {
	var registry *Registry
	entries, err := registry.Snapshot(context.Background())
	if err != nil {
		t.Fatalf("snapshot: %v", err)
	}
	if len(entries) != 0 {
		t.Fatalf("entries = %+v, want empty", entries)
	}
	if ids := registry.IDs(); len(ids) != 0 {
		t.Fatalf("IDs = %v, want empty", ids)
	}
}

type staticProvider struct {
	id     string
	status Status
}

func (p staticProvider) ID() string { return p.id }

func (p staticProvider) Status(context.Context) (Status, error) { return p.status, nil }

func openUserStore(t *testing.T, database *sqlite.Database, issuer, subject string) store.Store {
	t.Helper()
	userStore, err := database.EnsureUser(authorization.ActorKey(issuer, subject), issuer, subject)
	if err != nil {
		t.Fatalf("ensure user %s: %v", subject, err)
	}
	return userStore
}

func credentialProvider(userStore store.Store) simplefin.CredentialProvider {
	return func() (string, map[string]struct{}) {
		credential, err := userStore.GetSyncCredential()
		if err != nil {
			return "", nil
		}
		return credential.AccessURL, nil
	}
}

func TestSimpleFINStatusDisconnected(t *testing.T) {
	database, err := sqlite.SetupDatabase(filepath.Join(t.TempDir(), "disconnected.db"))
	if err != nil {
		t.Fatalf("setup: %v", err)
	}
	defer database.Close()
	userStore := openUserStore(t, database, "https://identity.example", "alice")
	runner := simplefin.NewRunnerWithProvider(userStore, simplefin.Config{}, credentialProvider(userStore), nil)

	status, err := NewSimpleFIN(userStore, runner).Status(context.Background())
	if err != nil {
		t.Fatalf("status: %v", err)
	}
	if status.Connected || status.SyncConfigured || status.LastSyncAt != "" || status.Detail != "" || status.ConnectedAt != "" {
		t.Fatalf("status = %+v, want disconnected and empty", status)
	}
}

func TestSimpleFINStatusConnectedReportsDisplayOnly(t *testing.T) {
	database, err := sqlite.SetupDatabase(filepath.Join(t.TempDir(), "connected.db"))
	if err != nil {
		t.Fatalf("setup: %v", err)
	}
	defer database.Close()
	userStore := openUserStore(t, database, "https://identity.example", "alice")
	const accessURL = "https://alice-secret@bridge.example/simplefin"
	if _, err := userStore.SetSyncCredential(accessURL, "bridge.example"); err != nil {
		t.Fatalf("connect: %v", err)
	}
	if err := userStore.SetLastSyncTime("2026-10-26T00:00:00Z"); err != nil {
		t.Fatalf("stamp sync: %v", err)
	}
	runner := simplefin.NewRunnerWithProvider(userStore, simplefin.Config{}, credentialProvider(userStore), nil)

	adapter := NewSimpleFIN(userStore, runner)
	if adapter.ID() != SimpleFINID {
		t.Fatalf("ID = %q, want %q", adapter.ID(), SimpleFINID)
	}
	status, err := adapter.Status(context.Background())
	if err != nil {
		t.Fatalf("status: %v", err)
	}
	if !status.Connected || !status.SyncConfigured {
		t.Fatalf("status = %+v, want connected and configured", status)
	}
	if status.LastSyncAt != "2026-10-26T00:00:00Z" || status.Detail != "bridge.example" || status.ConnectedAt == "" {
		t.Fatalf("status = %+v, want sync time, host detail, and connection time", status)
	}
	encoded, err := json.Marshal(status)
	if err != nil {
		t.Fatalf("marshal: %v", err)
	}
	if strings.Contains(string(encoded), "alice-secret") {
		t.Fatalf("status snapshot leaked the secret: %s", encoded)
	}
}

func TestSimpleFINStatusIsolatesUsersInOneDatabase(t *testing.T) {
	database, err := sqlite.SetupDatabase(filepath.Join(t.TempDir(), "shared.db"))
	if err != nil {
		t.Fatalf("setup: %v", err)
	}
	defer database.Close()
	const issuer = "https://identity.example"
	alice := openUserStore(t, database, issuer, "alice")
	bob := openUserStore(t, database, issuer, "bob")

	const accessURL = "https://alice-secret@bridge.example/simplefin"
	if _, err := alice.SetSyncCredential(accessURL, "bridge.example"); err != nil {
		t.Fatalf("alice connect: %v", err)
	}
	if err := alice.SetLastSyncTime("2026-10-26T00:00:00Z"); err != nil {
		t.Fatalf("alice stamp: %v", err)
	}

	aliceRunner := simplefin.NewRunnerWithProvider(alice, simplefin.Config{}, credentialProvider(alice), nil)
	bobRunner := simplefin.NewRunnerWithProvider(bob, simplefin.Config{}, credentialProvider(bob), nil)
	aliceStatus, err := NewSimpleFIN(alice, aliceRunner).Status(context.Background())
	if err != nil {
		t.Fatalf("alice status: %v", err)
	}
	bobStatus, err := NewSimpleFIN(bob, bobRunner).Status(context.Background())
	if err != nil {
		t.Fatalf("bob status: %v", err)
	}
	if !aliceStatus.Connected || aliceStatus.LastSyncAt == "" {
		t.Fatalf("alice status = %+v, want connected with sync time", aliceStatus)
	}
	if bobStatus.Connected || bobStatus.SyncConfigured || bobStatus.LastSyncAt != "" {
		t.Fatalf("bob status = %+v, want disconnected; credential crossed users", bobStatus)
	}
	encoded, err := json.Marshal(bobStatus)
	if err != nil {
		t.Fatalf("marshal: %v", err)
	}
	if strings.Contains(string(encoded), "alice-secret") {
		t.Fatalf("bob snapshot leaked alice's secret: %s", encoded)
	}
}
