package main

import (
	"context"
	"encoding/json"
	"errors"
	"net/http"
	"net/http/httptest"
	"path/filepath"
	"strings"
	"testing"

	"github.com/simhozebs/net-worth-estimator/backend/internal/api"
	"github.com/simhozebs/net-worth-estimator/backend/internal/authorization"
	"github.com/simhozebs/net-worth-estimator/backend/internal/store/adapters/sqlite"
	"github.com/simhozebs/net-worth-estimator/backend/internal/types"
)

func post(t *testing.T, handler http.Handler, method, path, body string) *httptest.ResponseRecorder {
	t.Helper()
	r := httptest.NewRequest(method, path, strings.NewReader(body))
	r.Header.Set("Content-Type", "application/json")
	w := httptest.NewRecorder()
	handler.ServeHTTP(w, r)
	return w
}

func model(t *testing.T, handler http.Handler) *types.FinancialModel {
	t.Helper()
	w := post(t, handler, "GET", "/v1/financial-model", "")
	if w.Code != 200 {
		t.Fatalf("read model=%d %s", w.Code, w.Body.String())
	}
	var out struct {
		Model *types.FinancialModel
	}
	if err := json.Unmarshal(w.Body.Bytes(), &out); err != nil {
		t.Fatal(err)
	}
	return out.Model
}

func TestResourceConfigurationRequiresPolicyDatabase(t *testing.T) {
	c, err := resourceConfigFromEnv(func(string) string { return "" })
	if err == nil || c.PolicyDB != "" {
		t.Fatalf("accepted missing policy database: %+v %v", c, err)
	}
	if c, err := resourceConfigFromEnv(func(name string) string {
		if name == "NET_WORTH_ESTIMATOR_AUTHZ_DB" {
			return "/data/authorization.db"
		}
		return ""
	}); err != nil || c.PolicyDB != "/data/authorization.db" {
		t.Errorf("policy database configuration: %+v %v", c, err)
	}
}

func TestUserProvisioningRequiresAuthorizedIdentity(t *testing.T) {
	database, err := sqlite.SetupDatabase(filepath.Join(t.TempDir(), "app.db"))
	if err != nil {
		t.Fatal(err)
	}
	defer database.Close()
	const issuer = "https://identity.test"
	const guestSubject = "11111111-1111-1111-1111-111111111111"
	for _, test := range []struct {
		name, subject       string
		permissions         []string
		fail, wrongResource bool
		wantUser            bool
	}{
		{name: "denied", subject: "denied"},
		{name: "unknown permission", subject: "unknown-permission", permissions: []string{"other:read"}},
		{name: "provider unavailable", subject: "unavailable", fail: true},
		{name: "wrong scope", subject: "wrong", permissions: []string{authorization.Read}, wrongResource: true},
		{name: "authorized", subject: "new-user", permissions: []string{authorization.Read, authorization.Project, authorization.Write}, wantUser: true},
		{name: "viewer", subject: "viewer-user", permissions: []string{authorization.Read, authorization.Project}, wantUser: true},
		{name: "guest viewer", subject: guestSubject, permissions: []string{authorization.Read, authorization.Project}, wantUser: true},
		{name: "guest editor", subject: guestSubject + "-editor", permissions: []string{authorization.Read, authorization.Project, authorization.Write}, wantUser: true},
		{name: "empty subject fails closed", subject: ""},
	} {
		t.Run(test.name, func(t *testing.T) {
			resolve := userAccessResolver(database, issuer, func(_ context.Context, subject string) (authorization.Scope, error) {
				if test.fail {
					return authorization.Scope{}, errors.New("provider unavailable")
				}
				resource := authorization.ResourceFor(issuer, subject)
				if test.wrongResource {
					resource = authorization.ResourceFor(issuer, "other-user")
				}
				return authorization.Scope{Resource: resource, Permissions: test.permissions}, nil
			})
			scope, err := resolve(context.Background(), test.subject)
			_ = scope
			wantErr := test.fail || test.wrongResource || test.subject == ""
			if (err != nil) != wantErr {
				t.Fatalf("resolve error=%v wantErr=%v", err, wantErr)
			}
			if test.subject == "" {
				return
			}
			exists, err := database.HasUser(authorization.ActorKey(issuer, test.subject))
			if err != nil || exists != test.wantUser {
				t.Fatalf("user exists=%v want=%v err=%v", exists, test.wantUser, err)
			}
			if test.wantUser {
				scoped, err := database.User(authorization.ActorKey(issuer, test.subject))
				if err != nil {
					t.Fatal(err)
				}
				exists, err := scoped.ModelExists()
				if err != nil || !exists {
					t.Fatalf("new user lacks initialized blank model: %v", err)
				}
				if _, err := resolve(context.Background(), test.subject); err != nil {
					t.Fatalf("repeat authorized access: %v", err)
				}
			}
		})
	}
	if exists, err := database.HasUser(authorization.ActorKey(issuer, "other-user")); err != nil || exists {
		t.Fatalf("unexpected authorized resource created a user: exists=%v err=%v", exists, err)
	}
}

func testSyncManager(t *testing.T, database *sqlite.Database) *syncManager {
	t.Helper()
	manager, err := newSyncManager(database, func(string) string { return "" })
	if err != nil {
		t.Fatal(err)
	}
	return manager
}

func TestSyncCredentialUserIDsListOnlyConfiguredUsers(t *testing.T) {
	database, err := sqlite.SetupDatabase(filepath.Join(t.TempDir(), "app.db"))
	if err != nil {
		t.Fatal(err)
	}
	defer database.Close()
	const issuer = "https://identity.test"
	ids := map[string]bool{}
	for _, subject := range []string{"configured-a", "configured-b"} {
		st, err := database.EnsureUser(authorization.ActorKey(issuer, subject), issuer, subject)
		if err != nil {
			t.Fatal(err)
		}
		userID := authorization.ActorKey(issuer, subject)
		if _, err := st.SetSyncCredential("https://bridge.test/"+subject, "bridge.test"); err != nil {
			t.Fatal(err)
		}
		ids[userID] = true
	}
	if _, err := database.EnsureUser(authorization.ActorKey(issuer, "unconfigured"), issuer, "unconfigured"); err != nil {
		t.Fatal(err)
	}
	got, err := database.SyncCredentialUserIDs()
	if err != nil {
		t.Fatal(err)
	}
	if len(got) != len(ids) {
		t.Fatalf("configured user IDs = %v, want %d", got, len(ids))
	}
	for _, id := range got {
		if !ids[id] {
			t.Fatalf("unexpected configured user ID %q", id)
		}
	}
}

func TestUserRouterIsolatesUsersFromEachOther(t *testing.T) {
	database, err := sqlite.SetupDatabase(filepath.Join(t.TempDir(), "app.db"))
	if err != nil {
		t.Fatal(err)
	}
	defer database.Close()
	const issuer = "https://identity.test"
	const guestSubject = "11111111-1111-1111-1111-111111111111"
	owner, err := database.EnsureUser(authorization.ActorKey(issuer, "a"), issuer, "a")
	if err != nil {
		t.Fatal(err)
	}
	if err := owner.InitializeModel(); err != nil {
		t.Fatal(err)
	}
	if _, err := owner.CreateAccount(types.Account{ID: "primary", Name: "Private owner checking", Kind: "cash", Enabled: true}); err != nil {
		t.Fatal(err)
	}
	guestStore, err := database.EnsureUser(authorization.ActorKey(issuer, guestSubject), issuer, guestSubject)
	if err != nil {
		t.Fatal(err)
	}
	if err := guestStore.InitializeModel(); err != nil {
		t.Fatal(err)
	}
	router, err := newUserRouter(database, userRouterConfig{Sync: testSyncManager(t, database), API: api.Config{}})
	if err != nil {
		t.Fatal(err)
	}
	defer router.Close()
	otherStore, err := database.EnsureUser(authorization.ActorKey(issuer, "b"), issuer, "b")
	if err != nil {
		t.Fatal(err)
	}
	if err := otherStore.InitializeModel(); err != nil {
		t.Fatal(err)
	}
	ownerHandler, err := router.handlerFor(authorization.ResourceFor(issuer, "a"))
	if err != nil {
		t.Fatal(err)
	}
	guest, err := router.handlerFor(authorization.ResourceFor(issuer, guestSubject))
	if err != nil {
		t.Fatal(err)
	}
	other, err := router.handlerFor(authorization.ResourceFor(issuer, "b"))
	if err != nil {
		t.Fatal(err)
	}
	if model(t, ownerHandler).Accounts[0].ID != "primary" || len(model(t, other).Accounts) != 0 || len(model(t, guest).Accounts) != 0 {
		t.Fatal("a user exposed another user's financial rows")
	}
	write := `{"id":"other","name":"Other account checking","kind":"cash","enabled":true}`
	if w := post(t, other, "POST", "/v1/accounts", write); w.Code != 200 {
		t.Fatalf("other user write=%d %s", w.Code, w.Body.String())
	}
	// Routing does not force the guest read-only; permission enforcement
	// lives in identity.Wrap. Direct routing therefore isolates but does not
	// deny.
	if w := post(t, guest, "POST", "/v1/accounts", write); w.Code != 200 {
		t.Fatalf("guest canonical write=%d", w.Code)
	}
	if len(model(t, other).Accounts) != 1 || len(model(t, ownerHandler).Accounts) != 1 || len(model(t, guest).Accounts) != 1 {
		t.Fatal("canonical writes crossed the user boundary")
	}
	// Closing the router must not close its shared database.
	if err := router.Close(); err != nil {
		t.Fatal(err)
	}
	if err := database.PingContext(context.Background()); err != nil {
		t.Fatal(err)
	}
	// Requests without a verified scope fail closed. Unknown resources and a
	// malformed non-private resource never provision.
	if w := post(t, router, "GET", "/v1/financial-model", ""); w.Code != 403 {
		t.Fatalf("unverified user routing=%d", w.Code)
	}
	if _, err := router.handlerFor(authorization.Resource{ID: "users/not-a-private-user"}); err == nil {
		t.Fatal("malformed resource provisioned a user")
	}
}

func TestServerBridgeCredentialsStayInTheirUser(t *testing.T) {
	database, err := sqlite.SetupDatabase(filepath.Join(t.TempDir(), "app.db"))
	if err != nil {
		t.Fatal(err)
	}
	defer database.Close()
	const issuer = "https://identity.test"
	const guestSubject = "11111111-1111-1111-1111-111111111111"
	runnerBySubject := map[string]string{}
	for _, subject := range []string{"a", "b"} {
		st, err := database.EnsureUser(authorization.ActorKey(issuer, subject), issuer, subject)
		if err != nil {
			t.Fatal(err)
		}
		if err := st.InitializeModel(); err != nil {
			t.Fatal(err)
		}
		if _, err := st.SetSyncCredential("https://bridge.test/"+subject, "bridge.test"); err != nil {
			t.Fatal(err)
		}
		runnerBySubject[subject] = "bridge.test"
	}
	if _, err := database.EnsureUser(authorization.ActorKey(issuer, guestSubject), issuer, guestSubject); err != nil {
		t.Fatal(err)
	}
	manager := testSyncManager(t, database)
	router, err := newUserRouter(database, userRouterConfig{Sync: manager, API: api.Config{}})
	if err != nil {
		t.Fatal(err)
	}
	defer router.Close()
	for _, subject := range []string{"a", "b", guestSubject} {
		handler, err := router.handlerFor(authorization.ResourceFor(issuer, subject))
		if err != nil {
			t.Fatal(err)
		}
		w := post(t, handler, "GET", "/v1/status", "")
		var status struct {
			SyncConfigured bool `json:"syncConfigured"`
			ReadOnly       bool `json:"readOnly"`
		}
		if err := json.Unmarshal(w.Body.Bytes(), &status); err != nil {
			t.Fatal(err)
		}
		_, wants := runnerBySubject[subject]
		if w.Code != 200 || status.SyncConfigured != wants || status.ReadOnly {
			t.Fatalf("subject %q status=%d %+v", subject, w.Code, status)
		}
	}
}
