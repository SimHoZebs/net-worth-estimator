// Package identity owns provider-independent OIDC login and application sessions.
package identity

import (
	"context"
	"fmt"
	"net/url"
	"time"

	"github.com/simhozebs/net-worth-estimator/backend/internal/authorization"
)

type Config struct {
	Provider, Issuer, InternalURL, ClientID, ClientSecret string
	PublicURL, AccountURL, SessionDB                      string
	Lifetime                                              time.Duration
	RecheckInterval                                       time.Duration
	ResolveAccess                                         func(context.Context, string) (authorization.Scope, error)
	RequireResourceHeader                                 bool
}

// FromEnv keeps identity configuration separate from financial-server settings.
func FromEnv(getenv func(string) string, databasePath string) (Config, error) {
	c := Config{
		Provider:     getenv("NET_WORTH_ESTIMATOR_AUTH_PROVIDER"),
		Issuer:       getenv("NET_WORTH_ESTIMATOR_AUTH_ISSUER"),
		InternalURL:  getenv("NET_WORTH_ESTIMATOR_AUTH_INTERNAL_URL"),
		ClientID:     getenv("NET_WORTH_ESTIMATOR_AUTH_CLIENT_ID"),
		ClientSecret: getenv("NET_WORTH_ESTIMATOR_AUTH_CLIENT_SECRET"),
		PublicURL:    getenv("NET_WORTH_ESTIMATOR_PUBLIC_URL"),
		AccountURL:   getenv("NET_WORTH_ESTIMATOR_AUTH_ACCOUNT_URL"),
		SessionDB:    databasePath + ".sessions", Lifetime: 7 * 24 * time.Hour, RecheckInterval: 30 * time.Second,
		RequireResourceHeader: true,
	}
	if c.Provider == "" || c.Provider == "none" {
		c.Provider = "none"
		return c, nil
	}
	if c.Provider != "casdoor" {
		return c, fmt.Errorf("AUTH_PROVIDER must be none or casdoor")
	}
	if getenv("NET_WORTH_ESTIMATOR_AUTH_TOKEN") != "" {
		return c, fmt.Errorf("AUTH_TOKEN cannot be combined with an identity provider")
	}
	if v := getenv("NET_WORTH_ESTIMATOR_AUTH_SESSION_DB"); v != "" {
		c.SessionDB = v
	}
	if v := getenv("NET_WORTH_ESTIMATOR_AUTH_SESSION_LIFETIME"); v != "" {
		d, err := time.ParseDuration(v)
		if err != nil || d <= 0 {
			return c, fmt.Errorf("AUTH_SESSION_LIFETIME must be a positive Go duration")
		}
		c.Lifetime = d
	}
	if v := getenv("NET_WORTH_ESTIMATOR_AUTH_RECHECK_INTERVAL"); v != "" {
		d, err := time.ParseDuration(v)
		if err != nil || d < time.Second || d > 5*time.Minute {
			return c, fmt.Errorf("AUTH_RECHECK_INTERVAL must be between 1s and 5m")
		}
		c.RecheckInterval = d
	}
	for _, field := range []struct {
		name, value string
		origin      bool
	}{
		{"AUTH_ISSUER", c.Issuer, false}, {"PUBLIC_URL", c.PublicURL, true},
	} {
		if err := validateURL(field.value, field.origin); err != nil {
			return c, fmt.Errorf("%s: %w", field.name, err)
		}
		u, _ := url.Parse(field.value)
		if u.Scheme == "http" && u.Hostname() != "localhost" && u.Hostname() != "127.0.0.1" && u.Hostname() != "::1" {
			return c, fmt.Errorf("%s requires HTTPS outside loopback", field.name)
		}
	}
	if c.InternalURL != "" {
		if err := validateURL(c.InternalURL, false); err != nil {
			return c, fmt.Errorf("AUTH_INTERNAL_URL: %w", err)
		}
		u, _ := url.Parse(c.InternalURL)
		if u.Path != "" && u.Path != "/" {
			return c, fmt.Errorf("AUTH_INTERNAL_URL must not contain a path")
		}
	}
	if c.ClientID == "" || c.ClientSecret == "" {
		return c, fmt.Errorf("AUTH_CLIENT_ID and AUTH_CLIENT_SECRET are required")
	}
	if c.AccountURL != "" {
		a, err := url.Parse(c.AccountURL)
		i, _ := url.Parse(c.Issuer)
		if err != nil || a.Scheme != i.Scheme || a.Host != i.Host || a.User != nil || a.Fragment != "" {
			return c, fmt.Errorf("AUTH_ACCOUNT_URL must use the issuer origin")
		}
	}
	return c, nil
}

func validateURL(raw string, origin bool) error {
	u, err := url.Parse(raw)
	if err != nil || u.Host == "" || u.User != nil || u.RawQuery != "" || u.Fragment != "" {
		return fmt.Errorf("expected an absolute HTTP/S URL without credentials, query, or fragment")
	}
	if u.Scheme != "https" && u.Scheme != "http" {
		return fmt.Errorf("expected HTTP or HTTPS")
	}
	if origin && u.Path != "" && u.Path != "/" {
		return fmt.Errorf("expected an origin without a path")
	}
	if origin && u.Scheme == "http" && u.Hostname() != "localhost" && u.Hostname() != "127.0.0.1" && u.Hostname() != "::1" {
		return fmt.Errorf("HTTP is restricted to loopback hosts; use HTTPS for network access")
	}
	return nil
}
