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
		{"default provider", "NET_WORTH_ESTIMATOR_AUTH_PROVIDER", "", false},
		{"disabled provider", "NET_WORTH_ESTIMATOR_AUTH_PROVIDER", "none", true},
		{"unknown provider", "NET_WORTH_ESTIMATOR_AUTH_PROVIDER", "typo", true},
		{"archived provider", "NET_WORTH_ESTIMATOR_AUTH_PROVIDER", "better-auth", true},
		{"legacy bypass", "NET_WORTH_ESTIMATOR_AUTH_TOKEN", "legacy", true},
		{"separate identity database", "NET_WORTH_ESTIMATOR_AUTH_SESSION_DB", "/data/sessions.db", true},
		{"empty issuer", "NET_WORTH_ESTIMATOR_AUTH_ISSUER", "", true},
		{"insecure public URL", "NET_WORTH_ESTIMATOR_PUBLIC_URL", "http://my-server.local", true},
		{"public path", "NET_WORTH_ESTIMATOR_PUBLIC_URL", "https://example.test/path", true},
		{"missing secret", "NET_WORTH_ESTIMATOR_AUTH_CLIENT_SECRET", "", true},
		{"invalid TTL", "NET_WORTH_ESTIMATOR_AUTH_SESSION_LIFETIME", "-1h", true},
		{"invalid revocation window", "NET_WORTH_ESTIMATOR_AUTH_RECHECK_INTERVAL", "6m", true},
		{"disabled revocation checks", "NET_WORTH_ESTIMATOR_AUTH_RECHECK_INTERVAL", "0s", true},
		{"internal HTTP", "NET_WORTH_ESTIMATOR_AUTH_INTERNAL_URL", "http://casdoor:8000", false},
		{"wrong account origin", "NET_WORTH_ESTIMATOR_AUTH_ACCOUNT_URL", "https://elsewhere.test", true},
		{"browser alias", "NET_WORTH_ESTIMATOR_AUTH_BROWSER_ORIGINS", `{"http://localhost:8081":"http://localhost:8001"}`, false},
		{"invalid browser mapping", "NET_WORTH_ESTIMATOR_AUTH_BROWSER_ORIGINS", `[]`, true},
		{"null browser mapping", "NET_WORTH_ESTIMATOR_AUTH_BROWSER_ORIGINS", `null`, true},
		{"insecure browser app", "NET_WORTH_ESTIMATOR_AUTH_BROWSER_ORIGINS", `{"http://tail.test":"https://auth.test"}`, true},
		{"insecure browser provider", "NET_WORTH_ESTIMATOR_AUTH_BROWSER_ORIGINS", `{"http://localhost:8081":"http://auth.test"}`, true},
		{"mixed app schemes", "NET_WORTH_ESTIMATOR_AUTH_BROWSER_ORIGINS", `{"https://tail.test":"https://auth.test"}`, true},
		{"browser app path", "NET_WORTH_ESTIMATOR_AUTH_BROWSER_ORIGINS", `{"http://localhost:8081/path":"http://localhost:8001"}`, true},
		{"browser provider query", "NET_WORTH_ESTIMATOR_AUTH_BROWSER_ORIGINS", `{"http://localhost:8081":"http://localhost:8001?x=y"}`, true},
		{"browser port range", "NET_WORTH_ESTIMATOR_AUTH_BROWSER_ORIGINS", `{"http://localhost:65536":"http://localhost:8001"}`, true},
		{"primary provider replacement", "NET_WORTH_ESTIMATOR_AUTH_BROWSER_ORIGINS", `{"http://localhost:8080":"http://localhost:8001"}`, true},
		{"app provider collision", "NET_WORTH_ESTIMATOR_AUTH_BROWSER_ORIGINS", `{"http://localhost:8081":"http://localhost:8080"}`, true},
	} {
		t.Run(test.name, func(t *testing.T) {
			env := func(k string) string {
				if k == test.key {
					return test.value
				}
				return base[k]
			}
			c, err := FromEnv(env)
			if (err != nil) != test.fail {
				t.Fatalf("error=%v, fail=%v", err, test.fail)
			}
			if err == nil && (c.SessionDB != "" || c.Database != nil || c.Lifetime != 7*24*time.Hour) {
				t.Fatalf("unexpected defaults: %+v", c)
			}
		})
	}
	c, err := FromEnv(func(string) string { return "" })
	if err == nil || c.Provider != "casdoor" {
		t.Fatalf("missing identity configuration must fail closed: %+v %v", c, err)
	}
}

func TestPrivateLANHTTPRequiresFlag(t *testing.T) {
	base := map[string]string{
		"NET_WORTH_ESTIMATOR_AUTH_PROVIDER":      "casdoor",
		"NET_WORTH_ESTIMATOR_AUTH_ISSUER":        "http://192.168.1.50:8000",
		"NET_WORTH_ESTIMATOR_PUBLIC_URL":         "http://192.168.1.50:8080",
		"NET_WORTH_ESTIMATOR_AUTH_CLIENT_ID":     "client",
		"NET_WORTH_ESTIMATOR_AUTH_CLIENT_SECRET": "secret",
	}
	fromMap := func(m map[string]string) func(string) string {
		return func(k string) string { return m[k] }
	}
	if _, err := FromEnv(fromMap(base)); err == nil {
		t.Fatal("HTTP origin without flag accepted")
	}
	withFlag := map[string]string{}
	for k, v := range base {
		withFlag[k] = v
	}
	withFlag["NET_WORTH_ESTIMATOR_ALLOW_PRIVATE_HTTP"] = "1"
	c, err := FromEnv(fromMap(withFlag))
	if err != nil {
		t.Fatalf("HTTP origin with flag rejected: %v", err)
	}
	if !c.AllowPrivateHTTP {
		t.Fatal("flag was not recorded")
	}
}
