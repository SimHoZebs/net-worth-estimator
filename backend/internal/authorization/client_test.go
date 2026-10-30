package authorization

import (
	"context"
	"encoding/json"
	"fmt"
	"io"
	"net/http"
	"net/http/httptest"
	"reflect"
	"strings"
	"testing"
	"time"
)

func newTestClient(t *testing.T, handler http.HandlerFunc) *Client {
	t.Helper()
	server := httptest.NewServer(handler)
	t.Cleanup(server.Close)
	client, err := New(Config{Issuer: server.URL, ClientID: "app-client", ClientSecret: "secret:never-log-this"})
	if err != nil {
		t.Fatal(err)
	}
	return client
}

func result(w http.ResponseWriter, decisions []bool) {
	_ = json.NewEncoder(w).Encode(map[string]any{"status": "ok", "data": [][]bool{decisions}, "data2": []string{DefaultModelID + "/" + DefaultAdapter}})
}

func getUserPayload(owner, id, name string) map[string]any {
	return map[string]any{"status": "ok", "data": map[string]any{"owner": owner, "name": name, "id": id}}
}

func serveGetUser(t *testing.T, w http.ResponseWriter, r *http.Request) bool {
	t.Helper()
	if r.URL.Path != "/api/get-user" {
		return false
	}
	id, secret, ok := r.BasicAuth()
	if !ok || id != "app-client" || secret != "secret:never-log-this" {
		t.Errorf("get-user missing Basic credentials")
	}
	q := r.URL.Query()
	owner, userID := q.Get("owner"), q.Get("userId")
	if r.Method != http.MethodGet || owner == "" || userID == "" {
		t.Errorf("unexpected get-user request: %s %s", r.Method, r.URL)
	}
	name := userID
	if !validProviderName(name) {
		name = "testuser"
	}
	_ = json.NewEncoder(w).Encode(getUserPayload(owner, userID, name))
	return true
}

func TestResolveChecksAllActionsWithBasicAuth(t *testing.T) {
	var requests [][][]string
	client := newTestClient(t, func(w http.ResponseWriter, r *http.Request) {
		if serveGetUser(t, w, r) {
			return
		}
		id, secret, ok := r.BasicAuth()
		if !ok || id != "app-client" || secret != "secret:never-log-this" {
			t.Errorf("unexpected Basic credentials")
		}
		if r.Method != "POST" || r.URL.Path != "/api/batch-enforce" || r.URL.Query().Get("modelId") != DefaultModelID || r.Header.Get("Content-Type") != "application/json" {
			t.Errorf("unexpected request: %s %s", r.Method, r.URL)
		}
		if len(r.URL.Query()) != 1 {
			t.Errorf("credentials or unexpected selector in URL")
		}
		var batch [][]string
		if err := json.NewDecoder(r.Body).Decode(&batch); err != nil {
			t.Error(err)
		}
		requests = append(requests, batch)
		if len(requests) == 1 {
			result(w, []bool{true, true, true})
		} else {
			result(w, []bool{false, false, false})
		}
	})
	resource := ResourceFor(client.config.Issuer, "immutable-subject")
	first, err := client.Resolve(context.Background(), "immutable-subject")
	if err != nil || first.Resource != resource || !reflect.DeepEqual(first.Permissions, []string{Read, Project, Write}) {
		t.Fatalf("unexpected scope: %+v, %v", first, err)
	}
	second, err := client.Resolve(context.Background(), "immutable-subject")
	if err != nil || len(second.Permissions) != 0 || len(requests) != 2 {
		t.Fatalf("positive decision was cached: %+v, %v, calls=%d", second, err, len(requests))
	}
	actor := ActorKey(client.config.Issuer, "immutable-subject")
	expected := [][]string{
		{"waypoint/immutable-subject", resource.ID, Read, resource.Owner, actor},
		{"waypoint/immutable-subject", resource.ID, Project, resource.Owner, actor},
		{"waypoint/immutable-subject", resource.ID, Write, resource.Owner, actor},
	}
	if !reflect.DeepEqual(requests[0], expected) || !reflect.DeepEqual(requests[1], expected) {
		t.Fatalf("unexpected provider inputs: %#v", requests)
	}
}

func TestResolveGuestIsOrdinaryAccount(t *testing.T) {
	const guestSubject = "11111111-1111-1111-1111-111111111111"
	var client *Client
	client = newTestClient(t, func(w http.ResponseWriter, r *http.Request) {
		if serveGetUser(t, w, r) {
			return
		}
		var batch [][]string
		_ = json.NewDecoder(r.Body).Decode(&batch)
		actor := ActorKey(client.config.Issuer, guestSubject)
		resource := ResourceFor(client.config.Issuer, guestSubject)
		expected := [][]string{
			{"waypoint/" + guestSubject, resource.ID, Read, resource.Owner, actor},
			{"waypoint/" + guestSubject, resource.ID, Project, resource.Owner, actor},
			{"waypoint/" + guestSubject, resource.ID, Write, resource.Owner, actor},
		}
		if !reflect.DeepEqual(batch, expected) {
			t.Errorf("unexpected guest inputs: %#v", batch)
		}
		result(w, []bool{true, true, false})
	})
	scope, err := client.Resolve(context.Background(), guestSubject)
	if err != nil || !scope.Resource.valid() || scope.Resource.ID == "" || !scope.Allows(Read) || !scope.Allows(Project) || scope.Allows(Write) || scope.Allows("user:admin") {
		t.Fatalf("unexpected guest scope: %+v, %v", scope, err)
	}
	if _, err := client.Resolve(context.Background(), ""); err == nil {
		t.Fatal("empty subject must fail closed")
	}
}

func TestCheckPreservesCrossOwnerMetadata(t *testing.T) {
	var received [][]string
	server := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		if r.URL.Path == "/api/get-user" {
			q := r.URL.Query()
			userID := q.Get("userId")
			_ = json.NewEncoder(w).Encode(getUserPayload(q.Get("owner"), userID, userID))
			return
		}
		var batch [][]string
		_ = json.NewDecoder(r.Body).Decode(&batch)
		received = append(received, batch...)
		// A fixture decision is not a substitute implementation of the policy.
		result(w, []bool{false})
	}))
	defer server.Close()
	client, err := New(Config{Issuer: server.URL, ClientID: "app-client", ClientSecret: "secret:never-log-this"})
	if err != nil {
		t.Fatal(err)
	}
	other := ResourceFor(client.config.Issuer, "bob")
	decisions, err := client.Check(context.Background(), "alice", other, []string{Read})
	if err != nil || !reflect.DeepEqual(decisions, []bool{false}) {
		t.Fatalf("provider deny was not preserved: %v, %v", decisions, err)
	}
	actor := ActorKey(client.config.Issuer, "alice")
	if !reflect.DeepEqual(received, [][]string{{"waypoint/alice", other.ID, Read, other.Owner, actor}}) {
		t.Fatalf("caller overwrote resource ownership: %#v", received)
	}
}

func TestUnexpectedResponsesFailClosed(t *testing.T) {
	group := DefaultModelID + "/" + DefaultAdapter
	for name, body := range map[string]string{
		"missing":             `{}`,
		"provider error":      `{"status":"error","data":[[true,true,true]],"data2":["` + group + `"]}`,
		"missing data":        `{"status":"ok","data2":[]}`,
		"missing groups":      `{"status":"ok","data":[]}`,
		"null":                `{"status":"ok","data":null,"data2":null}`,
		"null group":          `{"status":"ok","data":[null],"data2":["` + group + `"]}`,
		"flat data":           `{"status":"ok","data":[true,true,true],"data2":["` + group + `"]}`,
		"null boolean":        `{"status":"ok","data":[[true,null,true]],"data2":["` + group + `"]}`,
		"string boolean":      `{"status":"ok","data":[[true,"true",true]],"data2":["` + group + `"]}`,
		"short":               `{"status":"ok","data":[[true,true]],"data2":["` + group + `"]}`,
		"long":                `{"status":"ok","data":[[true,true,true,true]],"data2":["` + group + `"]}`,
		"wrong model":         `{"status":"ok","data":[[true,true,true]],"data2":["elsewhere/model/user-policy-store"]}`,
		"wrong adapter":       `{"status":"ok","data":[[true,true,true]],"data2":["` + DefaultModelID + `/unknown"]}`,
		"multiple deny allow": `{"status":"ok","data":[[false,false,false],[true,true,true]],"data2":["` + group + `","` + group + `"]}`,
		"mismatched groups":   `{"status":"ok","data":[],"data2":["` + group + `"]}`,
		"trailing JSON":       `{"status":"ok","data":[],"data2":[]} {}`,
		"oversized":           `{"status":"ok","data":[],"data2":[],"msg":"` + strings.Repeat("x", maxResponse) + `"}`,
	} {
		t.Run(name, func(t *testing.T) {
			client := newTestClient(t, func(w http.ResponseWriter, r *http.Request) {
				if r.URL.Path == "/api/get-user" {
					_ = json.NewEncoder(w).Encode(getUserPayload("waypoint", "alice", "alice"))
					return
				}
				_, _ = w.Write([]byte(body))
			})
			scope, err := client.Resolve(context.Background(), "alice")
			if err == nil || len(scope.Permissions) != 0 || scope.Resource.ID != "" {
				t.Fatalf("unexpected authorization success: %+v, %v", scope, err)
			}
			if strings.Contains(err.Error(), "never-log-this") || strings.Contains(err.Error(), body) {
				t.Fatal("provider credentials or body leaked in error")
			}
		})
	}
}

func TestGetUserResponsesFailClosed(t *testing.T) {
	for name, body := range map[string]string{
		"missing":                  `{}`,
		"error status":             `{"status":"error","data":{"owner":"waypoint","name":"alice","id":"alice"}}`,
		"missing data":             `{"status":"ok"}`,
		"wrong owner":              `{"status":"ok","data":{"owner":"other","name":"alice","id":"alice"}}`,
		"missing name":             `{"status":"ok","data":{"owner":"waypoint","name":"","id":"alice"}}`,
		"missing id":               `{"status":"ok","data":{"owner":"waypoint","name":"alice"}}`,
		"id mismatch":              `{"status":"ok","data":{"owner":"waypoint","name":"alice","id":"bob"}}`,
		"same username wrong UUID": `{"status":"ok","data":{"owner":"waypoint","name":"alice","id":"other-uuid"}}`,
		"slash name":               `{"status":"ok","data":{"owner":"waypoint","name":"a/b","id":"alice"}}`,
		"control name":             `{"status":"ok","data":{"owner":"waypoint","name":"a\u0001b","id":"alice"}}`,
		"forbidden":                `{"status":"ok","data":{"owner":"waypoint","name":"alice","id":"alice","isForbidden":true}}`,
		"deleted":                  `{"status":"ok","data":{"owner":"waypoint","name":"alice","id":"alice","isDeleted":true}}`,
		"trailing JSON":            `{"status":"ok","data":{"owner":"waypoint","name":"alice","id":"alice"}} {}`,
	} {
		t.Run(name, func(t *testing.T) {
			client := newTestClient(t, func(w http.ResponseWriter, r *http.Request) {
				if r.URL.Path == "/api/get-user" {
					_, _ = w.Write([]byte(body))
					return
				}
				result(w, []bool{true, true, true})
			})
			if scope, err := client.Resolve(context.Background(), "alice"); err == nil || scope.Resource.ID != "" {
				t.Fatalf("unexpected authorization success: %+v, %v", scope, err)
			}
		})
	}
}

func TestDottedUsernameAndRenameKeepsResource(t *testing.T) {
	const subject = "22222222-2222-2222-2222-222222222222"
	for _, username := range []string{"first.last", "user@example.test", "Ünïcodé-名前"} {
		t.Run(username, func(t *testing.T) {
			var client *Client
			client = newTestClient(t, func(w http.ResponseWriter, r *http.Request) {
				if r.URL.Path == "/api/get-user" {
					_ = json.NewEncoder(w).Encode(getUserPayload("waypoint", subject, username))
					return
				}
				var batch [][]string
				_ = json.NewDecoder(r.Body).Decode(&batch)
				if len(batch) != 3 || batch[0][0] != "waypoint/"+username {
					t.Errorf("role lookup must use provider owner/name, got %#v", batch)
				}
				resource := ResourceFor(client.config.Issuer, subject)
				actor := ActorKey(client.config.Issuer, subject)
				for _, row := range batch {
					if row[1] != resource.ID || row[3] != resource.Owner || row[4] != actor {
						t.Errorf("immutable resource/actor changed on rename: %#v", row)
					}
				}
				result(w, []bool{true, false, false})
			})
			scope, err := client.Resolve(context.Background(), subject)
			if err != nil || !scope.Allows(Read) || scope.Allows(Write) {
				t.Fatalf("dotted username scope failed: %+v, %v", scope, err)
			}
			if scope.Resource != ResourceFor(client.config.Issuer, subject) {
				t.Fatalf("resource ID changed on rename: %+v", scope.Resource)
			}
		})
	}
	// Rename keeps the same immutable subject: new username, same resource.
	t.Run("rename", func(t *testing.T) {
		names := []string{"first.last", "first.renamed"}
		for _, username := range names {
			client := newTestClient(t, func(w http.ResponseWriter, r *http.Request) {
				if r.URL.Path == "/api/get-user" {
					_ = json.NewEncoder(w).Encode(getUserPayload("waypoint", subject, username))
					return
				}
				result(w, []bool{true, true, true})
			})
			scope, err := client.Resolve(context.Background(), subject)
			if err != nil || scope.Resource != ResourceFor(client.config.Issuer, subject) {
				t.Fatalf("rename changed immutable resource: %+v, %v", scope, err)
			}
		}
	})
}

func TestNoPermissionGroupsDeniesAll(t *testing.T) {
	client := newTestClient(t, func(w http.ResponseWriter, r *http.Request) {
		if r.URL.Path == "/api/get-user" {
			_ = json.NewEncoder(w).Encode(getUserPayload("waypoint", "alice", "alice"))
			return
		}
		_, _ = w.Write([]byte(`{"status":"ok","data":[],"data2":[]}`))
	})
	scope, err := client.Resolve(context.Background(), "alice")
	if err != nil || scope.Permissions == nil || len(scope.Permissions) != 0 || !scope.Resource.valid() {
		t.Fatalf("unexpected empty scope: %+v, %v", scope, err)
	}
}

func TestUnavailableRedirectAndDeadlineFailClosed(t *testing.T) {
	for _, status := range []int{http.StatusServiceUnavailable, http.StatusUnauthorized, http.StatusFound} {
		t.Run(fmt.Sprint(status), func(t *testing.T) {
			calls := 0
			client := newTestClient(t, func(w http.ResponseWriter, r *http.Request) {
				if r.URL.Path == "/api/get-user" {
					_ = json.NewEncoder(w).Encode(getUserPayload("waypoint", "alice", "alice"))
					return
				}
				calls++
				w.Header().Set("Location", "/redirected")
				w.WriteHeader(status)
				result(w, []bool{true, true, true})
			})
			if scope, err := client.Resolve(context.Background(), "alice"); err == nil || scope.Resource.ID != "" || calls != 1 {
				t.Fatalf("unexpected provider success or redirect: %+v, %v, calls=%d", scope, err, calls)
			}
		})
	}
	client := newTestClient(t, func(w http.ResponseWriter, r *http.Request) {
		if r.URL.Path == "/api/get-user" {
			_ = json.NewEncoder(w).Encode(getUserPayload("waypoint", "alice", "alice"))
			return
		}
		_, _ = io.Copy(io.Discard, r.Body)
		<-r.Context().Done()
	})
	client.client.Timeout = 20 * time.Millisecond
	if scope, err := client.Resolve(context.Background(), "alice"); err == nil || len(scope.Permissions) != 0 {
		t.Fatalf("provider timeout did not fail closed: %+v, %v", scope, err)
	}
	ctx, cancel := context.WithCancel(context.Background())
	cancel()
	if _, err := client.Resolve(ctx, "alice"); err == nil {
		t.Fatal("canceled request did not fail")
	}
}

func TestInternalTransportPreservesPublicHost(t *testing.T) {
	server := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		if r.Host != "identity.example.test" {
			t.Errorf("lost public host: host=%s", r.Host)
		}
		switch {
		case r.URL.Path == "/identity/api/get-user":
			_ = json.NewEncoder(w).Encode(getUserPayload("waypoint", "alice", "alice"))
		case r.URL.Path == "/identity/api/batch-enforce":
			result(w, []bool{true, true, true})
		default:
			t.Errorf("unexpected path: %s", r.URL.Path)
		}
	}))
	defer server.Close()
	client, err := New(Config{Issuer: "https://identity.example.test/identity", InternalURL: server.URL, ClientID: "id", ClientSecret: "secret"})
	if err != nil {
		t.Fatal(err)
	}
	if _, err := client.Resolve(context.Background(), "alice"); err != nil {
		t.Fatal(err)
	}
}

func TestConfigAndRequestValidation(t *testing.T) {
	base := Config{Issuer: "https://identity.example.test", ClientID: "id", ClientSecret: "secret"}
	for _, invalid := range []Config{
		{Issuer: "https://user:secret@identity.example.test", ClientID: "id", ClientSecret: "secret"},
		{Issuer: "https://identity.example.test?query=1", ClientID: "id", ClientSecret: "secret"},
		{Issuer: "https://identity.example.test", ClientID: "bad:id", ClientSecret: "secret"},
		{Issuer: base.Issuer, ClientID: "id"},
		{Issuer: base.Issuer, ClientID: "id", ClientSecret: "secret", InternalURL: "http://private:8000/path"},
		{Issuer: base.Issuer, ClientID: "id", ClientSecret: "secret", ModelID: "model"},
		{Issuer: base.Issuer, ClientID: "id", ClientSecret: "secret", Adapter: "owner/adapter"},
		{Issuer: base.Issuer, ClientID: "id", ClientSecret: "secret", Organization: "owner/org"},
	} {
		if _, err := New(invalid); err == nil {
			t.Errorf("accepted invalid config: %+v", invalid)
		}
	}
	if _, err := New(Config{Issuer: "http://192.168.1.50:8000", ClientID: "id", ClientSecret: "secret", AllowPrivateHTTP: true}); err != nil {
		t.Errorf("rejected opted-in private HTTP issuer: %v", err)
	}
	if _, err := New(Config{Issuer: "http://192.168.1.50:8000", ClientID: "id", ClientSecret: "secret"}); err == nil {
		t.Errorf("accepted private HTTP issuer without opt-in")
	}
	calls := 0
	client := newTestClient(t, func(w http.ResponseWriter, r *http.Request) { calls++ })
	for _, request := range []struct {
		subject  string
		resource Resource
		actions  []string
	}{
		{"", ResourceFor(base.Issuer, "alice"), []string{Read}},
		{"bad\x00subject", ResourceFor(base.Issuer, "alice"), []string{Read}},
		{"alice", Resource{ID: "users/sample", Owner: ActorKey(base.Issuer, "alice")}, []string{Read}},
		{"alice", ResourceFor(base.Issuer, "alice"), []string{"user:admin"}},
		{"alice", ResourceFor(base.Issuer, "alice"), nil},
	} {
		if _, err := client.Check(context.Background(), request.subject, request.resource, request.actions); err == nil {
			t.Errorf("accepted invalid request: %+v", request)
		}
	}
	if calls != 0 {
		t.Fatal("invalid input contacted provider")
	}
}
