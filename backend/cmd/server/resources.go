package main

import (
	"context"
	"errors"
	"net/http"
	"strings"

	"github.com/simhozebs/net-worth-estimator/backend/internal/api"
	"github.com/simhozebs/net-worth-estimator/backend/internal/authorization"
	"github.com/simhozebs/net-worth-estimator/backend/internal/identity"
	"github.com/simhozebs/net-worth-estimator/backend/internal/plans"
	"github.com/simhozebs/net-worth-estimator/backend/internal/store/adapters/sqlite"
)

type resourceConfig struct {
	OwnerSubject, ModelID string
}

func resourceConfigFromEnv(getenv func(string) string) (resourceConfig, error) {
	c := resourceConfig{
		OwnerSubject: getenv("NET_WORTH_ESTIMATOR_PLAN_OWNER_SUBJECT"),
		ModelID:      getenv("NET_WORTH_ESTIMATOR_AUTH_PERMISSION_MODEL"),
	}
	if c.OwnerSubject != strings.TrimSpace(c.OwnerSubject) || strings.ContainsAny(c.OwnerSubject, "*\x00\r\n") {
		return c, errors.New("PLAN_OWNER_SUBJECT must be one verified OIDC subject")
	}
	if getenv("NET_WORTH_ESTIMATOR_PLANS_DIR") != "" || getenv("NET_WORTH_ESTIMATOR_SAMPLE_DB") != "" {
		return c, errors.New("PLANS_DIR and SAMPLE_DB are retired; migrate plans into the application database")
	}
	return c, nil
}

func resourceHandler(ctx context.Context, database *sqlite.Database, config resourceConfig, loginConfig identity.Config, apiConfig api.Config) (http.Handler, func() error, error) {
	permissions, err := authorization.New(authorization.Config{
		Issuer: loginConfig.Issuer, InternalURL: loginConfig.InternalURL,
		ClientID: loginConfig.ClientID, ClientSecret: loginConfig.ClientSecret, ModelID: config.ModelID,
		AllowPrivateHTTP: loginConfig.AllowPrivateHTTP,
	})
	if err != nil {
		return nil, nil, err
	}
	primaryID := ""
	if config.OwnerSubject != "" {
		primaryID = authorization.ResourceFor(loginConfig.Issuer, config.OwnerSubject).ID
	}
	apiConfig.CanWrite = identity.CanWrite
	router, err := plans.New(database, plans.Config{
		PrimaryResourceID: primaryID, API: apiConfig,
	})
	if err != nil {
		return nil, nil, err
	}
	loginConfig.Database = database.SQL()
	loginConfig.SessionDB = ""
	loginConfig.ResolveAccess = planAccessResolver(database, loginConfig.Issuer, permissions.Resolve)
	loginConfig.RequireResourceHeader = true
	login, err := identity.New(ctx, loginConfig)
	if err != nil {
		router.Close()
		return nil, nil, err
	}
	return login.Wrap(router), func() error { return errors.Join(login.Close(), router.Close()) }, nil
}

// The subject comes only from a verified identity grant. Casdoor must authorize
// the derived resource before this boundary provisions any private state.
func planAccessResolver(database *sqlite.Database, issuer string, resolve func(context.Context, string) (authorization.Scope, error)) func(context.Context, string) (authorization.Scope, error) {
	return func(ctx context.Context, subject string) (authorization.Scope, error) {
		scope, err := resolve(ctx, subject)
		if err != nil {
			return authorization.Scope{}, err
		}
		expected := authorization.ResourceFor(issuer, subject)
		if scope.Resource != expected {
			return authorization.Scope{}, errors.New("authorization returned an unexpected plan")
		}
		if subject == "" {
			exists, err := database.HasPlan(expected.ID)
			if err != nil {
				return authorization.Scope{}, err
			}
			if !exists {
				scope.Permissions = []string{}
			}
		} else if scope.Allows(authorization.Read) || scope.Allows(authorization.Project) || scope.Allows(authorization.Write) {
			scoped, err := database.EnsurePrivatePlan(expected.ID, authorization.ActorKey(issuer, subject), issuer, subject)
			if err != nil {
				return authorization.Scope{}, err
			}
			if err := scoped.InitializeDocument(); err != nil {
				return authorization.Scope{}, err
			}
		}
		return scope, nil
	}
}
