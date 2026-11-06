package main

import (
	"context"
	"errors"
	"net/http"
	"os"
	"regexp"
	"strings"
	"sync"

	"github.com/simhozebs/net-worth-estimator/backend/internal/api"
	"github.com/simhozebs/net-worth-estimator/backend/internal/authorization"
	"github.com/simhozebs/net-worth-estimator/backend/internal/friends"
	"github.com/simhozebs/net-worth-estimator/backend/internal/groups"
	"github.com/simhozebs/net-worth-estimator/backend/internal/identity"
	"github.com/simhozebs/net-worth-estimator/backend/internal/inbox"
	"github.com/simhozebs/net-worth-estimator/backend/internal/sharing"
	"github.com/simhozebs/net-worth-estimator/backend/internal/store"
	"github.com/simhozebs/net-worth-estimator/backend/internal/store/adapters/sqlite"
)

type resourceConfig struct {
	ModelID, Organization string
}

func resourceConfigFromEnv(getenv func(string) string) (resourceConfig, error) {
	c := resourceConfig{
		ModelID:      getenv("NET_WORTH_ESTIMATOR_AUTH_PERMISSION_MODEL"),
		Organization: getenv("NET_WORTH_ESTIMATOR_AUTH_ORGANIZATION"),
	}
	if c.Organization == "" {
		c.Organization = authorization.DefaultOrganization
	}
	if !orgName.MatchString(c.Organization) {
		return c, errors.New("AUTH_ORGANIZATION must be a name without an owner prefix")
	}
	return c, nil
}

func resourceHandler(ctx context.Context, database *sqlite.Database, config resourceConfig, loginConfig identity.Config, apiConfig api.Config, syncMgr *syncManager) (http.Handler, func() error, error) {
	permissions, err := authorization.New(authorization.Config{
		Issuer: loginConfig.Issuer, InternalURL: loginConfig.InternalURL,
		ClientID: loginConfig.ClientID, ClientSecret: loginConfig.ClientSecret, ModelID: config.ModelID,
		Organization:     config.Organization,
		AllowPrivateHTTP: loginConfig.AllowPrivateHTTP,
	})
	if err != nil {
		return nil, nil, err
	}
	apiConfig.CanWrite = identity.CanWrite
	apiConfig.Actor = identity.Subject
	router, err := newUserRouter(database, userRouterConfig{
		Sync: syncMgr,
		API:  apiConfig,
	})
	if err != nil {
		return nil, nil, err
	}
	loginConfig.Store = database
	loginConfig.ResolveAccess = userAccessResolver(database, loginConfig.Issuer, permissions.Resolve)
	loginConfig.RequireResourceHeader = true
	admin, err := adminImpersonator(database, permissions.Check, os.Getenv)
	if err != nil {
		return nil, nil, err
	}
	if admin != nil {
		loginConfig.Impersonate = admin
	}
	login, err := identity.New(ctx, loginConfig)
	if err != nil {
		router.Close()
		return nil, nil, err
	}
	// Social routes carry the same own-user permission checks and resource
	// header as every other user route (enforced in identity.Wrap) plus
	// existing membership in the groups/friends handler. Friendships never
	// touch financial plans.
	groupHandler := groups.New(database, loginConfig.Issuer, groups.Config{
		AllowedOrigins: apiConfig.AllowedOrigins,
		ReadOnly:       apiConfig.ReadOnly,
	})
	groupRoutes := groupHandler.Routes()
	// Sharing routes carry the same own-user permission checks and resource
	// header as every other user route (enforced in identity.Wrap) plus
	// per-transaction source-owner consent in the sharing handler.
	sharingHandler := sharing.New(database, loginConfig.Issuer, sharing.Config{
		AllowedOrigins: apiConfig.AllowedOrigins,
		ReadOnly:       apiConfig.ReadOnly,
	})
	sharingRoutes := sharingHandler.Routes()
	// Inbox routes carry the same own-user permission checks and resource
	// header as every other user route (enforced in identity.Wrap) plus
	// per-share authorization in the inbox handler on every call.
	inboxHandler := inbox.New(database, loginConfig.Issuer, inbox.Config{
		AllowedOrigins: apiConfig.AllowedOrigins,
		ReadOnly:       apiConfig.ReadOnly,
	})
	inboxRoutes := inboxHandler.Routes()
	friendHandler := friends.New(database, loginConfig.Issuer, friends.Config{
		AllowedOrigins: apiConfig.AllowedOrigins,
		ReadOnly:       apiConfig.ReadOnly,
	})
	friendRoutes := friendHandler.Routes()
	combined := http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		if identity.IsFriendRoute(r.URL.Path) {
			friendRoutes.ServeHTTP(w, r)
			return
		}
		if identity.IsGroupRoute(r.URL.Path) {
			groupRoutes.ServeHTTP(w, r)
			return
		}
		if identity.IsSharingRoute(r.URL.Path) {
			sharingRoutes.ServeHTTP(w, r)
			return
		}
		if identity.IsInboxRoute(r.URL.Path) {
			inboxRoutes.ServeHTTP(w, r)
			return
		}
		router.ServeHTTP(w, r)
	})
	return login.Wrap(combined), func() error { return errors.Join(login.Close(), router.Close()) }, nil
}

// The subject comes only from a verified identity grant. Casdoor must authorize
// the derived resource before this boundary provisions any private state.
//
// Depends on user scope: the store keys financial rows by user ID, so
// this boundary provisions through EnsureUser keyed by the canonical
// user record via EnsureGroupUser (both derive from ActorKey, so one
// verified identity never splits). The guest follows the exact same path:
// it is an ordinary preprovisioned account, and provisioning happens only
// when Casdoor grants at least one user action.
func userAccessResolver(database *sqlite.Database, issuer string, resolve func(context.Context, string) (authorization.Scope, error)) func(context.Context, string) (authorization.Scope, error) {
	return func(ctx context.Context, subject string) (authorization.Scope, error) {
		if subject == "" {
			return authorization.Scope{}, errors.New("authorization returned an unexpected user")
		}
		scope, err := resolve(ctx, subject)
		if err != nil {
			return authorization.Scope{}, err
		}
		expected := authorization.ResourceFor(issuer, subject)
		if scope.Resource != expected {
			return authorization.Scope{}, errors.New("authorization returned an unexpected user")
		}
		if scope.Allows(authorization.Read) || scope.Allows(authorization.Project) || scope.Allows(authorization.Write) {
			if _, err := database.EnsureGroupUser(issuer, subject); err != nil {
				return authorization.Scope{}, err
			}
			scoped, err := database.EnsureUser(authorization.ActorKey(issuer, subject), issuer, subject)
			if err != nil {
				return authorization.Scope{}, err
			}
			if err := scoped.InitializeModel(); err != nil {
				return authorization.Scope{}, err
			}
		}
		return scope, nil
	}
}

var userResource = regexp.MustCompile(`^users/[a-f0-9]{64}$`)

var orgName = regexp.MustCompile(`^[A-Za-z0-9_-]{1,100}$`)

type userRouterConfig struct {
	// Sync assigns the per-user SimpleFIN runner. It must be configured for
	// every private user with a stored Bridge key.
	Sync *syncManager
	API  api.Config
}

// userRouter isolates each user's model, artifacts, presets, and sync
// state. Casdoor decides permissions. This router selects only the authorized
// store. It replaces the retired backend/internal/plans package: the routing
// boundary now lives in the composition root and keys handlers by user
// resource, not by plan file.
type userRouter struct {
	mu       sync.Mutex
	database store.Database
	config   userRouterConfig
	public   http.Handler
	opened   map[string]http.Handler
	closed   bool
}

func newUserRouter(database store.Database, config userRouterConfig) (*userRouter, error) {
	if database == nil {
		return nil, errors.New("user routing requires the application database")
	}
	if config.Sync == nil {
		return nil, errors.New("user routing requires the SimpleFIN sync manager")
	}
	// Health and status probes do not access financial state.
	publicConfig := config.API
	publicConfig.SyncRunner = nil
	return &userRouter{database: database, config: config, public: api.New(nil, publicConfig), opened: map[string]http.Handler{}}, nil
}

func (p *userRouter) ServeHTTP(w http.ResponseWriter, r *http.Request) {
	if r.URL.Path != "/v1" && !strings.HasPrefix(r.URL.Path, "/v1/") {
		p.public.ServeHTTP(w, r)
		return
	}
	scope, ok := identity.Scope(r.Context())
	if !ok || scope.Resource.ID == "" {
		http.Error(w, "User access has not been verified.", http.StatusForbidden)
		return
	}
	handler, err := p.handlerFor(scope.Resource)
	if err != nil {
		http.Error(w, "The selected user is temporarily unavailable.", http.StatusServiceUnavailable)
		return
	}
	w.Header().Set(identity.ResourceHeader, scope.Resource.ID)
	handler.ServeHTTP(w, r)
}

// storeUserID maps an authorized user resource to the store's user
// row ID. Every resource (users/<hash>) is owned by user:<hash>, including
// the preprovisioned guest.
func storeUserID(resourceID string) string {
	return "user:" + strings.TrimPrefix(resourceID, "users/")
}

func (p *userRouter) handlerFor(resource authorization.Resource) (http.Handler, error) {
	p.mu.Lock()
	defer p.mu.Unlock()
	if p.closed {
		return nil, errors.New("user router is closed")
	}
	if !userResource.MatchString(resource.ID) {
		return nil, errors.New("invalid user resource")
	}
	if existing, ok := p.opened[resource.ID]; ok {
		return existing, nil
	}
	// Provisioning belongs to the verified authorization boundary, not routing.
	userID := storeUserID(resource.ID)
	scoped, err := p.database.User(userID)
	if err != nil {
		return nil, err
	}
	config := p.config.API
	config.ResourceID = resource.ID
	config.SyncRunner = p.config.Sync.RunnerFor(userID, scoped)
	// The global operator read-only kill switch stays in config.ReadOnly;
	// there is no per-identity forced read-only.
	handler := api.New(scoped, config)
	p.opened[resource.ID] = handler
	return handler, nil
}

// Close releases handler references. The caller owns the shared database.
func (p *userRouter) Close() error {
	p.mu.Lock()
	defer p.mu.Unlock()
	p.closed = true
	p.opened = map[string]http.Handler{}
	return nil
}
