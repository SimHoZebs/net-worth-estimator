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
	"github.com/simhozebs/net-worth-estimator/backend/internal/simplefin"
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

func TestResourceConfigurationRejectsLegacyPathsAndUnsafeOwner(t *testing.T) {
	c, err := resourceConfigFromEnv(func(string) string { return "" })
	if err != nil || c.OwnerSubject != "" || c.ModelID != "" || c.Organization != authorization.DefaultOrganization {
		t.Fatalf("unexpected defaults: %+v %v", c, err)
	}
	for key, value := range map[string]string{
		"NET_WORTH_ESTIMATOR_OWNER_SUBJECT": "*",
		"NET_WORTH_ESTIMATOR_PLANS_DIR":     "/data/plans",
		"NET_WORTH_ESTIMATOR_SAMPLE_DB":     "/data/sample.db",
	} {
		_, err := resourceConfigFromEnv(func(name string) string {
			if name == key {
				return value
			}
			return ""
		})
		if err == nil {
			t.Errorf("accepted invalid or retired %s", key)
		}
	}
	if _, err := resourceConfigFromEnv(func(name string) string {
		if name == "NET_WORTH_ESTIMATOR_AUTH_ORGANIZATION" {
			return "owner/org"
		}
		return ""
	}); err == nil {
		t.Error("accepted organization with an owner prefix")
	}
}

func TestOwnerSubjectEnvMigration(t *testing.T) {
	c, err := resourceConfigFromEnv(func(name string) string {
		if name == "NET_WORTH_ESTIMATOR_OWNER_SUBJECT" {
			return "alice"
		}
		return ""
	})
	if err != nil || c.OwnerSubject != "alice" {
		t.Fatalf("new owner var rejected: %+v %v", c, err)
	}
	// The retired plan owner var is gone entirely: it must not error and
	// must not provision an owner.
	c, err = resourceConfigFromEnv(func(name string) string {
		if name == "NET_WORTH_ESTIMATOR_PLAN_OWNER_SUBJECT" {
			return "alice"
		}
		return ""
	})
	if err != nil || c.OwnerSubject != "" {
		t.Fatalf("retired owner var leaked: %+v %v", c, err)
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

func TestOwnerSyncStoreSkipsMissingUser(t *testing.T) {
	database, err := sqlite.SetupDatabase(filepath.Join(t.TempDir(), "app.db"))
	if err != nil {
		t.Fatal(err)
	}
	defer database.Close()
	const issuer, subject = "https://identity.test", "owner"
	if scoped, err := ownerSyncStore(database, issuer, ""); err != nil || scoped != nil {
		t.Fatalf("empty subject = %v, %v; want nil, nil", scoped, err)
	}
	if scoped, err := ownerSyncStore(database, issuer, subject); err != nil || scoped != nil {
		t.Fatalf("missing user = %v, %v; want nil, nil", scoped, err)
	}
	if exists, err := database.HasUser(authorization.ActorKey(issuer, subject)); err != nil || exists {
		t.Fatalf("startup provisioned an owner: %v", err)
	}
	if _, err := database.EnsureUser(authorization.ActorKey(issuer, subject), issuer, subject); err != nil {
		t.Fatal(err)
	}
	if _, err := ownerSyncStore(database, issuer, subject); err != nil {
		t.Fatalf("existing owner rejected: %v", err)
	}
	if scoped, err := ownerSyncStore(database, issuer, "someone-else"); err != nil || scoped != nil {
		t.Fatalf("unrelated subject without a user = %v, %v; want nil, nil", scoped, err)
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
	ownerID := authorization.ResourceFor(issuer, "a").ID
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
	router, err := newUserRouter(database, userRouterConfig{PrimaryResourceID: ownerID})
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
	// Requests without a verified scope fail closed; unknown resources and a
	// non-private primary never provision.
	if w := post(t, router, "GET", "/v1/financial-model", ""); w.Code != 403 {
		t.Fatalf("unverified user routing=%d", w.Code)
	}
	bad, err := newUserRouter(database, userRouterConfig{PrimaryResourceID: "users/sample"})
	if err == nil {
		bad.Close()
		t.Fatal("sample can own server Bridge credentials")
	}
}

func TestServerBridgeCredentialsStayInConfiguredOwnerUser(t *testing.T) {
	database, err := sqlite.SetupDatabase(filepath.Join(t.TempDir(), "app.db"))
	if err != nil {
		t.Fatal(err)
	}
	defer database.Close()
	const issuer = "https://identity.test"
	const guestSubject = "11111111-1111-1111-1111-111111111111"
	ownerID := authorization.ResourceFor(issuer, "a").ID
	ownerStore, err := database.EnsureUser(authorization.ActorKey(issuer, "a"), issuer, "a")
	if err != nil {
		t.Fatal(err)
	}
	if _, err := database.EnsureUser(authorization.ActorKey(issuer, "b"), issuer, "b"); err != nil {
		t.Fatal(err)
	}
	if _, err := database.EnsureUser(authorization.ActorKey(issuer, guestSubject), issuer, guestSubject); err != nil {
		t.Fatal(err)
	}
	router, err := newUserRouter(database, userRouterConfig{
		PrimaryResourceID: ownerID,
		API:               api.Config{SyncRunner: simplefin.NewRunnerWithProvider(ownerStore, simplefin.Config{}, func() (string, map[string]struct{}) { return "https://bridge.test/simplefin", nil }, nil)},
	})
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
		if w.Code != 200 || status.SyncConfigured != (subject == "a") || status.ReadOnly {
			t.Fatalf("subject %q status=%d %+v", subject, w.Code, status)
		}
	}
}
