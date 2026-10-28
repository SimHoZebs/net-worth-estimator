package identity

import (
	"encoding/json"
	"io"
	"net/http"
	"net/http/cookiejar"
	"net/http/httptest"
	"net/http/httputil"
	"net/url"
	"path/filepath"
	"strings"
	"sync/atomic"
	"testing"
	"time"

	"github.com/simhozebs/net-worth-estimator/backend/internal/api"
	"github.com/simhozebs/net-worth-estimator/backend/internal/authorization"
	"github.com/simhozebs/net-worth-estimator/backend/internal/ingress"
	"github.com/simhozebs/net-worth-estimator/backend/internal/store"
)

// Artifact storage has a longer lifetime than its attached HTTP stream. Signal
// completion after the entire real store operation, including retention, ends.
type deploymentStore struct {
	store.Store
	completed chan error
}

func (s deploymentStore) PutArtifact(key, kind, payload string) error {
	err := s.Store.PutArtifact(key, kind, payload)
	s.completed <- err
	return err
}

// Exercise the production identity and API handlers through real HTTP proxies.
// The public TLS origin stays fixed while the API has a different host and
// restarts against the same database. No provider-specific headers are trusted.
func TestDeploymentProxyLoginWritesStreamsAndRestart(t *testing.T) {
	for _, authenticatedIngress := range []bool{false, true} {
		name := "host-preserving"
		if authenticatedIngress {
			name = "host-rewriting"
		}
		t.Run(name, func(t *testing.T) {
			p := newIDP(t)
			path := filepath.Join(t.TempDir(), "app.db")
			database, err := store.SetupDatabase(path)
			if err != nil {
				t.Fatal(err)
			}
			t.Cleanup(func() { _ = database.Close() })
			resource := authorization.ResourceFor(p.server.URL, p.subject)
			owner, err := database.EnsurePrivatePlan(resource.ID, resource.Owner, p.server.URL, p.subject)
			if err != nil {
				t.Fatal(err)
			}
			if err := owner.InitializeDocument(); err != nil {
				t.Fatal(err)
			}
			const secret = "0123456789abcdef0123456789abcdef"
			artifactCompleted := make(chan error, 1)
			var upstream atomic.Pointer[url.URL]
			edge := httptest.NewUnstartedServer(nil)
			publicURL := "https://" + edge.Listener.Addr().String()
			edge.Config.Handler = &httputil.ReverseProxy{
				Rewrite: func(pr *httputil.ProxyRequest) {
					pr.SetURL(upstream.Load())
					pr.SetXForwarded()
					if authenticatedIngress {
						// Model an edge plus a provider load balancer that rewrites
						// Host and forwarded headers. Only our replaced headers count.
						pr.Out.Host = pr.Out.URL.Host
						pr.Out.Header.Set("X-Forwarded-Host", "provider.internal")
						pr.Out.Header.Set("X-Forwarded-Proto", "http")
						pr.Out.Header.Set(ingress.SecretHeader, secret)
						pr.Out.Header.Set(ingress.OriginHeader, publicURL)
					} else {
						pr.Out.Host = pr.In.Host
					}
				},
				FlushInterval: -1,
			}
			edge.StartTLS()
			t.Cleanup(edge.Close)
			startBackend := func(database *store.Database) *httptest.Server {
				t.Helper()
				login := newService(t, p, "", func(c *Config) {
					c.Database, c.PublicURL, c.RequireResourceHeader = database.SQL(), publicURL, true
				})
				scoped, err := database.Plan(resource.ID)
				if err != nil {
					t.Fatal(err)
				}
				application := api.New(deploymentStore{Store: scoped, completed: artifactCompleted}, api.Config{ResourceID: resource.ID, CanWrite: CanWrite})
				var handler http.Handler = login.Wrap(application)
				if authenticatedIngress {
					origins, err := login.config.ProxyOrigins()
					if err != nil {
						t.Fatal(err)
					}
					wrap, err := ingress.New(secret, origins)
					if err != nil {
						t.Fatal(err)
					}
					handler = wrap(handler)
				}
				backend := httptest.NewServer(handler)
				t.Cleanup(backend.Close)
				target, _ := url.Parse(backend.URL)
				upstream.Store(target)
				return backend
			}
			backend := startBackend(database)
			client := edge.Client()
			client.Jar, _ = cookiejar.New(nil)
			client.CheckRedirect = func(*http.Request, []*http.Request) error { return http.ErrUseLastResponse }
			request := func(method, path, body, origin string) (*http.Response, string) {
				t.Helper()
				r, err := http.NewRequest(method, publicURL+path, strings.NewReader(body))
				if err != nil {
					t.Fatal(err)
				}
				r.Header.Set("Content-Type", "application/json")
				r.Header.Set(ResourceHeader, resource.ID)
				if origin != "" {
					r.Header.Set("Origin", origin)
				}
				// A browser cannot select another origin or bypass the edge.
				r.Header.Set(ingress.SecretHeader, "client-controlled")
				r.Header.Set(ingress.OriginHeader, "https://attacker.test")
				response, err := client.Do(r)
				if err != nil {
					t.Fatal(err)
				}
				defer response.Body.Close()
				data, err := io.ReadAll(response.Body)
				if err != nil {
					t.Fatal(err)
				}
				return response, string(data)
			}
			response, body := request("GET", prefix+"login", "", "")
			if response.StatusCode != http.StatusFound {
				t.Fatalf("login=%d %s", response.StatusCode, body)
			}
			authorize, err := url.Parse(response.Header.Get("Location"))
			if err != nil || authorize.Query().Get("redirect_uri") != publicURL+prefix+"callback" {
				t.Fatalf("callback changed public origin: %s %v", response.Header.Get("Location"), err)
			}
			p.nonce = authorize.Query().Get("nonce")
			cookies := response.Cookies()
			if len(cookies) != 1 || !cookies[0].Secure || !cookies[0].HttpOnly || cookies[0].Domain != "" || cookies[0].SameSite != http.SameSiteLaxMode {
				t.Fatalf("unsafe application cookie: %v", cookies)
			}
			response, body = request("GET", prefix+"callback?code=code&state="+url.QueryEscape(authorize.Query().Get("state")), "", "")
			if response.StatusCode != http.StatusFound || response.Header.Get("Location") != publicURL+"/" {
				t.Fatalf("callback=%d location=%s %s", response.StatusCode, response.Header.Get("Location"), body)
			}
			checkSession := func() {
				t.Helper()
				response, body := request("GET", prefix+"session", "", "")
				var session struct {
					Authenticated bool
					Resource      struct{ ID string }
				}
				if err := json.Unmarshal([]byte(body), &session); err != nil || response.StatusCode != 200 || !session.Authenticated || session.Resource.ID != resource.ID {
					t.Fatalf("session did not survive proxy/restart: %d %s %v", response.StatusCode, body, err)
				}
			}
			checkSession()
			account := `{"id":"checking","name":"Checking","kind":"cash","enabled":true}`
			response, body = request("POST", "/v1/accounts", account, "https://attacker.test")
			if response.StatusCode != http.StatusForbidden {
				t.Fatalf("cross-origin write passed: %d %s", response.StatusCode, body)
			}
			response, body = request("POST", "/v1/accounts", account, publicURL)
			if response.StatusCode != http.StatusOK || !strings.Contains(body, `"persisted":true`) {
				t.Fatalf("same-origin write=%d %s", response.StatusCode, body)
			}
			const projection = `{"settings":{"fallbackProjectionStartDate":"2026-10-27","horizonYears":1},"config":{"runCount":1,"seed":42}}`
			checkStream := func(source string) {
				t.Helper()
				response, body := request("POST", "/v1/projections/stochastic", projection, publicURL)
				if response.StatusCode != 200 || response.Header.Get("Content-Type") != "text/event-stream" || response.Header.Get("Projection-Source") != source || !strings.Contains(body, "event: result") || strings.Contains(body, "event: error") {
					t.Fatalf("stream=%d source=%s %s", response.StatusCode, response.Header.Get("Projection-Source"), body)
				}
				if response.Header.Get("Cache-Control") != "no-store" {
					t.Fatal("private stream can be cached")
				}
			}
			checkStream("computed")
			// A result event can precede both insertion and retention cleanup.
			// Restart after the full writer finishes, not just after a visible row.
			select {
			case err := <-artifactCompleted:
				if err != nil {
					t.Fatal(err)
				}
			case <-time.After(3 * time.Second):
				t.Fatal("seeded result writer did not finish before restart")
			}
			backend.Close()
			if err := database.Close(); err != nil {
				t.Fatal(err)
			}
			reopened, err := store.OpenDatabase(path)
			if err != nil {
				t.Fatal(err)
			}
			database = reopened
			startBackend(database)
			checkSession()
			response, body = request("GET", "/v1/financial-model", "", "")
			if response.StatusCode != http.StatusOK || !strings.Contains(body, `"id":"checking"`) {
				t.Fatalf("model did not survive restart: %d %s", response.StatusCode, body)
			}
			checkStream("stored")
			response, body = request("POST", prefix+"logout", "{}", publicURL)
			if response.StatusCode != http.StatusOK {
				t.Fatalf("logout=%d %s", response.StatusCode, body)
			}
			response, body = request("GET", prefix+"session", "", "")
			if response.StatusCode != 200 || !strings.Contains(body, `"authenticated":false`) {
				t.Fatalf("logout did not clear the session: %d %s", response.StatusCode, body)
			}
		})
	}
}
