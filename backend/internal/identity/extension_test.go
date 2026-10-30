package identity

import (
	"bytes"
	"encoding/json"
	"net/http"
	"net/http/httptest"
	"path/filepath"
	"testing"

	"github.com/simhozebs/net-worth-estimator/backend/internal/api"
	"github.com/simhozebs/net-worth-estimator/backend/internal/store/adapters/sqlite"
	"github.com/simhozebs/net-worth-estimator/backend/internal/types"
)

const testExtensionOrigin = "chrome-extension://abcdefghijklmnopabcdefghijklmnop"

func TestExtensionTokenTransportAndOriginBoundary(t *testing.T) {
	p := newIDP(t)
	s := newService(t, p, filepath.Join(t.TempDir(), "sessions.db"))
	hits := 0
	handler := s.Wrap(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		hits++
		if r.Header.Get("Cookie") != "" || r.Header.Get("Origin") != "" || r.Header.Get("Sec-Fetch-Site") != "none" {
			t.Error("transport must strip cookies and origin, but preserve Fetch Metadata")
		}
		w.WriteHeader(204)
	}))
	for _, tc := range []struct {
		name, origin, path, token, site string
		want                            int
	}{
		{"purchase", testExtensionOrigin, "/v1/planned-purchases", "access-device", "none", 204},
		{"without token", testExtensionOrigin, "/v1/planned-purchases", "", "none", 401},
		{"invalid token", testExtensionOrigin, "/v1/planned-purchases", "retired-token", "none", 401},
		{"posting", testExtensionOrigin, "/v1/postings", "access-device", "none", 403},
		{"unrelated route", testExtensionOrigin, "/v1/accounts", "access-device", "none", 403},
		{"website", "https://attacker.test", "/v1/planned-purchases", "access-device", "cross-site", 403},
		{"lookalike", testExtensionOrigin + ".evil.test", "/v1/planned-purchases", "access-device", "none", 403},
		{"cross-site metadata", testExtensionOrigin, "/v1/planned-purchases", "access-device", "cross-site", 403},
	} {
		t.Run(tc.name, func(t *testing.T) {
			r := httptest.NewRequest("POST", s.config.PublicURL+tc.path, bytes.NewBufferString(`{}`))
			r.Header.Set("Origin", tc.origin)
			r.Header.Set("Sec-Fetch-Site", tc.site)
			r.Header.Set("Cookie", "waypoint_session=ambient")
			if tc.token != "" {
				r.Header.Set("Authorization", "Bearer "+tc.token)
			}
			w := httptest.NewRecorder()
			handler.ServeHTTP(w, r)
			if w.Code != tc.want {
				t.Fatalf("status=%d want=%d body=%s", w.Code, tc.want, w.Body.String())
			}
			if w.Header().Get("Access-Control-Allow-Origin") != "" {
				t.Error("host-permitted fetches need no CORS expansion")
			}
		})
	}
	if hits != 1 {
		t.Fatalf("unexpected downstream calls: %d", hits)
	}
}

func TestExtensionDeviceStart(t *testing.T) {
	p := newIDP(t)
	s := newService(t, p, filepath.Join(t.TempDir(), "sessions.db"))
	handler := s.Wrap(http.NotFoundHandler())
	r := httptest.NewRequest("POST", s.config.PublicURL+prefix+"device/start", bytes.NewBufferString(`{}`))
	r.Header.Set("Origin", testExtensionOrigin)
	r.Header.Set("Sec-Fetch-Site", "none")
	w := httptest.NewRecorder()
	handler.ServeHTTP(w, r)
	if w.Code != 200 {
		t.Fatalf("device start: %d %s", w.Code, w.Body.String())
	}
}

func TestExtensionUsesPlannedPurchaseAPI(t *testing.T) {
	p := newIDP(t)
	database, err := sqlite.SetupDatabase(filepath.Join(t.TempDir(), "app.db"))
	if err != nil {
		t.Fatal(err)
	}
	t.Cleanup(func() { database.Close() })
	s := newService(t, p, "", func(c *Config) { c.Store = database; c.RequireResourceHeader = true })
	plan, err := database.EnsureUser("editor", p.server.URL, "editor")
	if err != nil {
		t.Fatal(err)
	}
	if _, err := plan.CreateAccount(types.Account{ID: "cash", Name: "Cash", Kind: "cash", Enabled: true}); err != nil {
		t.Fatal(err)
	}
	handler := s.Wrap(api.New(plan, api.Config{}))
	const payload = `{"id":"01900000-0000-7000-8000-000000000091","name":"Desk","fundingAccountId":"cash","cost":129.95,"earliestDate":"2026-10-30","priority":0,"enabled":true}`
	request := func(method, path, body, resource string) *httptest.ResponseRecorder {
		r := httptest.NewRequest(method, s.config.PublicURL+path, bytes.NewBufferString(body))
		r.Header.Set("Authorization", "Bearer access-device")
		r.Header.Set("Sec-Fetch-Site", "none")
		if resource != "" {
			r.Header.Set(ResourceHeader, resource)
		}
		if method == "POST" {
			r.Header.Set("Origin", testExtensionOrigin)
			r.Header.Set("Content-Type", "application/json")
		}
		w := httptest.NewRecorder()
		handler.ServeHTTP(w, r)
		return w
	}
	session := request("GET", prefix+"session", "", "")
	var identity struct {
		Resource struct {
			ID string `json:"id"`
		} `json:"resource"`
	}
	if err := json.Unmarshal(session.Body.Bytes(), &identity); err != nil || identity.Resource.ID == "" {
		t.Fatalf("identity: %s %v", session.Body.String(), err)
	}
	if w := request("POST", "/v1/planned-purchases", payload, "users/wrong"); w.Code != 409 {
		t.Fatalf("scope guard: %d %s", w.Code, w.Body.String())
	}
	for _, want := range []int{200, 409} {
		if w := request("POST", "/v1/planned-purchases", payload, identity.Resource.ID); w.Code != want {
			t.Fatalf("save: %d want %d %s", w.Code, want, w.Body.String())
		}
	}
	for _, path := range []string{"/v1/financial-model", "/v1/status"} {
		if w := request("GET", path, "", identity.Resource.ID); w.Code != 200 {
			t.Fatalf("read %s: %d %s", path, w.Code, w.Body.String())
		}
	}
	model, err := plan.LoadModel()
	if err != nil || len(model.Postings) != 0 || len(model.PlannedPurchases) != 1 {
		t.Fatalf("purchase persistence: %+v %v", model, err)
	}
	readOnly := s.Wrap(api.New(plan, api.Config{ReadOnly: true}))
	r := httptest.NewRequest("POST", s.config.PublicURL+"/v1/planned-purchases", bytes.NewBufferString(payload))
	r.Header.Set("Origin", testExtensionOrigin)
	r.Header.Set("Sec-Fetch-Site", "none")
	r.Header.Set("Authorization", "Bearer access-device")
	r.Header.Set(ResourceHeader, identity.Resource.ID)
	w := httptest.NewRecorder()
	readOnly.ServeHTTP(w, r)
	if w.Code != 403 {
		t.Fatalf("read-only guard: %d %s", w.Code, w.Body.String())
	}
}
