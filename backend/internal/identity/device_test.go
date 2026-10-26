package identity

import (
	"bytes"
	"encoding/json"
	"net/http"
	"net/http/httptest"
	"path/filepath"
	"strings"
	"testing"

	"github.com/simhozebs/net-worth-estimator/backend/internal/authorization"
)

func postDevice(t *testing.T, server, path, body string) (int, map[string]any) {
	t.Helper()
	var reader *strings.Reader
	if body == "" {
		reader = strings.NewReader("")
	} else {
		reader = strings.NewReader(body)
	}
	request, err := http.NewRequest(http.MethodPost, server+prefix+path, reader)
	if err != nil {
		t.Fatal(err)
	}
	if body != "" {
		request.Header.Set("Content-Type", "application/json")
	}
	// Device endpoints resolve like browser endpoints: plain requests
	// without Origin must pass CSRF handling.
	response, err := testClient(t).Do(request)
	if err != nil {
		t.Fatal(err)
	}
	defer response.Body.Close()
	var payload map[string]any
	if err := json.NewDecoder(response.Body).Decode(&payload); err != nil {
		t.Fatalf("decode %s: %v", path, err)
	}
	return response.StatusCode, payload
}

func TestDeviceFlowStartPollAndRefresh(t *testing.T) {
	p := newIDP(t)
	s := newService(t, p, filepath.Join(t.TempDir(), "sessions.db"))
	server := httptest.NewServer(s.Wrap(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) { w.WriteHeader(204) })))
	defer server.Close()

	status, start := postDevice(t, server.URL, "device/start", "")
	if status != http.StatusOK || start["verificationUri"] == nil || start["userCode"] == nil || start["deviceCode"] == nil {
		t.Fatalf("start=%d %+v", status, start)
	}
	deviceCode, _ := start["deviceCode"].(string)
	if deviceCode == "" {
		t.Fatal("start returned an empty device code")
	}

	// Approval has not happened yet: the CLI keeps polling.
	status, pending := postDevice(t, server.URL, "device/poll", `{"deviceCode":"`+deviceCode+`"}`)
	if status != http.StatusOK || pending["status"] != "pending" {
		t.Fatalf("poll before approval=%d %+v", status, pending)
	}

	// The user approves in the browser; the next poll completes.
	p.deviceApproved.Store(true)
	status, complete := postDevice(t, server.URL, "device/poll", `{"deviceCode":"`+deviceCode+`"}`)
	if status != http.StatusOK || complete["status"] != "complete" {
		t.Fatalf("poll after approval=%d %+v", status, complete)
	}
	accessToken, _ := complete["accessToken"].(string)
	refreshToken, _ := complete["refreshToken"].(string)
	if accessToken == "" || refreshToken == "" || complete["subject"] != "editor" {
		t.Fatalf("complete payload=%+v", complete)
	}

	// The minted access token acts as its subject with no session cookie.
	bearer, err := http.NewRequest(http.MethodGet, server.URL+"/v1/accounts", nil)
	if err != nil {
		t.Fatal(err)
	}
	bearer.Header.Set("Authorization", "Bearer "+accessToken)
	bearer.Header.Set(ResourceHeader, authorization.ResourceFor(p.server.URL, "editor").ID)
	response, err := testClient(t).Do(bearer)
	if err != nil {
		t.Fatal(err)
	}
	response.Body.Close()
	if response.StatusCode != http.StatusNoContent {
		t.Fatalf("bearer owner read=%d", response.StatusCode)
	}

	// Rotation works without browser interaction.
	status, rotated := postDevice(t, server.URL, "device/refresh", `{"refreshToken":"`+refreshToken+`"}`)
	if status != http.StatusOK || rotated["accessToken"] == "" {
		t.Fatalf("refresh=%d %+v", status, rotated)
	}
}

func TestDevicePollTerminalStates(t *testing.T) {
	p := newIDP(t)
	s := newService(t, p, filepath.Join(t.TempDir(), "sessions.db"))
	server := httptest.NewServer(s.Wrap(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) { w.WriteHeader(204) })))
	defer server.Close()

	if status, _ := postDevice(t, server.URL, "device/poll", `{}`); status != http.StatusBadRequest {
		t.Fatalf("empty poll=%d want 400", status)
	}
	if status, _ := postDevice(t, server.URL, "device/poll", `{"deviceCode":"used-up"}`); status != http.StatusGone {
		t.Fatalf("unknown device code=%d want 410", status)
	}
	if status, pending := postDevice(t, server.URL, "device/poll", `{"deviceCode":"slow-device"}`); status != http.StatusOK || pending["status"] != "pending" {
		t.Fatalf("slow down=%d %+v want pending", status, pending)
	}
	if status, _ := postDevice(t, server.URL, "device/poll", `{"deviceCode":"denied-device"}`); status != http.StatusForbidden {
		t.Fatalf("denied device code=%d want 403", status)
	}
	if status, _ := postDevice(t, server.URL, "device/refresh", `{"refreshToken":"bogus"}`); status != http.StatusUnauthorized {
		t.Fatalf("bogus refresh=%d want 401", status)
	}
}

func TestDeviceStartUnavailableWithoutProviderSupport(t *testing.T) {
	p := newIDP(t)
	s := newService(t, p, filepath.Join(t.TempDir(), "sessions.db"))
	server := httptest.NewServer(s.Wrap(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) { w.WriteHeader(204) })))
	defer server.Close()
	s.deviceAuth = ""
	if status, _ := postDevice(t, server.URL, "device/start", ""); status != http.StatusServiceUnavailable {
		t.Fatalf("unsupported device start=%d want 503", status)
	}
}

func TestRetiredBearerKeepsSession(t *testing.T) {
	p := newIDP(t)
	s := newService(t, p, filepath.Join(t.TempDir(), "sessions.db"))
	server := httptest.NewServer(s.Wrap(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) { w.WriteHeader(204) })))
	defer server.Close()
	client := testClient(t)
	r := signIn(t, s, p, server, client, false)
	r.Body.Close()
	request, err := http.NewRequest(http.MethodPost, server.URL+"/v1/accounts", nil)
	if err != nil {
		t.Fatal(err)
	}
	request.Header.Set("Authorization", "Bearer retired-token")
	request.Header.Set(ResourceHeader, authorization.ResourceFor(p.server.URL, "editor").ID)
	response, err := client.Do(request)
	if err != nil {
		t.Fatal(err)
	}
	response.Body.Close()
	if response.StatusCode != http.StatusNoContent {
		t.Fatalf("retired bearer with session=%d want session identity", response.StatusCode)
	}
}

func TestBearerOutageReportsUnavailable(t *testing.T) {
	p := newIDP(t)
	s := newService(t, p, filepath.Join(t.TempDir(), "sessions.db"))
	server := httptest.NewServer(s.Wrap(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) { w.WriteHeader(204) })))
	defer server.Close()
	p.introspectionStatus.Store(http.StatusBadGateway)
	request, err := http.NewRequest(http.MethodGet, server.URL+"/v1/accounts", nil)
	if err != nil {
		t.Fatal(err)
	}
	request.Header.Set("Authorization", "Bearer access-device")
	response, err := testClient(t).Do(request)
	if err != nil {
		t.Fatal(err)
	}
	response.Body.Close()
	if response.StatusCode != http.StatusServiceUnavailable {
		t.Fatalf("bearer during outage=%d want 503", response.StatusCode)
	}
}

func TestBearerOutageFallsBackToCachedSession(t *testing.T) {
	p := newIDP(t)
	_, server, client := signedIn(t, p, filepath.Join(t.TempDir(), "sessions.db"))
	p.introspectionStatus.Store(http.StatusBadGateway)
	request, err := http.NewRequest(http.MethodGet, server.URL+"/v1/accounts", nil)
	if err != nil {
		t.Fatal(err)
	}
	// A fresh sign-in stays within the recheck interval, so the session
	// validates from cache without provider contact.
	request.Header.Set("Authorization", "Bearer access-device")
	response, err := client.Do(request)
	if err != nil {
		t.Fatal(err)
	}
	response.Body.Close()
	if response.StatusCode != http.StatusNoContent {
		t.Fatalf("bearer outage with cached session=%d want session identity", response.StatusCode)
	}
}

func TestAudienceMatchesStringOrArray(t *testing.T) {
	if !audienceMatches(json.RawMessage(`["waypoint"]`), "waypoint") {
		t.Fatal("array audience should match")
	}
	if !audienceMatches(json.RawMessage(`"waypoint"`), "waypoint") {
		t.Fatal("string audience should match")
	}
	if audienceMatches(json.RawMessage(`["other"]`), "waypoint") {
		t.Fatal("foreign audience should not match")
	}
	if audienceMatches(json.RawMessage(`123`), "waypoint") {
		t.Fatal("non-string audience should not match")
	}
}

func TestDeviceStartRejectsMalformedInput(t *testing.T) {
	p := newIDP(t)
	s := newService(t, p, filepath.Join(t.TempDir(), "sessions.db"))
	server := httptest.NewServer(s.Wrap(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) { w.WriteHeader(204) })))
	defer server.Close()

	request, err := http.NewRequest(http.MethodPost, server.URL+prefix+"device/poll", bytes.NewReader([]byte(`{`)))
	if err != nil {
		t.Fatal(err)
	}
	request.Header.Set("Content-Type", "application/json")
	response, err := testClient(t).Do(request)
	if err != nil {
		t.Fatal(err)
	}
	response.Body.Close()
	if response.StatusCode != http.StatusBadRequest {
		t.Fatalf("malformed poll=%d want 400", response.StatusCode)
	}
}

func TestBearerForeignAudienceStaysGuest(t *testing.T) {
	p := newIDP(t)
	s := newService(t, p, filepath.Join(t.TempDir(), "sessions.db"))
	server := httptest.NewServer(s.Wrap(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) { w.WriteHeader(204) })))
	defer server.Close()
	ownerID := authorization.ResourceFor(p.server.URL, "editor").ID
	request, err := http.NewRequest(http.MethodPost, server.URL+"/v1/accounts", nil)
	if err != nil {
		t.Fatal(err)
	}
	request.Header.Set("Authorization", "Bearer foreign-token")
	request.Header.Set(ResourceHeader, ownerID)
	response, err := testClient(t).Do(request)
	if err != nil {
		t.Fatal(err)
	}
	response.Body.Close()
	if response.StatusCode != http.StatusUnauthorized {
		t.Fatalf("foreign-audience write=%d want 401 guest denied", response.StatusCode)
	}
}

func TestBearerMalformedHeadersFallThrough(t *testing.T) {
	p := newIDP(t)
	s := newService(t, p, filepath.Join(t.TempDir(), "sessions.db"))
	server := httptest.NewServer(s.Wrap(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) { w.WriteHeader(204) })))
	defer server.Close()
	guestID := authorization.ResourceFor(p.server.URL, "").ID
	ownerID := authorization.ResourceFor(p.server.URL, "editor").ID
	for _, header := range []string{"Bearer", "Basic xyz", "Bearer a b", "Bearer  "} {
		for _, resource := range []string{guestID, ownerID} {
			request, err := http.NewRequest(http.MethodGet, server.URL+"/v1/accounts", nil)
			if err != nil {
				t.Fatal(err)
			}
			request.Header.Set("Authorization", header)
			request.Header.Set(ResourceHeader, resource)
			response, err := testClient(t).Do(request)
			if err != nil {
				t.Fatal(err)
			}
			response.Body.Close()
			want := http.StatusNoContent
			if resource == ownerID {
				want = http.StatusConflict
			}
			if response.StatusCode != want {
				t.Fatalf("header %q resource guest=%v status=%d want %d", header, resource == guestID, response.StatusCode, want)
			}
		}
	}
}

func TestBearerWriteRouteEnforcesPlanWrite(t *testing.T) {
	p := newIDP(t)
	s := newService(t, p, filepath.Join(t.TempDir(), "sessions.db"))
	server := httptest.NewServer(s.Wrap(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) { w.WriteHeader(204) })))
	defer server.Close()
	ownerID := authorization.ResourceFor(p.server.URL, "editor").ID
	request, err := http.NewRequest(http.MethodPost, server.URL+"/v1/sync/simplefin", nil)
	if err != nil {
		t.Fatal(err)
	}
	request.Header.Set("Authorization", "Bearer access-device")
	request.Header.Set(ResourceHeader, ownerID)
	response, err := testClient(t).Do(request)
	if err != nil {
		t.Fatal(err)
	}
	response.Body.Close()
	if response.StatusCode != http.StatusNoContent {
		t.Fatalf("bearer owner write=%d want 204", response.StatusCode)
	}
}
