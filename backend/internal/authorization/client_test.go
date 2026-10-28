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

func TestResolveChecksAllActionsWithBasicAuth(t *testing.T) {
	var requests [][][]string
	client := newTestClient(t, func(w http.ResponseWriter, r *http.Request) {
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
	expected := [][]string{
		{resource.Owner, resource.ID, Read, resource.Owner},
		{resource.Owner, resource.ID, Project, resource.Owner},
		{resource.Owner, resource.ID, Write, resource.Owner},
	}
	if !reflect.DeepEqual(requests[0], expected) || !reflect.DeepEqual(requests[1], expected) {
		t.Fatalf("unexpected provider inputs: %#v", requests)
	}
}

func TestResolveGuestUsesOnlySample(t *testing.T) {
	client := newTestClient(t, func(w http.ResponseWriter, r *http.Request) {
		var batch [][]string
		_ = json.NewDecoder(r.Body).Decode(&batch)
		expected := [][]string{{"guest", "plans/sample", Read, ""}, {"guest", "plans/sample", Project, ""}, {"guest", "plans/sample", Write, ""}}
		if !reflect.DeepEqual(batch, expected) {
			t.Errorf("unexpected guest inputs: %#v", batch)
		}
		result(w, []bool{true, true, false})
	})
	scope, err := client.Resolve(context.Background(), "")
	if err != nil || scope.Resource != (Resource{ID: "plans/sample", Kind: "sample"}) || !scope.Allows(Read) || !scope.Allows(Project) || scope.Allows(Write) || scope.Allows("plan:admin") {
		t.Fatalf("unexpected guest scope: %+v, %v", scope, err)
	}
}

func TestCheckPreservesCrossOwnerAndSampleMetadata(t *testing.T) {
	var received [][]string
	client := newTestClient(t, func(w http.ResponseWriter, r *http.Request) {
		var batch [][]string
		_ = json.NewDecoder(r.Body).Decode(&batch)
		received = append(received, batch...)
		// A fixture decision is not a substitute implementation of the policy.
		result(w, []bool{false})
	})
	other := ResourceFor(client.config.Issuer, "bob")
	for _, resource := range []Resource{other, ResourceFor(client.config.Issuer, "")} {
		decisions, err := client.Check(context.Background(), "alice", resource, []string{Read})
		if err != nil || !reflect.DeepEqual(decisions, []bool{false}) {
			t.Fatalf("provider deny was not preserved: %v, %v", decisions, err)
		}
	}
	actor := ActorKey(client.config.Issuer, "alice")
	if !reflect.DeepEqual(received, [][]string{{actor, other.ID, Read, other.Owner}, {actor, "plans/sample", Read, ""}}) {
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
		"wrong model":         `{"status":"ok","data":[[true,true,true]],"data2":["elsewhere/model/plan-policy-store"]}`,
		"wrong adapter":       `{"status":"ok","data":[[true,true,true]],"data2":["` + DefaultModelID + `/unknown"]}`,
		"multiple deny allow": `{"status":"ok","data":[[false,false,false],[true,true,true]],"data2":["` + group + `","` + group + `"]}`,
		"mismatched groups":   `{"status":"ok","data":[],"data2":["` + group + `"]}`,
		"trailing JSON":       `{"status":"ok","data":[],"data2":[]} {}`,
		"oversized":           `{"status":"ok","data":[],"data2":[],"msg":"` + strings.Repeat("x", maxResponse) + `"}`,
	} {
		t.Run(name, func(t *testing.T) {
			client := newTestClient(t, func(w http.ResponseWriter, r *http.Request) { _, _ = w.Write([]byte(body)) })
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

func TestNoPermissionGroupsDeniesAll(t *testing.T) {
	client := newTestClient(t, func(w http.ResponseWriter, r *http.Request) {
		_, _ = w.Write([]byte(`{"status":"ok","data":[],"data2":[]}`))
	})
	scope, err := client.Resolve(context.Background(), "alice")
	if err != nil || scope.Permissions == nil || len(scope.Permissions) != 0 || scope.Resource.Kind != "private" {
		t.Fatalf("unexpected empty scope: %+v, %v", scope, err)
	}
}

func TestUnavailableRedirectAndDeadlineFailClosed(t *testing.T) {
	for _, status := range []int{http.StatusServiceUnavailable, http.StatusUnauthorized, http.StatusFound} {
		t.Run(fmt.Sprint(status), func(t *testing.T) {
			calls := 0
			client := newTestClient(t, func(w http.ResponseWriter, r *http.Request) {
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
		if r.Host != "identity.example.test" || r.URL.Path != "/identity/api/batch-enforce" {
			t.Errorf("lost public host or issuer path: host=%s path=%s", r.Host, r.URL.Path)
		}
		result(w, []bool{true, true, true})
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
		{"bad\x00subject", ResourceFor(base.Issuer, "alice"), []string{Read}},
		{"alice", Resource{ID: "plans/sample", Kind: "sample", Owner: ActorKey(base.Issuer, "alice")}, []string{Read}},
		{"alice", Resource{ID: "plans/sample", Kind: "private", Owner: ActorKey(base.Issuer, "alice")}, []string{Read}},
		{"alice", ResourceFor(base.Issuer, "alice"), []string{"plan:admin"}},
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
