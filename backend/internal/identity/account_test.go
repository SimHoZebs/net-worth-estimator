package identity

import (
	"encoding/json"
	"io"
	"net/http"
	"net/http/httptest"
	"path/filepath"
	"strings"
	"testing"
	"time"
)

func TestAccountProxyPresentational(t *testing.T) {
	p := newIDP(t)
	s := newService(t, p, filepath.Join(t.TempDir(), "sessions.db"))
	server := httptest.NewServer(s.Wrap(http.HandlerFunc(func(w http.ResponseWriter, _ *http.Request) { w.WriteHeader(204) })))
	defer server.Close()
	client := testClient(t)
	r := signIn(t, s, p, server, client, false)
	r.Body.Close()

	get := func(path string) (int, map[string]any) {
		t.Helper()
		resp, err := client.Get(server.URL + path)
		if err != nil {
			t.Fatal(err)
		}
		defer resp.Body.Close()
		var body map[string]any
		_ = json.NewDecoder(resp.Body).Decode(&body)
		return resp.StatusCode, body
	}

	if code, body := get(prefix + "profile"); code != 200 || body["displayName"] != "Sam Lee" {
		t.Fatalf("profile=%d %v", code, body)
	}

	req, _ := http.NewRequest(http.MethodPatch, server.URL+prefix+"profile", strings.NewReader(`{"displayName":" Sam Lee "}`))
	req.Header.Set("Content-Type", "application/json")
	resp, err := client.Do(req)
	if err != nil {
		t.Fatal(err)
	}
	io.Copy(io.Discard, resp.Body)
	resp.Body.Close()
	if resp.StatusCode != 200 {
		t.Fatalf("patch profile=%d", resp.StatusCode)
	}

	if code, body := get(prefix + "sessions"); code != 200 {
		t.Fatalf("sessions=%d %v", code, body)
	} else if items, _ := body["sessions"].([]any); len(items) != 1 {
		t.Fatalf("sessions count=%v", body)
	}

	req, _ = http.NewRequest(http.MethodPost, server.URL+prefix+"change-password", strings.NewReader(`{"oldPassword":"old","newPassword":"new-secret-123"}`))
	req.Header.Set("Content-Type", "application/json")
	resp, err = client.Do(req)
	if err != nil {
		t.Fatal(err)
	}
	io.Copy(io.Discard, resp.Body)
	resp.Body.Close()
	if resp.StatusCode != 200 {
		t.Fatalf("change password=%d", resp.StatusCode)
	}
	// Password change ends the app session; the next profile read is anonymous.
	if code, _ := get(prefix + "profile"); code != 401 {
		t.Fatalf("post-password profile=%d want 401", code)
	}
}

func TestAccountRevokedEndsSession(t *testing.T) {
	newSignedIn := func(t *testing.T, p *testIDP) (*Service, *httptest.Server, *http.Client) {
		t.Helper()
		s := newService(t, p, filepath.Join(t.TempDir(), "sessions.db"))
		server := httptest.NewServer(s.Wrap(http.HandlerFunc(func(w http.ResponseWriter, _ *http.Request) { w.WriteHeader(204) })))
		t.Cleanup(server.Close)
		client := testClient(t)
		r := signIn(t, s, p, server, client, false)
		r.Body.Close()
		return s, server, client
	}
	t.Run("error status", func(t *testing.T) {
		p := newIDP(t)
		_, server, client := newSignedIn(t, p)
		p.getAccountError = "token is inactive"
		resp, err := client.Get(server.URL + prefix + "profile")
		if err != nil {
			t.Fatal(err)
		}
		defer resp.Body.Close()
		var body map[string]any
		_ = json.NewDecoder(resp.Body).Decode(&body)
		if resp.StatusCode != 401 || body["detail"] != "The account is no longer active. Start sign-in again." {
			t.Fatalf("revoked profile=%d %v", resp.StatusCode, body)
		}
		// The local session is destroyed, so the next read is anonymous too.
		resp, err = client.Get(server.URL + prefix + "profile")
		if err != nil {
			t.Fatal(err)
		}
		resp.Body.Close()
		if resp.StatusCode != 401 {
			t.Fatalf("post-revocation profile=%d want 401", resp.StatusCode)
		}
	})
	t.Run("non-200 with JSON body", func(t *testing.T) {
		p := newIDP(t)
		_, server, client := newSignedIn(t, p)
		p.getAccountStatus = 429
		resp, err := client.Get(server.URL + prefix + "profile")
		if err != nil {
			t.Fatal(err)
		}
		defer resp.Body.Close()
		var body map[string]any
		_ = json.NewDecoder(resp.Body).Decode(&body)
		if resp.StatusCode != 503 {
			t.Fatalf("non-200 profile=%d %v want 503", resp.StatusCode, body)
		}
	})
	t.Run("subject mismatch", func(t *testing.T) {
		p := newIDP(t)
		_, server, client := newSignedIn(t, p)
		p.accountSubOverride = "someone-else"
		resp, err := client.Get(server.URL + prefix + "profile")
		if err != nil {
			t.Fatal(err)
		}
		resp.Body.Close()
		if resp.StatusCode != 401 {
			t.Fatalf("mismatched profile=%d want 401", resp.StatusCode)
		}
	})
}

func TestAccountRejectionsPassThrough(t *testing.T) {
	p := newIDP(t)
	s := newService(t, p, filepath.Join(t.TempDir(), "sessions.db"))
	server := httptest.NewServer(s.Wrap(http.HandlerFunc(func(w http.ResponseWriter, _ *http.Request) { w.WriteHeader(204) })))
	defer server.Close()
	client := testClient(t)
	r := signIn(t, s, p, server, client, false)
	r.Body.Close()

	p.accountWriteError = "Password is too common."
	req, _ := http.NewRequest(http.MethodPost, server.URL+prefix+"change-password", strings.NewReader(`{"oldPassword":"old","newPassword":"password"}`))
	req.Header.Set("Content-Type", "application/json")
	resp, err := client.Do(req)
	if err != nil {
		t.Fatal(err)
	}
	var body map[string]any
	_ = json.NewDecoder(resp.Body).Decode(&body)
	resp.Body.Close()
	if resp.StatusCode != 400 || body["detail"] != "Password is too common." {
		t.Fatalf("rejected password=%d %v", resp.StatusCode, body)
	}

	// Unknown body fields prove owner and name resolve from get-account, not
	// from the caller.
	p.lastUpdateID = ""
	req, _ = http.NewRequest(http.MethodPatch, server.URL+prefix+"profile", strings.NewReader(`{"displayName":"Sam Lee","owner":"waypoint/evil","name":"evil"}`))
	req.Header.Set("Content-Type", "application/json")
	resp, err = client.Do(req)
	if err != nil {
		t.Fatal(err)
	}
	_ = json.NewDecoder(resp.Body).Decode(&body)
	resp.Body.Close()
	if resp.StatusCode != 400 || body["detail"] != "Password is too common." {
		t.Fatalf("rejected profile=%d %v", resp.StatusCode, body)
	}
	if p.lastUpdateID != "waypoint/editor" {
		t.Fatalf("update id=%q want self", p.lastUpdateID)
	}
}

func TestAccountSessionsRevokeCrossSubject(t *testing.T) {
	p := newIDP(t)
	s := newService(t, p, filepath.Join(t.TempDir(), "sessions.db"))
	server := httptest.NewServer(s.Wrap(http.HandlerFunc(func(w http.ResponseWriter, _ *http.Request) { w.WriteHeader(204) })))
	defer server.Close()
	editor := testClient(t)
	r := signIn(t, s, p, server, editor, false)
	r.Body.Close()
	p.subject = "other"
	other := testClient(t)
	r = signIn(t, s, p, server, other, false)
	r.Body.Close()

	resp, err := editor.Get(server.URL + prefix + "sessions")
	if err != nil {
		t.Fatal(err)
	}
	var body map[string]any
	_ = json.NewDecoder(resp.Body).Decode(&body)
	resp.Body.Close()
	items, _ := body["sessions"].([]any)
	if len(items) != 1 {
		t.Fatalf("editor sessions=%v", body)
	}
	editorGrant, _ := items[0].(map[string]any)["id"].(string)

	req, _ := http.NewRequest(http.MethodDelete, server.URL+prefix+"sessions?id="+editorGrant, nil)
	resp, err = other.Do(req)
	if err != nil {
		t.Fatal(err)
	}
	io.Copy(io.Discard, resp.Body)
	resp.Body.Close()
	if resp.StatusCode != 404 {
		t.Fatalf("cross-subject revoke=%d want 404", resp.StatusCode)
	}
	// The victim grant survives the attempt.
	resp, err = editor.Get(server.URL + prefix + "sessions")
	if err != nil {
		t.Fatal(err)
	}
	body = nil
	_ = json.NewDecoder(resp.Body).Decode(&body)
	resp.Body.Close()
	if items, _ := body["sessions"].([]any); len(items) != 1 {
		t.Fatalf("editor sessions after attempt=%v", body)
	}
}

func TestLoadPendingLoginsBounds(t *testing.T) {
	expired := time.Now().Add(-11 * time.Minute).UnixNano()
	fresh := time.Now().UnixNano()
	entry := func(at int64) pendingLogin { return pendingLogin{Nonce: "n", Verifier: "v", Origin: "o", At: at} }
	raw, _ := json.Marshal(map[string]pendingLogin{
		"expired": entry(expired),
		"a":       entry(fresh - 3),
		"b":       entry(fresh - 2),
		"c":       entry(fresh - 1),
		"d":       entry(fresh),
	})
	pending := loadPendingLogins(string(raw))
	if len(pending) != 3 {
		t.Fatalf("pending=%d want 3", len(pending))
	}
	if _, ok := pending["expired"]; ok {
		t.Fatal("expired entry survived")
	}
	if _, ok := pending["a"]; ok {
		t.Fatal("oldest entry survived eviction")
	}
	if len(loadPendingLogins("not-json")) != 0 {
		t.Fatal("malformed pending logins should decode empty")
	}
}

func TestAccountChangePasswordRevokesAllSessions(t *testing.T) {
	p := newIDP(t)
	s := newService(t, p, filepath.Join(t.TempDir(), "sessions.db"))
	server := httptest.NewServer(s.Wrap(http.HandlerFunc(func(w http.ResponseWriter, _ *http.Request) { w.WriteHeader(204) })))
	defer server.Close()
	first := testClient(t)
	r := signIn(t, s, p, server, first, false)
	r.Body.Close()
	second := testClient(t)
	r = signIn(t, s, p, server, second, false)
	r.Body.Close()

	req, _ := http.NewRequest(http.MethodPost, server.URL+prefix+"change-password", strings.NewReader(`{"oldPassword":"old","newPassword":"new-secret-123"}`))
	req.Header.Set("Content-Type", "application/json")
	resp, err := first.Do(req)
	if err != nil {
		t.Fatal(err)
	}
	io.Copy(io.Discard, resp.Body)
	resp.Body.Close()
	if resp.StatusCode != 200 {
		t.Fatalf("change password=%d", resp.StatusCode)
	}
	// The other device loses access immediately, not at the next recheck.
	resp, err = second.Get(server.URL + prefix + "profile")
	if err != nil {
		t.Fatal(err)
	}
	resp.Body.Close()
	if resp.StatusCode != 401 {
		t.Fatalf("other device profile=%d want 401", resp.StatusCode)
	}
}

func TestAccountSessionsRevokeOther(t *testing.T) {
	p := newIDP(t)
	s := newService(t, p, filepath.Join(t.TempDir(), "sessions.db"))
	server := httptest.NewServer(s.Wrap(http.HandlerFunc(func(w http.ResponseWriter, _ *http.Request) { w.WriteHeader(204) })))
	defer server.Close()
	first := testClient(t)
	r := signIn(t, s, p, server, first, false)
	r.Body.Close()
	second := testClient(t)
	r = signIn(t, s, p, server, second, false)
	r.Body.Close()

	resp, err := second.Get(server.URL + prefix + "sessions")
	if err != nil {
		t.Fatal(err)
	}
	var body map[string]any
	_ = json.NewDecoder(resp.Body).Decode(&body)
	resp.Body.Close()
	items, _ := body["sessions"].([]any)
	if len(items) != 2 {
		t.Fatalf("sessions=%v", body)
	}
	var other string
	var current string
	for _, item := range items {
		m, _ := item.(map[string]any)
		id, _ := m["id"].(string)
		if isCurrent, _ := m["current"].(bool); isCurrent {
			current = id
		} else {
			other = id
		}
	}
	if other == "" || current == "" {
		t.Fatalf("sessions missing current/other: %v", body)
	}
	req, _ := http.NewRequest(http.MethodDelete, server.URL+prefix+"sessions?id="+other, nil)
	resp, err = second.Do(req)
	if err != nil {
		t.Fatal(err)
	}
	io.Copy(io.Discard, resp.Body)
	resp.Body.Close()
	if resp.StatusCode != 200 {
		t.Fatalf("revoke other=%d", resp.StatusCode)
	}
	// Refusing to revoke the current session keeps an explicit sign-out path.
	req, _ = http.NewRequest(http.MethodDelete, server.URL+prefix+"sessions?id="+current, nil)
	resp, err = second.Do(req)
	if err != nil {
		t.Fatal(err)
	}
	io.Copy(io.Discard, resp.Body)
	resp.Body.Close()
	if resp.StatusCode != 400 {
		t.Fatalf("revoke current=%d want 400", resp.StatusCode)
	}
}
