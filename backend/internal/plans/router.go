// Package plans isolates each plan's model, artifacts, presets, and sync state.
// Casdoor decides permissions. This package selects only the authorized store.
package plans

import (
	"errors"
	"net/http"
	"regexp"
	"strings"
	"sync"

	"github.com/simhozebs/net-worth-estimator/backend/internal/api"
	"github.com/simhozebs/net-worth-estimator/backend/internal/authorization"
	"github.com/simhozebs/net-worth-estimator/backend/internal/identity"
	"github.com/simhozebs/net-worth-estimator/backend/internal/store"
)

var privateResource = regexp.MustCompile(`^plans/[a-f0-9]{64}$`)

type Config struct {
	// PrimaryResourceID assigns server Bridge credentials, not data ownership.
	PrimaryResourceID string
	API               api.Config
}

type Router struct {
	mu       sync.Mutex
	database *store.Database
	config   Config
	public   http.Handler
	opened   map[string]http.Handler
	closed   bool
}

func New(database *store.Database, config Config) (*Router, error) {
	if database == nil {
		return nil, errors.New("plan routing requires the application database")
	}
	if config.PrimaryResourceID != "" && !privateResource.MatchString(config.PrimaryResourceID) {
		return nil, errors.New("primary plan requires an explicit private resource ID")
	}
	// Health and static files do not access financial state.
	publicConfig := config.API
	publicConfig.SyncRunner = nil
	return &Router{database: database, config: config, public: api.New(nil, publicConfig), opened: map[string]http.Handler{}}, nil
}

func (p *Router) ServeHTTP(w http.ResponseWriter, r *http.Request) {
	if r.URL.Path != "/v1" && !strings.HasPrefix(r.URL.Path, "/v1/") {
		p.public.ServeHTTP(w, r)
		return
	}
	scope, ok := identity.Scope(r.Context())
	if !ok || scope.Resource.ID == "" {
		http.Error(w, "Plan access has not been verified.", http.StatusForbidden)
		return
	}
	guest := identity.Subject(r.Context()) == ""
	if guest != (scope.Resource.Kind == "sample") {
		http.Error(w, "This plan is not available to this identity.", http.StatusForbidden)
		return
	}
	handler, err := p.handlerFor(scope.Resource)
	if err != nil {
		http.Error(w, "The selected plan is temporarily unavailable.", http.StatusServiceUnavailable)
		return
	}
	w.Header().Set(identity.ResourceHeader, scope.Resource.ID)
	handler.ServeHTTP(w, r)
}

func (p *Router) handlerFor(resource authorization.Resource) (http.Handler, error) {
	p.mu.Lock()
	defer p.mu.Unlock()
	if p.closed {
		return nil, errors.New("plan router is closed")
	}
	if !((resource.Kind == "sample" && resource.ID == "plans/sample") || (resource.Kind == "private" && privateResource.MatchString(resource.ID))) {
		return nil, errors.New("invalid plan resource")
	}
	if existing, ok := p.opened[resource.ID]; ok {
		return existing, nil
	}
	// Provisioning belongs to the verified authorization boundary, not routing.
	scoped, err := p.database.Plan(resource.ID)
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
func (p *Router) Close() error {
	p.mu.Lock()
	defer p.mu.Unlock()
	p.closed = true
	p.opened = map[string]http.Handler{}
	return nil
}
