package main

import (
	"context"
	"fmt"
	"net/http"
	"regexp"
	"strings"

	"github.com/simhozebs/net-worth-estimator/backend/internal/authorization"
	"github.com/simhozebs/net-worth-estimator/backend/internal/identity"
	"github.com/simhozebs/net-worth-estimator/backend/internal/store/adapters/sqlite"
)

// adminSubjectEnv names the one verified OIDC subject allowed to use the
// admin observation branch. Unset means the branch is disabled and the
// boundary behaves exactly as if the code were absent.
const adminSubjectEnv = "NET_WORTH_ESTIMATOR_ADMIN_SUBJECT"

type impersonateError struct {
	status  int
	message string
}

func (e impersonateError) Error() string   { return e.message }
func (e impersonateError) StatusCode() int { return e.status }

var resourceHeaderPattern = regexp.MustCompile(`^users/[a-f0-9]{64}$`)

// adminImpersonator builds the development-scoped admin observation branch.
// A dedicated provider account signs in with this subject; every request must
// then name the target user via the Waypoint-Resource header and receives
// exactly the target's own verified permissions, enforced live by Casbin
// for the target's identity. The administrator never borrows authority the
// target does not have: a viewer guest yields read and project only.
//
// The check delegates to embedded Casbin with the target's
// subject, so the target's own group grants decide; removing the admin
// account from every privileged role leaves only the target's grants. Audit
// evidence is one structured line per request naming the admin actor and the
// target resource.
//
// The branch returns handled=false for every caller that is not the
// configured subject, so the standard own-resource boundary is untouched.
func adminImpersonator(database *sqlite.Database, check func(ctx context.Context, subject string, resource authorization.Resource, actions []string) ([]bool, error), getenv func(string) string) (func(context.Context, identity.Principal, string) (identity.Principal, authorization.Scope, bool, error), error) {
	adminSubject := strings.TrimSpace(getenv(adminSubjectEnv))
	if adminSubject == "" {
		return nil, nil
	}
	if strings.ContainsAny(adminSubject, " \t\r\n\x00") {
		return nil, fmt.Errorf("%s must be one verified OIDC subject", adminSubjectEnv)
	}
	return func(ctx context.Context, p identity.Principal, resourceHeader string) (identity.Principal, authorization.Scope, bool, error) {
		if p.Subject != adminSubject {
			return identity.Principal{}, authorization.Scope{}, false, nil
		}
		if !p.Authenticated {
			return identity.Principal{}, authorization.Scope{}, true, impersonateError{
				status:  http.StatusForbidden,
				message: "Admin observation requires a signed-in admin.",
			}
		}
		if !resourceHeaderPattern.MatchString(resourceHeader) {
			return identity.Principal{}, authorization.Scope{}, true, impersonateError{
				status:  http.StatusBadRequest,
				message: "A users/<64hex> Waypoint-Resource header is required.",
			}
		}
		hash := strings.TrimPrefix(resourceHeader, "users/")
		targetActor := "user:" + hash
		_, targetSubject, found, err := database.LookupUser(targetActor)
		if err != nil {
			return identity.Principal{}, authorization.Scope{}, true, impersonateError{
				status:  http.StatusServiceUnavailable,
				message: "User lookup is temporarily unavailable. Retry this request.",
			}
		}
		if !found {
			return identity.Principal{}, authorization.Scope{}, true, impersonateError{
				status:  http.StatusNotFound,
				message: "Unknown user resource.",
			}
		}
		targetResource := authorization.Resource{ID: resourceHeader, Owner: targetActor}
		actions := []string{authorization.Read, authorization.Project, authorization.Write}
		allowed, err := check(ctx, targetSubject, targetResource, actions)
		if err != nil {
			return identity.Principal{}, authorization.Scope{}, true, impersonateError{
				status:  http.StatusServiceUnavailable,
				message: "Authorization is temporarily unavailable. Retry this request.",
			}
		}
		scope := authorization.Scope{Resource: targetResource, Permissions: []string{}}
		for index, allow := range allowed {
			if allow {
				scope.Permissions = append(scope.Permissions, actions[index])
			}
		}
		if len(scope.Permissions) == 0 {
			return identity.Principal{}, authorization.Scope{}, true, impersonateError{
				status:  http.StatusForbidden,
				message: "This target grants no actions.",
			}
		}
		return identity.Principal{Subject: targetSubject, Authenticated: true}, scope, true, nil
	}, nil
}
