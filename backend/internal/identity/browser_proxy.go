package identity

import (
	"context"
	"net/http"
	"net/http/httputil"
	"net/url"
	"strings"
	"time"
)

// browserProviderHandlers exposes the same Casdoor through configured browser
// aliases. The proxy never changes the issuer, signing keys, or identity store.
func (s *Service) browserProviderHandlers() map[string]http.Handler {
	handlers := map[string]http.Handler{}
	issuer, _ := url.Parse(s.config.Issuer)
	issuerOrigin := issuer.Scheme + "://" + issuer.Host
	cookiePrefix := browserCookieNamespace(s.config) + "provider_"
	for _, endpoint := range s.browsers {
		if endpoint.provider == issuerOrigin {
			continue
		}
		provider, _ := url.Parse(endpoint.provider)
		proxy := &httputil.ReverseProxy{
			Transport: s.client.Transport,
			Rewrite: func(pr *httputil.ProxyRequest) {
				pr.Out.URL.Path = strings.TrimPrefix(pr.In.URL.Path, prefix+"provider")
				pr.Out.URL.RawPath = strings.TrimPrefix(pr.In.URL.RawPath, prefix+"provider")
				pr.SetURL(issuer)
				pr.Out.Host = issuer.Host
				pr.SetXForwarded()
				pr.Out.Header.Set("X-Forwarded-Proto", provider.Scheme)
				pr.Out.Header.Del("Authorization")
				pr.Out.Header.Del("Cookie")
				for _, cookie := range pr.In.Cookies() {
					if name, found := strings.CutPrefix(cookie.Name, cookiePrefix); found && name != "" && !casdoorLogoCookie(name) {
						pr.Out.AddCookie(&http.Cookie{Name: name, Value: cookie.Value})
					}
				}
				// Casdoor checks its canonical origin. Browser CSRF checks occur
				// before this rewrite, against the configured alias instead.
				if pr.In.Header.Get("Origin") == endpoint.provider {
					pr.Out.Header.Set("Origin", issuerOrigin)
				}
				if referer, err := url.Parse(pr.In.Header.Get("Referer")); err == nil && referer.Scheme+"://"+referer.Host == endpoint.provider {
					referer.Scheme, referer.Host = issuer.Scheme, issuer.Host
					pr.Out.Header.Set("Referer", referer.String())
				}
			},
			ModifyResponse: func(response *http.Response) error {
				cookies := response.Cookies()
				response.Header.Del("Set-Cookie")
				for _, cookie := range cookies {
					if casdoorLogoCookie(cookie.Name) {
						continue
					}
					cookie.Name = cookiePrefix + cookie.Name
					cookie.Domain, cookie.Path = "", "/"
					cookie.Secure = provider.Scheme == "https"
					response.Header.Add("Set-Cookie", cookie.String())
				}
				if location := response.Header.Get("Location"); location != "" {
					response.Header.Set("Location", s.browserProviderURL(location, endpoint))
				}
				return nil
			},
			ErrorHandler: func(w http.ResponseWriter, _ *http.Request, _ error) {
				failure(w, http.StatusBadGateway, "The account service is temporarily unavailable.")
			},
		}
		csrf := http.NewCrossOriginProtection()
		_ = csrf.AddTrustedOrigin(endpoint.provider) // Validated during configuration.
		handlers[strings.ToLower(provider.Host)] = http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
			if origin := r.Header.Get("Origin"); origin != "" && origin != endpoint.provider && !isSafeMethod(r.Method) {
				failure(w, http.StatusForbidden, "The request origin does not match this account address.")
				return
			}
			ctx, cancel := context.WithTimeout(r.Context(), time.Minute)
			defer cancel()
			csrf.Handler(proxy).ServeHTTP(w, r.WithContext(ctx))
		})
	}
	return handlers
}

// Casdoor uses these only to cache presentation before application metadata
// loads. Inline SVG values can exceed browser cookie and proxy header limits.
// The login UI still obtains its unchanged logos from application metadata.
func casdoorLogoCookie(name string) bool {
	return name == "organizationLogo" || name == "organizationLogoDark"
}

func (s *Service) serveBrowserProvider(w http.ResponseWriter, r *http.Request) {
	handler, ok := s.browserProviders[strings.ToLower(r.Host)]
	if !ok {
		http.NotFound(w, r)
		return
	}
	handler.ServeHTTP(w, r)
}
