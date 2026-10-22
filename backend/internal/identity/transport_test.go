package identity

import (
	"io"
	"net/http"
	"net/http/httptest"
	"net/url"
	"testing"
)

func TestInternalTransportPreservesPublicIssuerHost(t *testing.T) {
	const publicHost = "identity.example.test"
	server := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		if r.Host != publicHost {
			w.WriteHeader(http.StatusMisdirectedRequest)
			return
		}
		if r.URL.RequestURI() != "/api/auth/token?test=1" {
			t.Errorf("rewritten path=%q", r.URL.RequestURI())
		}
		w.WriteHeader(http.StatusNoContent)
	}))
	defer server.Close()
	issuer, _ := url.Parse("https://" + publicHost)
	internal, _ := url.Parse(server.URL)
	client := &http.Client{Transport: &issuerTransport{base: http.DefaultTransport, issuer: issuer, internal: internal}}
	r, err := client.Get(issuer.String() + "/api/auth/token?test=1")
	if err != nil {
		t.Fatal(err)
	}
	defer r.Body.Close()
	if r.StatusCode != http.StatusNoContent {
		body, _ := io.ReadAll(r.Body)
		t.Fatalf("internal issuer request=%d %s", r.StatusCode, body)
	}
}
