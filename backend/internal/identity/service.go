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
	"golang.org/x/oauth2"
	"golang.org/x/sync/singleflight"
)

const prefix = "/v1/auth/"

type Service struct {
	config         Config
	sessions       *scs.SessionManager
	store          *sessionStore
	provider       *oidc.Provider
	oauth          oauth2.Config
	client         *http.Client
	logoutEndpoint string
	introspection  string
	csrf           *http.CrossOriginProtection
	validation     singleflight.Group
}

// New uses standard OIDC discovery and verification for Casdoor.
func New(ctx context.Context, c Config) (*Service, error) {
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
	store, err := openSessions(c.SessionDB)
	if err != nil {
		return nil, fmt.Errorf("open sessions: %w", err)
	}
	sm := scs.New()
	sm.Store = store
	sm.Lifetime = c.Lifetime
	sm.Cookie.Name = "waypoint_session"
	sm.Cookie.Secure = strings.HasPrefix(c.PublicURL, "https://")
	if sm.Cookie.Secure {
		sm.Cookie.Name = "__Host-waypoint_session"
	}
	sm.Cookie.HttpOnly = true
	sm.Cookie.Persist = true
	sm.Cookie.SameSite = http.SameSiteLaxMode
	var metadata struct {
		EndSessionEndpoint    string `json:"end_session_endpoint"`
		IntrospectionEndpoint string `json:"introspection_endpoint"`
		BackchannelSupported  bool   `json:"backchannel_logout_supported"`
	}
	if err := provider.Claims(&metadata); err != nil {
		store.db.Close()
		return nil, err
	}
	if metadata.IntrospectionEndpoint == "" || !metadata.BackchannelSupported {
		store.db.Close()
		return nil, fmt.Errorf("identity provider must support token introspection and back-channel logout")
	}
	return &Service{config: c, sessions: sm, store: store, provider: provider, client: client, logoutEndpoint: metadata.EndSessionEndpoint, introspection: metadata.IntrospectionEndpoint, csrf: csrf,
		oauth: oauth2.Config{ClientID: c.ClientID, ClientSecret: c.ClientSecret, Endpoint: provider.Endpoint(), RedirectURL: strings.TrimRight(c.PublicURL, "/") + prefix + "callback", Scopes: []string{oidc.ScopeOpenID, "profile", "email", "offline_access"}}}, nil
}

func (s *Service) Close() error { return s.store.db.Close() }

type principalKey struct{}
type Principal struct {
	Subject string `json:"subject"`
	Name    string `json:"name"`
	Role    string `json:"role"`
}

func CanWrite(ctx context.Context) bool {
	p, ok := ctx.Value(principalKey{}).(Principal)
	return ok && p.Role == "editor"
}

func (s *Service) principal(r *http.Request) (Principal, error) {
	g, err := s.validateGrant(r.Context(), s.sessions.GetString(r.Context(), "grant_id"))
	if err != nil || g.ID == "" {
		return Principal{}, err
	}
	p := Principal{Subject: g.Subject, Name: g.Name}
	if slices.Contains(s.config.Editors, p.Subject) {
		p.Role = "editor"
	} else if slices.Contains(s.config.Readers, p.Subject) {
		p.Role = "viewer"
	}
	return p, nil
}

// Wrap protects every API route by default. Compute POSTs are read operations.
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
			if p.Subject == "" {
				w.Header().Set("WWW-Authenticate", "Session")
				failure(w, 401, "Sign in to access this plan.")
				return
			}
			if p.Role == "" {
				failure(w, 403, "This identity has no grant for this plan.")
				return
			}
			compute := r.Method == http.MethodPost && (r.URL.Path == "/v1/projections/deterministic" || r.URL.Path == "/v1/projections/stochastic")
			if r.Method != "GET" && r.Method != "HEAD" && r.Method != "OPTIONS" && !compute && p.Role != "editor" {
				failure(w, 403, "This identity has read-only access.")
				return
			}
			r = r.WithContext(context.WithValue(r.Context(), principalKey{}, p))
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
		protected.ServeHTTP(w, r)
	})
}

func (s *Service) serveAuth(w http.ResponseWriter, r *http.Request) {
	w.Header().Set("Cache-Control", "no-store")
	switch r.Method + " " + r.URL.Path {
	case "GET " + prefix + "session":
		p, err := s.principal(r)
		if err != nil {
			failure(w, 503, "Identity verification is temporarily unavailable.")
			return
		}
		respond(w, map[string]any{"enabled": true, "provider": s.config.Provider, "authenticated": p.Subject != "", "allowed": p.Role != "", "user": p, "accountURL": s.config.AccountURL})
	case "GET " + prefix + "login":
		s.login(w, r)
	case "GET " + prefix + "callback":
		s.callback(w, r)
	case "POST " + prefix + "logout":
		s.logout(w, r)
	default:
		http.NotFound(w, r)
	}
}

func respond(w http.ResponseWriter, v any) {
	w.Header().Set("Content-Type", "application/json")
	_ = json.NewEncoder(w).Encode(v)
}
func failure(w http.ResponseWriter, status int, detail string) {
	w.Header().Set("Cache-Control", "no-store")
	w.Header().Set("Content-Type", "application/problem+json")
	w.WriteHeader(status)
	_ = json.NewEncoder(w).Encode(map[string]any{"status": status, "title": http.StatusText(status), "detail": detail})
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
