package identity

import (
	"testing"
	"time"
)

func TestProviderConfiguration(t *testing.T) {
	base := map[string]string{
		"NET_WORTH_ESTIMATOR_AUTH_PROVIDER":      "casdoor",
		"NET_WORTH_ESTIMATOR_AUTH_ISSUER":        "http://localhost:8000",
		"NET_WORTH_ESTIMATOR_PUBLIC_URL":         "http://localhost:8080",
		"NET_WORTH_ESTIMATOR_AUTH_CLIENT_ID":     "client",
		"NET_WORTH_ESTIMATOR_AUTH_CLIENT_SECRET": "secret",
	}
	for _, test := range []struct {
		name, key, value string
		fail             bool
	}{
		{"valid", "", "", false}, {"casdoor", "NET_WORTH_ESTIMATOR_AUTH_PROVIDER", "casdoor", false},
		{"unknown provider", "NET_WORTH_ESTIMATOR_AUTH_PROVIDER", "typo", true},
		{"archived provider", "NET_WORTH_ESTIMATOR_AUTH_PROVIDER", "better-auth", true},
		{"legacy bypass", "NET_WORTH_ESTIMATOR_AUTH_TOKEN", "legacy", true},
		{"empty issuer", "NET_WORTH_ESTIMATOR_AUTH_ISSUER", "", true},
		{"insecure public URL", "NET_WORTH_ESTIMATOR_PUBLIC_URL", "http://my-server.local", true},
		{"public path", "NET_WORTH_ESTIMATOR_PUBLIC_URL", "https://example.test/path", true},
		{"missing secret", "NET_WORTH_ESTIMATOR_AUTH_CLIENT_SECRET", "", true},
		{"wildcard grant", "NET_WORTH_ESTIMATOR_AUTH_EDITORS", "*", true},
		{"empty grant", "NET_WORTH_ESTIMATOR_AUTH_READERS", "alice,", true},
		{"invalid TTL", "NET_WORTH_ESTIMATOR_AUTH_SESSION_LIFETIME", "-1h", true},
		{"invalid revocation window", "NET_WORTH_ESTIMATOR_AUTH_RECHECK_INTERVAL", "6m", true},
		{"disabled revocation checks", "NET_WORTH_ESTIMATOR_AUTH_RECHECK_INTERVAL", "0s", true},
		{"internal HTTP", "NET_WORTH_ESTIMATOR_AUTH_INTERNAL_URL", "http://casdoor:8000", false},
		{"wrong account origin", "NET_WORTH_ESTIMATOR_AUTH_ACCOUNT_URL", "https://elsewhere.test", true},
	} {
		t.Run(test.name, func(t *testing.T) {
			env := func(k string) string {
				if k == test.key {
					return test.value
				}
				return base[k]
			}
			c, err := FromEnv(env, "/data/model.db")
			if (err != nil) != test.fail {
				t.Fatalf("error=%v, fail=%v", err, test.fail)
			}
			if err == nil && (c.SessionDB != "/data/model.db.sessions" || c.Lifetime != 7*24*time.Hour) {
				t.Fatalf("unexpected defaults: %+v", c)
			}
		})
	}
	c, err := FromEnv(func(string) string { return "" }, "model.db")
	if err != nil || c.Provider != "none" {
		t.Fatalf("disabled mode: %+v %v", c, err)
	}
}
