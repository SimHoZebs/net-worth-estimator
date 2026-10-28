package identity

import (
	"crypto/sha256"
	"encoding/hex"
	"fmt"
	"net"
	"net/http"
	"net/url"
	"strconv"
	"strings"

	"golang.org/x/oauth2"
)

// browserEndpoint separates the browser's network address from the stable OIDC
// issuer. Only operator-configured addresses can select redirects or proxies.
type browserEndpoint struct {
	app, provider string
}

func browserEndpoints(c Config) (map[string]browserEndpoint, error) {
	primary, err := canonicalBrowserOrigin(c.PublicURL)
	if err != nil {
		return nil, fmt.Errorf("primary browser app URL: %w", err)
	}
	issuer, err := url.Parse(c.Issuer)
	if err != nil || issuer.Host == "" {
		return nil, fmt.Errorf("expected an absolute issuer URL")
	}
	pairs := map[string]string{primary: issuer.Scheme + "://" + issuer.Host}
	for app, provider := range c.BrowserOrigins {
		app, err = canonicalBrowserOrigin(app)
		if err != nil {
			return nil, fmt.Errorf("browser app URL: %w", err)
		}
		provider, err = canonicalBrowserOrigin(provider)
		if err != nil {
			return nil, fmt.Errorf("browser provider URL: %w", err)
		}
		if existing, found := pairs[app]; found && existing != provider {
			return nil, fmt.Errorf("AUTH_BROWSER_ORIGINS cannot replace the primary browser endpoint")
		}
		pairs[app] = provider
	}
	endpoints := make(map[string]browserEndpoint, len(pairs))
	main, _ := url.Parse(primary)
	for app, provider := range pairs {
		u, _ := url.Parse(app)
		if u.Scheme != main.Scheme {
			return nil, fmt.Errorf("browser app URLs must use the primary URL's scheme")
		}
		p, _ := url.Parse(provider)
		if app != primary && p.Scheme != u.Scheme {
			return nil, fmt.Errorf("alternate app and provider URLs must use the same scheme")
		}
		host := strings.ToLower(u.Host)
		if _, found := endpoints[host]; found {
			return nil, fmt.Errorf("browser app hosts must be unique")
		}
		endpoints[host] = browserEndpoint{app, provider}
	}
	for _, endpoint := range endpoints {
		p, _ := url.Parse(endpoint.provider)
		if _, found := endpoints[strings.ToLower(p.Host)]; found {
			return nil, fmt.Errorf("browser app and provider hosts must be distinct")
		}
	}
	return endpoints, nil
}

func canonicalBrowserOrigin(raw string) (string, error) {
	if err := validateURL(raw, true); err != nil {
		return "", err
	}
	u, _ := url.Parse(raw)
	host := strings.ToLower(u.Hostname())
	if strings.ContainsAny(host, "* \\%") {
		return "", fmt.Errorf("expected an exact browser hostname")
	}
	port := u.Port()
	if port != "" {
		n, err := strconv.Atoi(port)
		if err != nil || n < 1 || n > 65535 {
			return "", fmt.Errorf("expected a port between 1 and 65535")
		}
		port = strconv.Itoa(n)
		if (u.Scheme == "http" && port == "80") || (u.Scheme == "https" && port == "443") {
			port = ""
		}
	}
	if port != "" {
		host = net.JoinHostPort(host, port)
	} else if strings.Contains(host, ":") {
		host = "[" + host + "]"
	}
	return u.Scheme + "://" + host, nil
}

func (s *Service) browserEndpoint(r *http.Request) (browserEndpoint, bool) {
	// A Host-preserving proxy or authenticated ingress supplies Host.
	// Forwarded headers alone never select a redirect target.
	endpoint, ok := s.browsers[strings.ToLower(r.Host)]
	return endpoint, ok
}

// ProxyOrigins returns the canonical application and provider-alias origins
// that an authenticated ingress may select. The issuer itself is not a proxy.
func (c Config) ProxyOrigins() ([]string, error) {
	endpoints, err := browserEndpoints(c)
	if err != nil {
		return nil, err
	}
	origins := make([]string, 0, len(endpoints)*2)
	issuer, _ := url.Parse(c.Issuer)
	for _, endpoint := range endpoints {
		origins = append(origins, endpoint.app)
		if endpoint.provider != issuer.Scheme+"://"+issuer.Host {
			origins = append(origins, endpoint.provider)
		}
	}
	return origins, nil
}

func (s *Service) browserOAuth(endpoint browserEndpoint) oauth2.Config {
	config := s.oauth
	config.RedirectURL = endpoint.app + prefix + "callback"
	config.Endpoint.AuthURL = s.browserProviderURL(config.Endpoint.AuthURL, endpoint)
	return config
}

func (s *Service) browserProviderURL(raw string, endpoint browserEndpoint) string {
	u, err := url.Parse(raw)
	issuer, _ := url.Parse(s.config.Issuer)
	if err != nil || u.Scheme != issuer.Scheme || u.Host != issuer.Host {
		return raw
	}
	provider, _ := url.Parse(endpoint.provider)
	u.Scheme, u.Host = provider.Scheme, provider.Host
	return u.String()
}

func browserCookieNamespace(c Config) string {
	hash := sha256.Sum256([]byte(c.Issuer + "\x00" + c.ClientID))
	return "waypoint_" + hex.EncodeToString(hash[:8]) + "_"
}

func isSafeMethod(method string) bool {
	return method == http.MethodGet || method == http.MethodHead || method == http.MethodOptions
}
