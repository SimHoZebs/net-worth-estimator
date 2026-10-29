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

func model(t *testing.T, handler http.Handler) *types.FinancialModelDocument {
	t.Helper()
	w := post(t, handler, "GET", "/v1/financial-model", "")
	if w.Code != 200 {
		t.Fatalf("read model=%d %s", w.Code, w.Body.String())
	}
	var out struct {
		Document *types.FinancialModelDocument
	}
	if err := json.Unmarshal(w.Body.Bytes(), &out); err != nil {
		t.Fatal(err)
	}
	return out.Document
}

func TestResourceConfigurationRejectsLegacyPathsAndUnsafeOwner(t *testing.T) {
	c, err := resourceConfigFromEnv(func(string) string { return "" })
	if err != nil || c.OwnerSubject != "" || c.ModelID != "" {
		t.Fatalf("unexpected defaults: %+v %v", c, err)
	}
	for key, value := range map[string]string{
		"NET_WORTH_ESTIMATOR_ACCOUNT_OWNER_SUBJECT": "*",
		"NET_WORTH_ESTIMATOR_PLANS_DIR":             "/data/plans",
		"NET_WORTH_ESTIMATOR_SAMPLE_DB":             "/data/sample.db",
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
}

func TestAccountOwnerSubjectEnvMigration(t *testing.T) {
	c, err := resourceConfigFromEnv(func(name string) string {
		if name == "NET_WORTH_ESTIMATOR_ACCOUNT_OWNER_SUBJECT" {
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

func TestAccountProvisioningRequiresAuthorizedIdentity(t *testing.T) {
	database, err := sqlite.SetupDatabase(filepath.Join(t.TempDir(), "app.db"))
	if err != nil {
		t.Fatal(err)
	}
	defer database.Close()
	const issuer = "https://identity.test"
	for _, test := range []struct {
		name, subject       string
		permissions         []string
		fail, wrongResource bool
		wantAccount         bool
	}{
		{name: "denied", subject: "denied"},
		{name: "unknown permission", subject: "unknown-permission", permissions: []string{"other:read"}},
		{name: "provider unavailable", subject: "unavailable", fail: true},
		{name: "wrong scope", subject: "wrong", permissions: []string{authorization.Read}, wrongResource: true},
		{name: "authorized", subject: "new-user", permissions: []string{authorization.Read, authorization.Project, authorization.Write}, wantAccount: true},
		{name: "guest", permissions: []string{authorization.Read, authorization.Project}},
	} {
		t.Run(test.name, func(t *testing.T) {
			resolve := accountAccessResolver(database, issuer, func(_ context.Context, subject string) (authorization.Scope, error) {
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
			if (err != nil) != (test.fail || test.wrongResource) {
				t.Fatalf("resolve error=%v", err)
			}
			exists, err := database.HasAccount(authorization.ActorKey(issuer, test.subject))
			if err != nil || exists != test.wantAccount {
				t.Fatalf("account exists=%v want=%v err=%v", exists, test.wantAccount, err)
			}
			if test.subject == "" && len(scope.Permissions) != 0 {
				t.Fatalf("unpublished sample received permissions: %+v", scope)
			}
			if test.wantAccount {
				scoped, err := database.Account(authorization.ActorKey(issuer, test.subject))
				if err != nil {
					t.Fatal(err)
				}
				exists, err := scoped.DocumentExists()
				if err != nil || !exists {
					t.Fatalf("new user lacks initialized blank document: %v", err)
				}
				if _, err := resolve(context.Background(), test.subject); err != nil {
					t.Fatalf("repeat authorized access: %v", err)
				}
			}
		})
	}
	if exists, err := database.HasAccount(authorization.ActorKey(issuer, "other-user")); err != nil || exists {
		t.Fatalf("unexpected authorized resource created an account: exists=%v err=%v", exists, err)
	}
	if _, err := database.EnsureSampleAccount(); err != nil {
		t.Fatal(err)
	}
	resolve := accountAccessResolver(database, issuer, func(_ context.Context, subject string) (authorization.Scope, error) {
		return authorization.Scope{Resource: authorization.ResourceFor(issuer, subject), Permissions: []string{authorization.Read, authorization.Project}}, nil
	})
	scope, err := resolve(context.Background(), "")
	if err != nil || !scope.Allows(authorization.Read) || scope.Allows(authorization.Write) {
		t.Fatalf("published sample permissions=%+v err=%v", scope, err)
	}
}

func TestOwnerSyncStoreSkipsMissingAccount(t *testing.T) {
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
		t.Fatalf("missing account = %v, %v; want nil, nil", scoped, err)
	}
	if exists, err := database.HasAccount(authorization.ActorKey(issuer, subject)); err != nil || exists {
		t.Fatalf("startup provisioned an owner: %v", err)
	}
	if _, err := database.EnsureAccount(authorization.ActorKey(issuer, subject), issuer, subject); err != nil {
		t.Fatal(err)
	}
	if _, err := ownerSyncStore(database, issuer, subject); err != nil {
		t.Fatalf("existing owner rejected: %v", err)
	}
	if scoped, err := ownerSyncStore(database, issuer, "someone-else"); err != nil || scoped != nil {
		t.Fatalf("unrelated subject without an account = %v, %v; want nil, nil", scoped, err)
	}
}

func TestAccountRouterIsolatesAccountsFromSampleAndEachOther(t *testing.T) {
	database, err := sqlite.SetupDatabase(filepath.Join(t.TempDir(), "app.db"))
	if err != nil {
		t.Fatal(err)
	}
	defer database.Close()
	const issuer = "https://identity.test"
	ownerID := authorization.ResourceFor(issuer, "a").ID
	owner, err := database.EnsureAccount(authorization.ActorKey(issuer, "a"), issuer, "a")
	if err != nil {
		t.Fatal(err)
	}
	if err := owner.InitializeDocument(); err != nil {
		t.Fatal(err)
	}
	if _, err := owner.CreateAccount(types.Account{ID: "primary", Name: "Private owner checking", Kind: "cash", Enabled: true}); err != nil {
		t.Fatal(err)
	}
	if _, err := database.EnsureSampleAccount(); err != nil {
		t.Fatal(err)
	}
	router, err := newAccountRouter(database, accountRouterConfig{PrimaryResourceID: ownerID})
	if err != nil {
		t.Fatal(err)
	}
	defer router.Close()
	otherStore, err := database.EnsureAccount(authorization.ActorKey(issuer, "b"), issuer, "b")
	if err != nil {
		t.Fatal(err)
	}
	if err := otherStore.InitializeDocument(); err != nil {
		t.Fatal(err)
	}
	ownerHandler, err := router.handlerFor(authorization.ResourceFor(issuer, "a"))
	if err != nil {
		t.Fatal(err)
	}
	guest, err := router.handlerFor(authorization.ResourceFor(issuer, ""))
	if err != nil {
		t.Fatal(err)
	}
	other, err := router.handlerFor(authorization.ResourceFor(issuer, "b"))
	if err != nil {
		t.Fatal(err)
	}
	if model(t, ownerHandler).Accounts[0].ID != "primary" || len(model(t, other).Accounts) != 0 {
		t.Fatal("an account exposed another account's financial rows")
	}
	write := `{"id":"other","name":"Other account checking","kind":"cash","enabled":true}`
	if w := post(t, other, "POST", "/v1/accounts", write); w.Code != 200 {
		t.Fatalf("other account write=%d %s", w.Code, w.Body.String())
	}
	if w := post(t, guest, "POST", "/v1/accounts", write); w.Code != 403 {
		t.Fatalf("sample canonical write=%d", w.Code)
	}
	if len(model(t, other).Accounts) != 1 || len(model(t, ownerHandler).Accounts) != 1 {
		t.Fatal("canonical writes crossed the account boundary")
	}
	// Closing the router must not close its shared database.
	if err := router.Close(); err != nil {
		t.Fatal(err)
	}
	if err := database.PingContext(context.Background()); err != nil {
		t.Fatal(err)
	}
	// Requests without a verified scope fail closed; unknown resources and the
	// sample-as-primary never provision.
	if w := post(t, router, "GET", "/v1/financial-model", ""); w.Code != 403 {
		t.Fatalf("unverified account routing=%d", w.Code)
	}
	bad, err := newAccountRouter(database, accountRouterConfig{PrimaryResourceID: "accounts/sample"})
	if err == nil {
		bad.Close()
		t.Fatal("sample can own server Bridge credentials")
	}
}

func TestServerBridgeCredentialsStayInConfiguredOwnerAccount(t *testing.T) {
	database, err := sqlite.SetupDatabase(filepath.Join(t.TempDir(), "app.db"))
	if err != nil {
		t.Fatal(err)
	}
	defer database.Close()
	const issuer = "https://identity.test"
	ownerID := authorization.ResourceFor(issuer, "a").ID
	ownerStore, err := database.EnsureAccount(authorization.ActorKey(issuer, "a"), issuer, "a")
	if err != nil {
		t.Fatal(err)
	}
	if _, err := database.EnsureAccount(authorization.ActorKey(issuer, "b"), issuer, "b"); err != nil {
		t.Fatal(err)
	}
	if _, err := database.EnsureSampleAccount(); err != nil {
		t.Fatal(err)
	}
	router, err := newAccountRouter(database, accountRouterConfig{
		PrimaryResourceID: ownerID,
		API:               api.Config{SyncRunner: simplefin.NewRunnerWithProvider(ownerStore, simplefin.Config{}, func() (string, map[string]struct{}) { return "https://bridge.test/simplefin", nil }, nil)},
	})
	if err != nil {
		t.Fatal(err)
	}
	defer router.Close()
	for _, subject := range []string{"a", "b", ""} {
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
		if w.Code != 200 || status.SyncConfigured != (subject == "a") || status.ReadOnly != (subject == "") {
			t.Fatalf("subject %q status=%d %+v", subject, w.Code, status)
		}
	}
}
