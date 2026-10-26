package api

import (
	"bytes"
	"encoding/json"
	"net/http"
	"net/http/httptest"
	"testing"

	"github.com/simhozebs/net-worth-estimator/backend/internal/simplefin"
	"github.com/simhozebs/net-worth-estimator/backend/internal/types"
)

func TestSyncCredentialConnectAndStatus(t *testing.T) {
	database := openAPIStore(t)
	runner := simplefin.NewRunnerWithProvider(database, simplefin.Config{}, func() (string, map[string]struct{}) {
		credential, err := database.GetSyncCredential()
		if err != nil {
			return "", nil
		}
		return credential.AccessURL, nil
	}, nil)
	handler := New(database, Config{SyncRunner: runner})

	// Unconfigured status.
	status := httptest.NewRecorder()
	handler.ServeHTTP(status, httptest.NewRequest(http.MethodGet, "/v1/status", nil))
	var unconfigured struct {
		SyncConfigured bool `json:"syncConfigured"`
	}
	if err := json.Unmarshal(status.Body.Bytes(), &unconfigured); err != nil {
		t.Fatalf("decode status: %v", err)
	}
	if unconfigured.SyncConfigured {
		t.Fatalf("status = %+v, want unconfigured", unconfigured)
	}

	// Trigger is 503 before connecting.
	trigger := httptest.NewRecorder()
	handler.ServeHTTP(trigger, httptest.NewRequest(http.MethodPost, "/v1/sync/simplefin", nil))
	if trigger.Code != http.StatusServiceUnavailable {
		t.Fatalf("trigger status = %d, want 503, body %s", trigger.Code, trigger.Body.String())
	}

	// Connect with a direct access URL (already-claimed paste fallback).
	connect := httptest.NewRecorder()
	body := bytes.NewReader([]byte(`{"accessUrl":"https://user:pass@bridge.example/simplefin"}`))
	request := httptest.NewRequest(http.MethodPost, "/v1/sync/simplefin/credential", body)
	request.Header.Set("Content-Type", "application/json")
	handler.ServeHTTP(connect, request)
	if connect.Code != http.StatusOK {
		t.Fatalf("connect status = %d, body %s", connect.Code, connect.Body.String())
	}
	var connected struct {
		Configured bool   `json:"configured"`
		BridgeHost string `json:"bridgeHost"`
		UpdatedAt  string `json:"updatedAt"`
	}
	if err := json.Unmarshal(connect.Body.Bytes(), &connected); err != nil {
		t.Fatalf("decode connect: %v", err)
	}
	if !connected.Configured || connected.BridgeHost != "bridge.example" || connected.UpdatedAt == "" {
		t.Fatalf("connected = %+v", connected)
	}
	if bytes.Contains(connect.Body.Bytes(), []byte("user:pass")) {
		t.Fatal("connect response leaked the secret")
	}

	// Status now reports configured with host.
	configured := httptest.NewRecorder()
	handler.ServeHTTP(configured, httptest.NewRequest(http.MethodGet, "/v1/status", nil))
	var statusPayload struct {
		SyncConfigured bool   `json:"syncConfigured"`
		SyncHost       string `json:"syncHost"`
	}
	if err := json.Unmarshal(configured.Body.Bytes(), &statusPayload); err != nil {
		t.Fatalf("decode status: %v", err)
	}
	if !statusPayload.SyncConfigured || statusPayload.SyncHost != "bridge.example" {
		t.Fatalf("status = %+v", statusPayload)
	}

	// GET credential never returns the secret.
	get := httptest.NewRecorder()
	handler.ServeHTTP(get, httptest.NewRequest(http.MethodGet, "/v1/sync/simplefin/credential", nil))
	if get.Code != http.StatusOK {
		t.Fatalf("get status = %d, body %s", get.Code, get.Body.String())
	}
	if bytes.Contains(get.Body.Bytes(), []byte("user:pass")) {
		t.Fatal("credential GET leaked the secret")
	}

	// Disconnect returns to 503.
	remove := httptest.NewRecorder()
	handler.ServeHTTP(remove, httptest.NewRequest(http.MethodDelete, "/v1/sync/simplefin/credential", nil))
	if remove.Code != http.StatusOK {
		t.Fatalf("disconnect status = %d, body %s", remove.Code, remove.Body.String())
	}
	retry := httptest.NewRecorder()
	handler.ServeHTTP(retry, httptest.NewRequest(http.MethodPost, "/v1/sync/simplefin", nil))
	if retry.Code != http.StatusServiceUnavailable {
		t.Fatalf("trigger after disconnect = %d, want 503", retry.Code)
	}
}

func TestSyncCredentialRejectsBadInput(t *testing.T) {
	database := openAPIStore(t)
	runner := simplefin.NewRunnerWithProvider(database, simplefin.Config{}, func() (string, map[string]struct{}) {
		credential, _ := database.GetSyncCredential()
		return credential.AccessURL, nil
	}, nil)
	handler := New(database, Config{SyncRunner: runner})

	for _, body := range []string{
		`{}`,
		`{"setupToken":"x","accessUrl":"https://user:pass@bridge.example/simplefin"}`,
		`{"setupToken":"not-base64!!!"}`,
		`{"accessUrl":"http://bridge.example/simplefin"}`,
	} {
		response := httptest.NewRecorder()
		request := httptest.NewRequest(http.MethodPost, "/v1/sync/simplefin/credential", bytes.NewReader([]byte(body)))
		request.Header.Set("Content-Type", "application/json")
		handler.ServeHTTP(response, request)
		if response.Code != http.StatusBadRequest {
			t.Fatalf("body %s status = %d, want 400, body %s", body, response.Code, response.Body.String())
		}
	}
}

func TestSyncCardsValidation(t *testing.T) {
	database := openAPIStore(t)
	if _, err := database.CreateAccount(types.Account{ID: "checking", Name: "Checking"}); err != nil {
		t.Fatalf("seed account: %v", err)
	}
	runner := simplefin.NewRunnerWithProvider(database, simplefin.Config{}, func() (string, map[string]struct{}) {
		credential, _ := database.GetSyncCredential()
		return credential.AccessURL, nil
	}, nil)
	handler := New(database, Config{SyncRunner: runner})

	// Unknown account is 422 when a document exists.
	bad := httptest.NewRecorder()
	request := httptest.NewRequest(http.MethodPut, "/v1/sync/simplefin/cards", bytes.NewReader([]byte(`{"cards":["ghost"]}`)))
	request.Header.Set("Content-Type", "application/json")
	handler.ServeHTTP(bad, request)
	if bad.Code != http.StatusUnprocessableEntity {
		t.Fatalf("unknown card status = %d, want 422, body %s", bad.Code, bad.Body.String())
	}

	good := httptest.NewRecorder()
	goodRequest := httptest.NewRequest(http.MethodPut, "/v1/sync/simplefin/cards", bytes.NewReader([]byte(`{"cards":["checking"]}`)))
	goodRequest.Header.Set("Content-Type", "application/json")
	handler.ServeHTTP(good, goodRequest)
	if good.Code != http.StatusOK {
		t.Fatalf("set cards status = %d, body %s", good.Code, good.Body.String())
	}

	get := httptest.NewRecorder()
	handler.ServeHTTP(get, httptest.NewRequest(http.MethodGet, "/v1/sync/simplefin/cards", nil))
	var payload struct {
		Cards []string `json:"cards"`
	}
	if err := json.Unmarshal(get.Body.Bytes(), &payload); err != nil {
		t.Fatalf("decode cards: %v", err)
	}
	if len(payload.Cards) != 1 || payload.Cards[0] != "checking" {
		t.Fatalf("cards = %+v", payload)
	}
}

func TestSyncCredentialReadOnlyPolicy(t *testing.T) {
	database := openAPIStore(t)
	handler := New(database, Config{ReadOnly: true})
	for _, test := range []struct {
		method string
		path   string
		body   string
	}{
		{http.MethodPost, "/v1/sync/simplefin/credential", `{"accessUrl":"https://user:pass@bridge.example/simplefin"}`},
		{http.MethodDelete, "/v1/sync/simplefin/credential", ""},
		{http.MethodPut, "/v1/sync/simplefin/cards", `{"cards":[]}`},
	} {
		var reader *bytes.Reader
		if test.body != "" {
			reader = bytes.NewReader([]byte(test.body))
		} else {
			reader = bytes.NewReader(nil)
		}
		request := httptest.NewRequest(test.method, test.path, reader)
		if test.body != "" {
			request.Header.Set("Content-Type", "application/json")
		}
		response := httptest.NewRecorder()
		handler.ServeHTTP(response, request)
		if response.Code != http.StatusForbidden {
			t.Fatalf("%s %s status = %d, want 403", test.method, test.path, response.Code)
		}
	}
}
