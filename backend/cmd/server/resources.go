package main

import (
	"context"
	"errors"
	"net/http"
	"os"
	"path/filepath"
	"strings"
	"time"

	"github.com/simhozebs/net-worth-estimator/backend/internal/api"
	"github.com/simhozebs/net-worth-estimator/backend/internal/authorization"
	"github.com/simhozebs/net-worth-estimator/backend/internal/identity"
	"github.com/simhozebs/net-worth-estimator/backend/internal/plans"
	"github.com/simhozebs/net-worth-estimator/backend/internal/store"
)

type resourceConfig struct {
	OwnerSubject, PrivateDir, SampleDB, ModelID string
	WarmDebounce                                time.Duration
}

func resourceConfigFromEnv(getenv func(string) string, dbPath string) (resourceConfig, error) {
	c := resourceConfig{
		OwnerSubject: getenv("NET_WORTH_ESTIMATOR_PLAN_OWNER_SUBJECT"),
		PrivateDir:   getenv("NET_WORTH_ESTIMATOR_PLANS_DIR"),
		SampleDB:     getenv("NET_WORTH_ESTIMATOR_SAMPLE_DB"),
		ModelID:      getenv("NET_WORTH_ESTIMATOR_AUTH_PERMISSION_MODEL"),
	}
	if raw := strings.TrimSpace(getenv("NET_WORTH_ESTIMATOR_WARM_DEBOUNCE")); raw != "" {
		debounce, err := time.ParseDuration(raw)
		if err != nil {
			return c, errors.New("WARM_DEBOUNCE requires a Go duration (empty selects 30s, negative disables warming)")
		}
		c.WarmDebounce = debounce
	}
	if c.OwnerSubject != strings.TrimSpace(c.OwnerSubject) || strings.ContainsAny(c.OwnerSubject, "*\x00\r\n") {
		return c, errors.New("PLAN_OWNER_SUBJECT must be one verified OIDC subject")
	}
	if c.PrivateDir == "" {
		var err error
		c.PrivateDir, err = filepath.Abs(dbPath + ".plans")
		if err != nil {
			return c, err
		}
	}
	if !filepath.IsAbs(c.PrivateDir) || (c.SampleDB != "" && !filepath.IsAbs(c.SampleDB)) {
		return c, errors.New("PLANS_DIR and SAMPLE_DB require absolute paths")
	}
	return c, nil
}

func resourceHandler(ctx context.Context, primary store.Store, dbPath string, config resourceConfig, loginConfig identity.Config, apiConfig api.Config) (http.Handler, *plans.Router, func() error, error) {
	permissions, err := authorization.New(authorization.Config{
		Issuer: loginConfig.Issuer, InternalURL: loginConfig.InternalURL,
		ClientID: loginConfig.ClientID, ClientSecret: loginConfig.ClientSecret, ModelID: config.ModelID,
	})
	if err != nil {
		return nil, nil, nil, err
	}
	primaryID := ""
	if config.OwnerSubject != "" {
		primaryID = authorization.ResourceFor(loginConfig.Issuer, config.OwnerSubject).ID
	}
	apiConfig.CanWrite = identity.CanWrite
	router, err := plans.New(primary, plans.Config{
		PrimaryResourceID: primaryID, PrimaryDBPath: dbPath,
		SampleDBPath: config.SampleDB, PrivateDir: config.PrivateDir, API: apiConfig,
		WarmDebounce: config.WarmDebounce,
	})
	if err != nil {
		return nil, nil, nil, err
	}
	loginConfig.ResolveAccess = func(ctx context.Context, subject string) (authorization.Scope, error) {
		scope, err := permissions.Resolve(ctx, subject)
		if err != nil {
			return authorization.Scope{}, err
		}
		if subject == "" {
			// Never fall back from an unpublished sample to the primary owner's data.
			info, err := os.Lstat(config.SampleDB)
			if err != nil || !info.Mode().IsRegular() {
				scope.Permissions = []string{}
			}
		}
		return scope, nil
	}
	loginConfig.RequireResourceHeader = true
	login, err := identity.New(ctx, loginConfig)
	if err != nil {
		router.Close()
		return nil, nil, nil, err
	}
	return login.Wrap(router), router, func() error { return errors.Join(login.Close(), router.Close()) }, nil
}
