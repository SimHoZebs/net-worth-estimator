package integration

import (
	"bytes"
	"encoding/json"
	"net/http"
	"net/http/httptest"
	"testing"

	"github.com/simhozebs/net-worth-estimator/backend/internal/simplefin"
)

type integrationEntry struct {
	ID             string `json:"id"`
	Connected      bool   `json:"connected"`
	SyncConfigured bool   `json:"syncConfigured"`
	ConnectedAt    string `json:"connectedAt"`
	LastSyncAt     string `json:"lastSyncAt"`
	Detail         string `json:"detail"`
}

func getIntegrations(t *testing.T, handler http.Handler) []integrationEntry {
	t.Helper()
	response := httptest.NewRecorder()
	handler.ServeHTTP(response, httptest.NewRequest(http.MethodGet, "/v1/integrations", nil))
	if response.Code != http.StatusOK {
		t.Fatalf("list status = %d, body %s", response.Code, response.Body.String())
	}
	var payload struct {
		Providers []integrationEntry `json:"providers"`
	}
	if err := json.Unmarshal(response.Body.Bytes(), &payload); err != nil {
		t.Fatalf("decode integrations: %v", err)
	}
	return payload.Providers
}

func simplefinEntry(t *testing.T, providers []integrationEntry) integrationEntry {
	t.Helper()
	for _, entry := range providers {
		if entry.ID == "simplefin" {
			return entry
		}
	}
	t.Fatalf("providers = %+v, want a simplefin entry", providers)
	return integrationEntry{}
}

func TestListIntegrationsReflectsSimpleFINConnection(t *testing.T) {
	database := openAPIStore(t)
	runner := simplefin.NewRunnerWithProvider(database, simplefin.Config{}, func() (string, map[string]struct{}) {
		credential, err := database.GetSyncCredential()
		if err != nil {
			return "", nil
		}
		return credential.AccessURL, nil
	}, nil)
	handler := New(database, Config{SyncRunner: runner})

	providers := getIntegrations(t, handler)
	if len(providers) != 2 || providers[0].ID != "simplefin" || providers[1].ID != "gmail" {
		t.Fatalf("providers = %+v, want [simplefin gmail] in registration order", providers)
	}
	if providers[0].Connected || providers[0].SyncConfigured {
		t.Fatalf("providers = %+v, want disconnected", providers)
	}

	const secret = "user:pass"
	connect := postCredential(t, handler, "https://"+secret+"@bridge.example/simplefin")
	if connect.Code != http.StatusOK {
		t.Fatalf("connect status = %d, body %s", connect.Code, connect.Body.String())
	}

	providers = getIntegrations(t, handler)
	entry := simplefinEntry(t, providers)
	if !entry.Connected || !entry.SyncConfigured {
		t.Fatalf("entry = %+v, want connected and configured", entry)
	}
	if entry.Detail != "bridge.example" || entry.ConnectedAt == "" {
		t.Fatalf("entry = %+v, want host detail and connection time", entry)
	}

	raw, err := json.Marshal(providers)
	if err != nil {
		t.Fatalf("marshal: %v", err)
	}
	if bytes.Contains(raw, []byte(secret)) {
		t.Fatalf("integrations listing leaked the secret: %s", raw)
	}

	remove := httptest.NewRecorder()
	handler.ServeHTTP(remove, httptest.NewRequest(http.MethodDelete, "/v1/sync/simplefin/credential", nil))
	if remove.Code != http.StatusOK {
		t.Fatalf("disconnect status = %d, body %s", remove.Code, remove.Body.String())
	}
	providers = getIntegrations(t, handler)
	if entry := simplefinEntry(t, providers); entry.Connected {
		t.Fatalf("providers = %+v, want disconnected after disconnect", providers)
	}
}

func TestListIntegrationsReportsLastSync(t *testing.T) {
	database := openAPIStore(t)
	runner := simplefin.NewRunnerWithProvider(database, simplefin.Config{}, func() (string, map[string]struct{}) {
		credential, _ := database.GetSyncCredential()
		return credential.AccessURL, nil
	}, nil)
	handler := New(database, Config{SyncRunner: runner})

	if response := postCredential(t, handler, "https://user:pass@bridge.example/simplefin"); response.Code != http.StatusOK {
		t.Fatalf("connect status = %d, body %s", response.Code, response.Body.String())
	}
	if err := database.SetLastSyncTime("2026-10-26T00:00:00Z"); err != nil {
		t.Fatalf("stamp sync: %v", err)
	}
	providers := getIntegrations(t, handler)
	if entry := simplefinEntry(t, providers); entry.LastSyncAt != "2026-10-26T00:00:00Z" {
		t.Fatalf("providers = %+v, want recorded last sync", providers)
	}
}
