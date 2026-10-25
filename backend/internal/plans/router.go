// Package plans isolates each plan's model, artifacts, presets, and sync state.
// Casdoor decides permissions. This package selects only the authorized store.
package plans

import (
	"errors"
	"fmt"
	"net/http"
	"os"
	"path/filepath"
	"regexp"
	"strings"
	"sync"
	"time"

	"github.com/simhozebs/net-worth-estimator/backend/internal/api"
	"github.com/simhozebs/net-worth-estimator/backend/internal/authorization"
	"github.com/simhozebs/net-worth-estimator/backend/internal/identity"
	"github.com/simhozebs/net-worth-estimator/backend/internal/store"
)

var privateResource = regexp.MustCompile(`^plans/[a-f0-9]{64}$`)

type Config struct {
	PrimaryResourceID string
	PrimaryDBPath     string
	SampleDBPath      string
	PrivateDir        string
	API               api.Config
	// WarmDebounce waits for a save burst to settle before warming
	// cached projections. Zero selects the 30-second default.
	// Negative disables warming.
	WarmDebounce time.Duration
}

type endpoint struct {
	store   store.Store
	handler http.Handler
}

type Router struct {
	mu      sync.Mutex
	config  Config
	primary endpoint
	opened  map[string]endpoint
	closed  bool
	warmer  *Warmer
}

func New(primary store.Store, config Config) (*Router, error) {
	if config.PrimaryResourceID != "" && !privateResource.MatchString(config.PrimaryResourceID) {
		return nil, errors.New("primary plan requires an explicit private resource ID")
	}
	exists, err := primary.DocumentExists()
	if err != nil {
		return nil, err
	}
	if exists && config.PrimaryResourceID == "" {
		return nil, errors.New("existing financial data needs an explicit verified owner: set NET_WORTH_ESTIMATOR_PLAN_OWNER_SUBJECT")
	}
	if config.PrivateDir == "" || !filepath.IsAbs(config.PrivateDir) {
		return nil, errors.New("private plan directory must be absolute")
	}
	if config.SampleDBPath != "" {
		if !filepath.IsAbs(config.SampleDBPath) || sameFile(config.PrimaryDBPath, config.SampleDBPath) {
			return nil, errors.New("sample plan must use a separate absolute database path")
		}
	}
	if config.PrimaryResourceID != "" {
		if err := primary.InitializeDocument(); err != nil {
			return nil, err
		}
	}
	config.API.ResourceID = config.PrimaryResourceID
	router := &Router{config: config, opened: map[string]endpoint{}}
	router.warmer = newWarmer(config.WarmDebounce, defaultWarmFunc, router.warmStore)
	config.API.OnMutated = router.MarkDirty
	config.API.OnSyncApplied = router.noteSync
	router.primary = endpoint{primary, api.New(primary, config.API)}
	if config.PrimaryResourceID != "" {
		// Fresh deploys and offline imports start cold; warm once so
		// pins read hits instead of triggering foreground runs.
		router.MarkDirty(config.PrimaryResourceID)
	}
	return router, nil
}

// PrimaryID reports the resource warmed on startup and after sync runs.
func (p *Router) PrimaryID() string { return p.config.PrimaryResourceID }

// MarkDirty schedules a debounced warm run for a known resource.
func (p *Router) MarkDirty(resourceID string) { p.warmer.MarkDirty(resourceID) }

// noteSync schedules warming for applied sync runs. Dry runs commit
// nothing, so their content keys cannot have changed.
func (p *Router) noteSync(resourceID string, dryRun bool) {
	if !dryRun {
		p.warmer.MarkDirty(resourceID)
	}
}

// warmStore resolves the store for a known resource without opening new
// files: unknown IDs report false so a mark never creates a database.
func (p *Router) warmStore(resourceID string) (store.Store, bool) {
	p.mu.Lock()
	defer p.mu.Unlock()
	if p.closed {
		return nil, false
	}
	if resourceID == p.config.PrimaryResourceID {
		return p.primary.store, true
	}
	entry, ok := p.opened[resourceID]
	if !ok {
		return nil, false
	}
	return entry.store, true
}

func sameFile(a, b string) bool {
	if filepath.Clean(a) == filepath.Clean(b) {
		return true
	}
	ai, ae := os.Stat(a)
	bi, be := os.Stat(b)
	return ae == nil && be == nil && os.SameFile(ai, bi)
}

func (p *Router) ServeHTTP(w http.ResponseWriter, r *http.Request) {
	if r.URL.Path != "/v1" && !strings.HasPrefix(r.URL.Path, "/v1/") {
		p.primary.handler.ServeHTTP(w, r)
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
		// File paths and underlying SQLite errors are private operator details.
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
		return nil, errors.New("plan stores are closed")
	}
	if !((resource.Kind == "sample" && resource.ID == "plans/sample") || (resource.Kind == "private" && privateResource.MatchString(resource.ID))) {
		return nil, errors.New("invalid plan resource")
	}
	if resource.Kind == "private" && privateResource.MatchString(resource.ID) && resource.ID == p.config.PrimaryResourceID {
		return p.primary.handler, nil
	}
	if existing, ok := p.opened[resource.ID]; ok {
		return existing.handler, nil
	}
	var path string
	switch {
	case resource.Kind == "sample" && resource.ID == "plans/sample":
		path = p.config.SampleDBPath
		if path == "" {
			return nil, errors.New("sample plan is not configured")
		}
		info, err := os.Lstat(path)
		if err != nil || !info.Mode().IsRegular() {
			return nil, errors.New("sample plan must be an existing regular database file")
		}
		if sameFile(path, p.config.PrimaryDBPath) {
			return nil, errors.New("sample plan aliases the primary database")
		}
	case resource.Kind == "private" && privateResource.MatchString(resource.ID):
		if err := os.MkdirAll(p.config.PrivateDir, 0o700); err != nil {
			return nil, err
		}
		path = filepath.Join(p.config.PrivateDir, strings.TrimPrefix(resource.ID, "plans/")+".db")
		file, err := os.OpenFile(path, os.O_CREATE|os.O_EXCL|os.O_WRONLY, 0o600)
		if err == nil {
			if err := file.Close(); err != nil {
				return nil, err
			}
		} else if !errors.Is(err, os.ErrExist) {
			return nil, err
		}
		info, err := os.Lstat(path)
		if err != nil || !info.Mode().IsRegular() || sameFile(path, p.config.PrimaryDBPath) || (p.config.SampleDBPath != "" && sameFile(path, p.config.SampleDBPath)) {
			return nil, errors.New("private plan must use its own regular database file")
		}
	default:
		return nil, fmt.Errorf("invalid plan resource")
	}
	database, err := store.Open(path)
	if err != nil {
		return nil, err
	}
	if resource.Kind == "private" {
		if err := database.InitializeDocument(); err != nil {
			_ = database.Close()
			return nil, err
		}
	}
	config := p.config.API
	config.ResourceID = resource.ID
	config.OnMutated = p.MarkDirty
	config.OnSyncApplied = p.noteSync
	config.SyncRunner = nil // Server-level Bridge credentials belong only to the primary owner.
	if resource.Kind == "sample" {
		config.ReadOnly = true
	}
	handler := api.New(database, config)
	p.opened[resource.ID] = endpoint{database, handler}
	return handler, nil
}

// Close owns only the additional stores. The caller retains the primary store.
func (p *Router) Close() error {
	p.warmer.Stop()
	p.mu.Lock()
	defer p.mu.Unlock()
	p.closed = true
	var result error
	for _, entry := range p.opened {
		result = errors.Join(result, entry.store.Close())
	}
	p.opened = map[string]endpoint{}
	return result
}
