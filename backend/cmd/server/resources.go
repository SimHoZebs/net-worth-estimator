package main

import (
	"context"
	"errors"
	"net/http"
	"regexp"
	"strings"
	"sync"

	"github.com/simhozebs/net-worth-estimator/backend/internal/api"
	"github.com/simhozebs/net-worth-estimator/backend/internal/authorization"
	"github.com/simhozebs/net-worth-estimator/backend/internal/groups"
	"github.com/simhozebs/net-worth-estimator/backend/internal/identity"
	"github.com/simhozebs/net-worth-estimator/backend/internal/store"
	"github.com/simhozebs/net-worth-estimator/backend/internal/store/adapters/sqlite"
)

type resourceConfig struct {
	OwnerSubject, ModelID string
}

func resourceConfigFromEnv(getenv func(string) string) (resourceConfig, error) {
	c := resourceConfig{
		OwnerSubject: getenv("NET_WORTH_ESTIMATOR_ACCOUNT_OWNER_SUBJECT"),
		ModelID:      getenv("NET_WORTH_ESTIMATOR_AUTH_PERMISSION_MODEL"),
	}
	if c.OwnerSubject != strings.TrimSpace(c.OwnerSubject) || strings.ContainsAny(c.OwnerSubject, "*\x00\r\n") {
		return c, errors.New("ACCOUNT_OWNER_SUBJECT must be one verified OIDC subject")
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
	router, err := newAccountRouter(database, accountRouterConfig{
		PrimaryResourceID: primaryID, API: apiConfig,
	})
	if err != nil {
		return nil, nil, err
	}
	loginConfig.Store = database
	loginConfig.ResolveAccess = accountAccessResolver(database, loginConfig.Issuer, permissions.Resolve)
	loginConfig.RequireResourceHeader = true
	login, err := identity.New(ctx, loginConfig)
	if err != nil {
		router.Close()
		return nil, nil, err
	}
	// Group routes carry authentication only: membership is enforced by the
	// groups handler, not by account authorization, so they must never reach
	// the account router (which 403s requests without a verified account scope).
	groupHandler := groups.New(database, loginConfig.Issuer, groups.Config{
		AllowedOrigins: apiConfig.AllowedOrigins,
		ReadOnly:       apiConfig.ReadOnly,
	})
	groupRoutes := groupHandler.Routes()
	combined := http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		if identity.IsGroupRoute(r.URL.Path) {
			groupRoutes.ServeHTTP(w, r)
			return
		}
		router.ServeHTTP(w, r)
	})
	return login.Wrap(combined), func() error { return errors.Join(login.Close(), router.Close()) }, nil
}

// The subject comes only from a verified identity grant. Casdoor must authorize
// the derived resource before this boundary provisions any private state.
//
// Depends on account scope: the store keys financial rows by account ID, so
// this boundary provisions through EnsureAccount keyed by the canonical
// account record via EnsureGroupAccount (both derive from ActorKey, so one
// verified identity never splits).
func accountAccessResolver(database *sqlite.Database, issuer string, resolve func(context.Context, string) (authorization.Scope, error)) func(context.Context, string) (authorization.Scope, error) {
	return func(ctx context.Context, subject string) (authorization.Scope, error) {
		scope, err := resolve(ctx, subject)
		if err != nil {
			return authorization.Scope{}, err
		}
		expected := authorization.ResourceFor(issuer, subject)
		if scope.Resource != expected {
			return authorization.Scope{}, errors.New("authorization returned an unexpected account")
		}
		if subject == "" {
			exists, err := database.HasAccount(sqlite.SampleAccountID)
			if err != nil {
				return authorization.Scope{}, err
			}
			if !exists {
				scope.Permissions = []string{}
			}
		} else if scope.Allows(authorization.Read) || scope.Allows(authorization.Project) || scope.Allows(authorization.Write) {
			if _, err := database.EnsureGroupAccount(issuer, subject); err != nil {
				return authorization.Scope{}, err
			}
			scoped, err := database.EnsureAccount(authorization.ActorKey(issuer, subject), issuer, subject)
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

var (
	accountResource  = regexp.MustCompile(`^accounts/[a-f0-9]{64}$`)
	sampleResourceID = "accounts/sample"
)

type accountRouterConfig struct {
	// PrimaryResourceID assigns server Bridge credentials, not data ownership.
	PrimaryResourceID string
	API               api.Config
}

// accountRouter isolates each account's model, artifacts, presets, and sync
// state. Casdoor decides permissions. This router selects only the authorized
// store. It replaces the retired backend/internal/plans package: the routing
// boundary now lives in the composition root and keys handlers by account
// resource, not by plan file.
type accountRouter struct {
	mu       sync.Mutex
	database store.Database
	config   accountRouterConfig
	public   http.Handler
	opened   map[string]http.Handler
	closed   bool
}

func newAccountRouter(database store.Database, config accountRouterConfig) (*accountRouter, error) {
	if database == nil {
		return nil, errors.New("account routing requires the application database")
	}
	if config.PrimaryResourceID != "" && !accountResource.MatchString(config.PrimaryResourceID) {
		return nil, errors.New("primary account requires an explicit private account resource ID")
	}
	// Health and static files do not access financial state.
	publicConfig := config.API
	publicConfig.SyncRunner = nil
	return &accountRouter{database: database, config: config, public: api.New(nil, publicConfig), opened: map[string]http.Handler{}}, nil
}

func (p *accountRouter) ServeHTTP(w http.ResponseWriter, r *http.Request) {
	if r.URL.Path != "/v1" && !strings.HasPrefix(r.URL.Path, "/v1/") {
		p.public.ServeHTTP(w, r)
		return
	}
	scope, ok := identity.Scope(r.Context())
	if !ok || scope.Resource.ID == "" {
		http.Error(w, "Account access has not been verified.", http.StatusForbidden)
		return
	}
	guest := identity.Subject(r.Context()) == ""
	if guest != (scope.Resource.Kind == "sample") {
		http.Error(w, "This account is not available to this identity.", http.StatusForbidden)
		return
	}
	handler, err := p.handlerFor(scope.Resource)
	if err != nil {
		http.Error(w, "The selected account is temporarily unavailable.", http.StatusServiceUnavailable)
		return
	}
	w.Header().Set(identity.ResourceHeader, scope.Resource.ID)
	handler.ServeHTTP(w, r)
}

// storeAccountID maps an authorized account resource to the store's account
// row ID. Private resources (accounts/<hash>) are owned by user:<hash>;
// the guest sample (accounts/sample) is the synthetic sample account.
func storeAccountID(resourceID string) string {
	if resourceID == sampleResourceID {
		return sqlite.SampleAccountID
	}
	return "user:" + strings.TrimPrefix(resourceID, "accounts/")
}

func (p *accountRouter) handlerFor(resource authorization.Resource) (http.Handler, error) {
	p.mu.Lock()
	defer p.mu.Unlock()
	if p.closed {
		return nil, errors.New("account router is closed")
	}
	if !((resource.Kind == "sample" && resource.ID == sampleResourceID) || (resource.Kind == "private" && accountResource.MatchString(resource.ID))) {
		return nil, errors.New("invalid account resource")
	}
	if existing, ok := p.opened[resource.ID]; ok {
		return existing, nil
	}
	// Provisioning belongs to the verified authorization boundary, not routing.
	scoped, err := p.database.Account(storeAccountID(resource.ID))
	if err != nil {
		return nil, err
	}
	config := p.config.API
	config.ResourceID = resource.ID
	if resource.ID != p.config.PrimaryResourceID {
		config.SyncRunner = nil
	}
	if resource.Kind == "sample" {
		config.ReadOnly = true
		config.SyncRunner = nil
	}
	handler := api.New(scoped, config)
	p.opened[resource.ID] = handler
	return handler, nil
}

// Close releases handler references. The caller owns the shared database.
func (p *accountRouter) Close() error {
	p.mu.Lock()
	defer p.mu.Unlock()
	p.closed = true
	p.opened = map[string]http.Handler{}
	return nil
}
