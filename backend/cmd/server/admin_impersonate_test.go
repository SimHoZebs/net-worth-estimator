package main

import (
	"context"
	"errors"
	"fmt"
	"net/http"
	"path/filepath"
	"strings"
	"testing"

	"github.com/simhozebs/net-worth-estimator/backend/internal/authorization"
	"github.com/simhozebs/net-worth-estimator/backend/internal/identity"
	"github.com/simhozebs/net-worth-estimator/backend/internal/store/adapters/sqlite"
)

const testIssuer = "https://identity.test"

func setupAdminDatabase(t *testing.T, issuer, targetSubject string) (*sqlite.Database, string) {
	t.Helper()
	database, err := sqlite.SetupDatabase(filepath.Join(t.TempDir(), "app.db"))
	if err != nil {
		t.Fatal(err)
	}
	t.Cleanup(func() { _ = database.Close() })
	targetResource := authorization.ResourceFor(issuer, targetSubject)
	if _, err := database.EnsureUser(targetResource.Owner, issuer, targetSubject); err != nil {
		t.Fatal(err)
	}
	return database, targetResource.ID
}

func adminEnv(t *testing.T, subject string) func(string) string {
	t.Helper()
	return func(name string) string {
		if name == adminSubjectEnv {
			return subject
		}
		return ""
	}
}

func TestAdminImpersonatorDisabledByDefault(t *testing.T) {
	database, _ := setupAdminDatabase(t, testIssuer, "target")
	check := func(context.Context, string, authorization.Resource, []string) ([]bool, error) {
		return []bool{true, true, true}, nil
	}
	hook, err := adminImpersonator(database, check, func(string) string { return "" })
	if err != nil {
		t.Fatal(err)
	}
	if hook != nil {
		t.Fatal("impersonator enabled without NET_WORTH_ESTIMATOR_ADMIN_SUBJECT")
	}
}

func TestAdminImpersonatorRejectsMalformedSubject(t *testing.T) {
	database, _ := setupAdminDatabase(t, testIssuer, "target")
	check := func(context.Context, string, authorization.Resource, []string) ([]bool, error) {
		return []bool{true, true, true}, nil
	}
	if _, err := adminImpersonator(database, check, adminEnv(t, "admin with spaces")); err == nil {
		t.Fatal("malformed subject accepted")
	}
}

func TestAdminImpersonatorBranch(t *testing.T) {
	const adminSubject = "admin-subject"
	const targetSubject = "target-subject"
	database, targetHeader := setupAdminDatabase(t, testIssuer, targetSubject)

	checkOK := func(_ context.Context, subject string, resource authorization.Resource, actions []string) ([]bool, error) {
		if subject != targetSubject {
			return nil, fmt.Errorf("check called with subject %q, want the target's", subject)
		}
		if resource.Owner != authorization.ActorKey(testIssuer, targetSubject) {
			return nil, fmt.Errorf("owner=%q", resource.Owner)
		}
		return []bool{true, true, true}, nil
	}

	adminPrincipal := identity.Principal{Subject: adminSubject, Authenticated: true}
	targetResource := authorization.ResourceFor(testIssuer, targetSubject)

	tests := []struct {
		name        string
		principal   identity.Principal
		header      string
		check       func(context.Context, string, authorization.Resource, []string) ([]bool, error)
		wantHandled bool
		wantStatus  int
		wantSubject string
		wantPerms   []string
	}{
		{
			name:        "member target receives full scope as the target's identity",
			principal:   adminPrincipal,
			header:      targetHeader,
			wantHandled: true,
			wantSubject: targetSubject,
			wantPerms:   []string{authorization.Read, authorization.Project, authorization.Write},
		},
		{
			name:        "anonymous caller is not the admin",
			principal:   identity.Principal{Subject: "someone-else"},
			header:      targetHeader,
			wantHandled: false,
		},
		{
			name:        "admin without a signed-in session is refused",
			principal:   identity.Principal{Subject: adminSubject, Authenticated: false},
			header:      targetHeader,
			wantHandled: true,
			wantStatus:  http.StatusForbidden,
		},
		{
			name:        "malformed resource header is refused",
			principal:   adminPrincipal,
			header:      "users/not-hex",
			wantHandled: true,
			wantStatus:  http.StatusBadRequest,
		},
		{
			name:        "unknown target resource is a 404",
			principal:   adminPrincipal,
			header:      "users/" + strings.Repeat("c", 64),
			wantHandled: true,
			wantStatus:  http.StatusNotFound,
		},
		{
			name:      "authorization failure maps to 503",
			principal: adminPrincipal,
			header:    targetHeader,
			check: func(context.Context, string, authorization.Resource, []string) ([]bool, error) {
				return nil, errors.New("provider down")
			},
			wantHandled: true,
			wantStatus:  http.StatusServiceUnavailable,
		},
		{
			name:      "target without actions is refused",
			principal: adminPrincipal,
			header:    targetHeader,
			check: func(context.Context, string, authorization.Resource, []string) ([]bool, error) {
				return []bool{false, false, false}, nil
			},
			wantHandled: true,
			wantStatus:  http.StatusForbidden,
		},
		{
			name:      "viewer guest target receives read and project only",
			principal: adminPrincipal,
			header:    targetHeader,
			check: func(context.Context, string, authorization.Resource, []string) ([]bool, error) {
				return []bool{true, true, false}, nil
			},
			wantHandled: true,
			wantSubject: targetSubject,
			wantPerms:   []string{authorization.Read, authorization.Project},
		},
	}
	for _, test := range tests {
		t.Run(test.name, func(t *testing.T) {
			check := test.check
			if check == nil {
				check = checkOK
			}
			localHook, err := adminImpersonator(database, check, adminEnv(t, adminSubject))
			if err != nil {
				t.Fatal(err)
			}
			gotPrincipal, gotScope, handled, hookErr := localHook(context.Background(), test.principal, test.header)
			if handled != test.wantHandled {
				t.Fatalf("handled=%v want=%v", handled, test.wantHandled)
			}
			if test.wantStatus != 0 {
				var statusCoder interface{ StatusCode() int }
				if !errors.As(hookErr, &statusCoder) {
					t.Fatalf("error=%v, want a status-coded error", hookErr)
				}
				if statusCoder.StatusCode() != test.wantStatus {
					t.Fatalf("status=%d want=%d", statusCoder.StatusCode(), test.wantStatus)
				}
				return
			}
			if hookErr != nil {
				t.Fatal(hookErr)
			}
			if !test.wantHandled {
				return
			}
			if gotPrincipal.Subject != test.wantSubject || !gotPrincipal.Authenticated {
				t.Fatalf("principal=%+v", gotPrincipal)
			}
			if gotScope.Resource != targetResource {
				t.Fatalf("resource=%+v", gotScope.Resource)
			}
			if strings.Join(gotScope.Permissions, ",") != strings.Join(test.wantPerms, ",") {
				t.Fatalf("permissions=%v want=%v", gotScope.Permissions, test.wantPerms)
			}
		})
	}
}
