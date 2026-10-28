package authorization

import "testing"

func TestIsLoopbackHost(t *testing.T) {
	for _, host := range []string{"localhost", "LOCALHOST", "127.0.0.1", "::1", "[::1]", "localhost."} {
		if !IsLoopbackHost(host) {
			t.Errorf("expected loopback host: %s", host)
		}
	}
	for _, host := range []string{"", "192.168.1.50", "8.8.8.8", "myserver", "nas.local"} {
		if IsLoopbackHost(host) {
			t.Errorf("expected non-loopback host: %s", host)
		}
	}
}

func TestAllowPrivateHTTPFlag(t *testing.T) {
	for _, value := range []string{"1", "true", "yes", "TRUE", " Yes "} {
		if !AllowPrivateHTTP(func(string) string { return value }) {
			t.Errorf("expected enabled for %q", value)
		}
	}
	for _, value := range []string{"", "0", "false", "no", "lan"} {
		if AllowPrivateHTTP(func(string) string { return value }) {
			t.Errorf("expected disabled for %q", value)
		}
	}
}

func TestInsecureHTTPIssuerRequiresFlag(t *testing.T) {
	base := Config{ClientID: "id", ClientSecret: "secret"}
	withFlag := base
	withFlag.Issuer = "http://192.168.1.50:8000"
	withFlag.AllowPrivateHTTP = true
	if _, err := New(withFlag); err != nil {
		t.Fatalf("HTTP issuer with flag rejected: %v", err)
	}
	withoutFlag := base
	withoutFlag.Issuer = "http://192.168.1.50:8000"
	if _, err := New(withoutFlag); err == nil {
		t.Fatal("HTTP issuer without flag accepted")
	}
}
