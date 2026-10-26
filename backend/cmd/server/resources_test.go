package main

import (
	"context"
	"errors"
	"path/filepath"
	"testing"

	"github.com/simhozebs/net-worth-estimator/backend/internal/authorization"
	"github.com/simhozebs/net-worth-estimator/backend/internal/store"
)

func TestResourceConfigurationRejectsLegacyPathsAndUnsafeOwner(t *testing.T) {
	c, err := resourceConfigFromEnv(func(string) string { return "" })
	if err != nil || c.OwnerSubject != "" || c.ModelID != "" {
		t.Fatalf("unexpected defaults: %+v %v", c, err)
	}
	for key, value := range map[string]string{
		"NET_WORTH_ESTIMATOR_PLAN_OWNER_SUBJECT": "*",
		"NET_WORTH_ESTIMATOR_PLANS_DIR":          "/data/plans",
		"NET_WORTH_ESTIMATOR_SAMPLE_DB":          "/data/sample.db",
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

func TestPlanProvisioningRequiresAuthorizedIdentity(t *testing.T) {
	database, err := store.SetupDatabase(filepath.Join(t.TempDir(), "app.db"))
	if err != nil {
		t.Fatal(err)
	}
	defer database.Close()
	const issuer = "https://identity.test"
	for _, test := range []struct {
		name, subject       string
		permissions         []string
		fail, wrongResource bool
		wantPlan            bool
	}{
		{name: "denied", subject: "denied"},
		{name: "unknown permission", subject: "unknown-permission", permissions: []string{"other:read"}},
		{name: "provider unavailable", subject: "unavailable", fail: true},
		{name: "wrong scope", subject: "wrong", permissions: []string{authorization.Read}, wrongResource: true},
		{name: "authorized", subject: "new-user", permissions: []string{authorization.Read, authorization.Project, authorization.Write}, wantPlan: true},
		{name: "guest", permissions: []string{authorization.Read, authorization.Project}},
	} {
		t.Run(test.name, func(t *testing.T) {
			resolve := planAccessResolver(database, issuer, func(_ context.Context, subject string) (authorization.Scope, error) {
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
			exists, err := database.HasPlan(authorization.ResourceFor(issuer, test.subject).ID)
			if err != nil || exists != test.wantPlan {
				t.Fatalf("plan exists=%v want=%v err=%v", exists, test.wantPlan, err)
			}
			if test.subject == "" && len(scope.Permissions) != 0 {
				t.Fatalf("unpublished sample received permissions: %+v", scope)
			}
			if test.wantPlan {
				scoped, err := database.Plan(scope.Resource.ID)
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
	if exists, err := database.HasPlan(authorization.ResourceFor(issuer, "other-user").ID); err != nil || exists {
		t.Fatalf("unexpected authorized resource created a plan: exists=%v err=%v", exists, err)
	}
	if _, err := database.EnsureSamplePlan(); err != nil {
		t.Fatal(err)
	}
	resolve := planAccessResolver(database, issuer, func(_ context.Context, subject string) (authorization.Scope, error) {
		return authorization.Scope{Resource: authorization.ResourceFor(issuer, subject), Permissions: []string{authorization.Read, authorization.Project}}, nil
	})
	scope, err := resolve(context.Background(), "")
	if err != nil || !scope.Allows(authorization.Read) || scope.Allows(authorization.Write) {
		t.Fatalf("published sample permissions=%+v err=%v", scope, err)
	}
}

func TestBridgeCredentialsRequireExistingConfiguredOwner(t *testing.T) {
	database, err := store.SetupDatabase(filepath.Join(t.TempDir(), "app.db"))
	if err != nil {
		t.Fatal(err)
	}
	defer database.Close()
	const issuer, subject = "https://identity.test", "owner"
	if scoped, err := bridgeStore(database, issuer, "", false); err != nil || scoped != nil {
		t.Fatalf("disabled Bridge requires a plan: %v", err)
	}
	if _, err := bridgeStore(database, issuer, "", true); err == nil {
		t.Fatal("Bridge accepted an unconfigured owner")
	}
	if _, err := bridgeStore(database, issuer, subject, true); err == nil {
		t.Fatal("Bridge accepted a missing owner plan")
	}
	resource := authorization.ResourceFor(issuer, subject)
	if exists, err := database.HasPlan(resource.ID); err != nil || exists {
		t.Fatalf("startup provisioned an owner: %v", err)
	}
	if _, err := database.EnsurePrivatePlan(resource.ID, resource.Owner, issuer, subject); err != nil {
		t.Fatal(err)
	}
	if _, err := bridgeStore(database, issuer, subject, true); err != nil {
		t.Fatalf("existing owner rejected: %v", err)
	}
	if _, err := bridgeStore(database, issuer, "someone-else", true); err == nil {
		t.Fatal("Bridge fell back to another owner's plan")
	}
}

func TestBridgeBYOKStoreSkipsMissingPlan(t *testing.T) {
	database, err := store.SetupDatabase(filepath.Join(t.TempDir(), "app.db"))
	if err != nil {
		t.Fatal(err)
	}
	defer database.Close()
	const issuer, subject = "https://identity.test", "owner"
	if scoped, err := bridgeBYOKStore(database, issuer, ""); err != nil || scoped != nil {
		t.Fatalf("empty subject = %v, %v; want nil, nil", scoped, err)
	}
	if scoped, err := bridgeBYOKStore(database, issuer, subject); err != nil || scoped != nil {
		t.Fatalf("missing plan = %v, %v; want nil, nil", scoped, err)
	}
	resource := authorization.ResourceFor(issuer, subject)
	if exists, err := database.HasPlan(resource.ID); err != nil || exists {
		t.Fatalf("startup provisioned an owner: %v", err)
	}
	if _, err := database.EnsurePrivatePlan(resource.ID, resource.Owner, issuer, subject); err != nil {
		t.Fatal(err)
	}
	if _, err := bridgeBYOKStore(database, issuer, subject); err != nil {
		t.Fatalf("existing owner rejected: %v", err)
	}
}
