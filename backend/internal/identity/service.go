package identity

import (
	"context"
	"encoding/json"
	"fmt"
	"net/http"
	"net/url"
	"slices"
	"strings"
	"time"

	"github.com/alexedwards/scs/v2"
	"github.com/coreos/go-oidc/v3/oidc"
	authcontract "github.com/simhozebs/net-worth-estimator/backend/internal/identity/contracts"
	"golang.org/x/oauth2"
	"golang.org/x/sync/singleflight"
)

const prefix = "/v1/auth/"

type Service struct {
	config           Config
	browsers         map[string]browserEndpoint
	browserProviders map[string]http.Handler
	sessions         *scs.SessionManager
	store            *sessionStore
	provider         *oidc.Provider
	deviceAuth       string
	oauth            oauth2.Config
	client           *http.Client
	logoutEndpoint   string
	introspection    string
	csrf             *http.CrossOriginProtection
	validation       singleflight.Group
}

// New uses standard OIDC discovery and verification for Casdoor.
func New(ctx context.Context, c Config) (*Service, error) {
	browsers, err := browserEndpoints(c)
	if err != nil {
		return nil, err
	}
	if c.RecheckInterval <= 0 {
		c.RecheckInterval = 30 * time.Second
	}
	csrf := http.NewCrossOriginProtection()
	if err := csrf.AddTrustedOrigin(strings.TrimRight(c.PublicURL, "/")); err != nil {
		return nil, fmt.Errorf("configure public origin: %w", err)
	}
	issuer, err := url.Parse(c.Issuer)
	if err != nil {
		return nil, err
	}
	transport := http.DefaultTransport
	if c.InternalURL != "" {
		internal, err := url.Parse(c.InternalURL)
		if err != nil {
			return nil, err
		}
		transport = &issuerTransport{base: transport, issuer: issuer, internal: internal}
	}
	client := &http.Client{Transport: transport, Timeout: 10 * time.Second, CheckRedirect: func(_ *http.Request, _ []*http.Request) error { return http.ErrUseLastResponse }}
	provider, err := oidc.NewProvider(oidc.ClientContext(ctx, client), c.Issuer)
	if err != nil {
		return nil, fmt.Errorf("discover identity provider: %w", err)
	}
	var store *sessionStore
	if c.Database != nil {
		store, err = sharedSessions(c.Database)
	} else {
		store, err = openSessions(c.SessionDB)
	}
	if err != nil {
		return nil, fmt.Errorf("open sessions: %w", err)
	}
	sm := scs.New()
	sm.Store = store
	sm.Lifetime = c.Lifetime
	sm.Cookie.Name = "waypoint_session"
	if len(c.BrowserOrigins) > 0 {
		// Dev and production can share a ts.net hostname on different ports.
		// Browsers scope cookies by hostname, not by port.
		sm.Cookie.Name = browserCookieNamespace(c) + "session"
	}
	sm.Cookie.Secure = strings.HasPrefix(c.PublicURL, "https://")
	if sm.Cookie.Secure {
		sm.Cookie.Name = "__Host-" + sm.Cookie.Name
	}
	sm.Cookie.HttpOnly = true
	sm.Cookie.Persist = true
	sm.Cookie.SameSite = http.SameSiteLaxMode
	var metadata struct {
		EndSessionEndpoint    string `json:"end_session_endpoint"`
		IntrospectionEndpoint string `json:"introspection_endpoint"`
		DeviceAuthEndpoint    string `json:"device_authorization_endpoint"`
		BackchannelSupported  bool   `json:"backchannel_logout_supported"`
	}
	if err := provider.Claims(&metadata); err != nil {
		store.Close()
		return nil, err
	}
	if metadata.IntrospectionEndpoint == "" || !metadata.BackchannelSupported {
		store.Close()
		return nil, fmt.Errorf("identity provider must support token introspection and back-channel logout")
	}
	service := &Service{config: c, browsers: browsers, sessions: sm, store: store, provider: provider, client: client, deviceAuth: metadata.DeviceAuthEndpoint, logoutEndpoint: metadata.EndSessionEndpoint, introspection: metadata.IntrospectionEndpoint, csrf: csrf,
		oauth: oauth2.Config{ClientID: c.ClientID, ClientSecret: c.ClientSecret, Endpoint: provider.Endpoint(), RedirectURL: strings.TrimRight(c.PublicURL, "/") + prefix + "callback", Scopes: []string{oidc.ScopeOpenID, "profile", "email", "offline_access"}}}
	service.browserProviders = service.browserProviderHandlers()
	return service, nil
}

func (s *Service) Close() error { return s.store.Close() }

type principalKey struct{}
type Principal = authcontract.Principal

func CanWrite(ctx context.Context) bool {
	scope, ok := Scope(ctx)
	return ok && slices.Contains(scope.Permissions, "plan:write")
}

func (s *Service) principal(r *http.Request) (Principal, error) {
	// An explicit bearer identity wins when it verifies. An unverifiable
	// bearer never replaces a session: validation falls back to the session
	// path, and a provider outage falls back to a cached-valid session
	// before reporting unavailable. Retired or foreign tokens therefore
	// keep exact guest behavior.
	if token, ok := bearerToken(r); ok {
		if p, err := s.bearerPrincipal(r.Context(), token); err == nil {
			if p.Subject != "" {
				return p, nil
			}
		} else if p, serr := s.sessionPrincipal(r); serr == nil && p.Subject != "" {
			return p, nil
		} else if serr != nil {
			return Principal{}, serr
		} else {
			return Principal{}, err
		}
	}
	return s.sessionPrincipal(r)
}

func (s *Service) sessionPrincipal(r *http.Request) (Principal, error) {
	g, err := s.validateGrant(r.Context(), s.sessions.GetString(r.Context(), "grant_id"))
	if err != nil {
		return Principal{}, err
	}
	if g.ID == "" {
		return Principal{}, nil
	}
	return Principal{Subject: g.Subject, Name: g.Name}, nil
}

// Wrap verifies sessions and enforces Casdoor decisions for the selected plan.
func (s *Service) Wrap(next http.Handler) http.Handler {
	router := http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		w = flushWriter{w}
		if strings.HasPrefix(r.URL.Path, prefix) {
			s.serveAuth(w, r)
			return
		}
		if r.URL.Path == "/v1" || strings.HasPrefix(r.URL.Path, "/v1/") {
			w.Header().Set("Cache-Control", "no-store")
			p, err := s.principal(r)
			if err != nil {
				failure(w, 503, "Identity verification is temporarily unavailable. Retry this request.")
				return
			}
			scope, err := s.resolveAccess(r.Context(), p)
			if err != nil {
				failure(w, 503, "Resource permissions are temporarily unavailable. Retry this request.")
				return
			}
			w.Header().Set(ResourceHeader, scope.Resource.ID)
			if !slices.Contains(scope.Permissions, requestAction(r)) {
				if p.Subject == "" {
					w.Header().Set("WWW-Authenticate", "Session")
					failure(w, 401, "Sign in to edit your own plan.")
				} else {
					failure(w, 403, "This action is not permitted on this plan.")
				}
				return
			}
			expected := r.Header.Get(ResourceHeader)
			if (expected != "" && expected != scope.Resource.ID) || (s.config.RequireResourceHeader && expected == "" && r.Method != http.MethodOptions) {
				WriteResourceChanged(w)
				return
			}
			r = r.WithContext(context.WithValue(r.Context(), principalKey{}, p))
			r = r.WithContext(context.WithValue(r.Context(), scopeKey{}, scope))
		}
		next.ServeHTTP(w, r)
	})
	// Use Go's browser CSRF protection, including logout and future write routes.
	protected := s.sessions.LoadAndSave(s.csrf.Handler(router))
	return http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		// This server-to-server endpoint authenticates a signed logout token,
		// not a browser cookie. It does not load or create an SCS session.
		if r.URL.Path == prefix+"backchannel-logout" {
			s.backchannelLogout(w, r)
			return
		}
		if strings.HasPrefix(r.URL.Path, prefix+"provider/") {
			s.serveBrowserProvider(w, r)
			return
		}
		if endpoint, ok := s.browserEndpoint(r); ok {
			// A sibling app origin cannot submit this origin's cookies.
			if origin := r.Header.Get("Origin"); origin != "" && origin != endpoint.app && !isSafeMethod(r.Method) {
				failure(w, http.StatusForbidden, "The request origin does not match this application address.")
				return
			}
		}
		protected.ServeHTTP(w, r)
	})
}

func (s *Service) serveAuth(w http.ResponseWriter, r *http.Request) {
	w.Header().Set("Cache-Control", "no-store")
	endpoint, ok := s.browserEndpoint(r)
	if !ok {
		failure(w, http.StatusForbidden, "This application address is not configured for sign-in.")
		return
	}
	switch r.Method + " " + r.URL.Path {
	case "GET " + prefix + "session":
		p, err := s.principal(r)
		if err != nil {
			failure(w, 503, "Identity verification is temporarily unavailable.")
			return
		}
		scope, err := s.resolveAccess(r.Context(), p)
		if err != nil {
			failure(w, 503, "Resource permissions are temporarily unavailable.")
			return
		}
		w.Header().Set(ResourceHeader, scope.Resource.ID)
		respond(w, authcontract.SessionResponse{Enabled: true, Provider: s.config.Provider, Authenticated: p.Subject != "", Allowed: slices.Contains(scope.Permissions, "plan:read"), User: p, AccountURL: s.browserProviderURL(s.config.AccountURL, endpoint),
			Resource: authcontract.SessionResource{ID: scope.Resource.ID, Kind: scope.Resource.Kind, Permissions: scope.Permissions}})
	case "GET " + prefix + "login":
		s.login(w, r)
	case "GET " + prefix + "callback":
		s.callback(w, r)
	case "POST " + prefix + "logout":
		s.logout(w, r)
	case "GET " + prefix + "profile":
		s.accountProfile(w, r)
	case "PATCH " + prefix + "profile":
		s.accountUpdateProfile(w, r)
	case "POST " + prefix + "change-password":
		s.accountChangePassword(w, r)
	case "POST " + prefix + "device/start":
		s.deviceStart(w, r)
	case "POST " + prefix + "device/poll":
		s.devicePoll(w, r)
	case "POST " + prefix + "device/refresh":
		s.deviceRefresh(w, r)
	case "GET " + prefix + "sessions":
		s.accountSessions(w, r)
	case "DELETE " + prefix + "sessions":
		s.accountRevokeSession(w, r)
	default:
		http.NotFound(w, r)
	}
}

func respond(w http.ResponseWriter, v any) {
	w.Header().Set("Content-Type", "application/json")
	_ = json.NewEncoder(w).Encode(v)
}
func failure(w http.ResponseWriter, status int, detail string) {
	failureWithCode(w, status, detail, "")
}

func failureWithCode(w http.ResponseWriter, status int, detail, code string) {
	w.Header().Set("Cache-Control", "no-store")
	w.Header().Set("Content-Type", "application/problem+json")
	w.WriteHeader(status)
	problem := map[string]any{"status": status, "title": http.StatusText(status), "detail": detail}
	if code != "" {
		problem["code"] = code
	}
	_ = json.NewEncoder(w).Encode(problem)
}

// SCS unwraps through ResponseController; preserve the API's Flusher contract.
type flushWriter struct{ http.ResponseWriter }

func (w flushWriter) Flush()                      { _ = http.NewResponseController(w.ResponseWriter).Flush() }
func (w flushWriter) Unwrap() http.ResponseWriter { return w.ResponseWriter }

type issuerTransport struct {
	base             http.RoundTripper
	issuer, internal *url.URL
}

func (t *issuerTransport) RoundTrip(r *http.Request) (*http.Response, error) {
	if r.URL.Scheme != t.issuer.Scheme || r.URL.Host != t.issuer.Host {
		return t.base.RoundTrip(r)
	}
	clone := r.Clone(r.Context())
	u := *r.URL
	u.Scheme = t.internal.Scheme
	u.Host = t.internal.Host
	clone.URL = &u
	// Route over the private network without changing the provider's public host.
	clone.Host = t.issuer.Host
	return t.base.RoundTrip(clone)
}
