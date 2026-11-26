package identity

import (
	"context"
	"net/http"
	"net/http/httptest"
	"path/filepath"
	"strings"
	"testing"

	"github.com/simhozebs/net-worth-estimator/backend/internal/api"
	"github.com/simhozebs/net-worth-estimator/backend/internal/blobstore/adapters/memory"
	"github.com/simhozebs/net-worth-estimator/backend/internal/businesslogos"
	"github.com/simhozebs/net-worth-estimator/backend/internal/store/adapters/sqlite"
)

func TestCatalogAssetsArePublicWithoutWeakeningUserDataRoutes(t *testing.T) {
	p := newIDP(t)
	service, err := businesslogos.New(memory.New())
	if err != nil {
		t.Fatal(err)
	}
	if err := service.Seed(context.Background()); err != nil {
		t.Fatal(err)
	}
	database, err := sqlite.Open(filepath.Join(t.TempDir(), "financial.db"))
	if err != nil {
		t.Fatal(err)
	}
	defer database.Close()
	s := newService(t, p, filepath.Join(t.TempDir(), "sessions.db"), func(c *Config) {
		c.RequireResourceHeader = true
	})
	server := httptest.NewServer(s.Wrap(api.New(database, api.Config{AssetService: service})))
	defer server.Close()
	client := testClient(t)

	asset, _ := businesslogos.Lookup("chase")
	for _, path := range []string{
		businesslogos.PathPrefix + "chase",
		businesslogos.PathPrefix + "chase/" + asset.Version,
	} {
		response, err := client.Get(server.URL + path)
		if err != nil {
			t.Fatal(err)
		}
		response.Body.Close()
		if response.StatusCode != http.StatusFound && response.StatusCode != http.StatusOK {
			t.Fatalf("catalog GET %s = %d", path, response.StatusCode)
		}
		if response.Header.Get("Cache-Control") == "no-store" {
			t.Fatalf("catalog GET %s lost immutable caching", path)
		}
	}

	request, _ := http.NewRequest(http.MethodGet, server.URL+businesslogos.PathPrefix+"chase", nil)
	request.Header.Set(ResourceHeader, "users/"+strings.Repeat("f", 64))
	stale, err := client.Do(request)
	if err != nil {
		t.Fatal(err)
	}
	stale.Body.Close()
	if stale.StatusCode != http.StatusFound {
		t.Fatalf("catalog GET with stale resource = %d", stale.StatusCode)
	}

	userData, err := client.Get(server.URL + "/v1/accounts/balances")
	if err != nil {
		t.Fatal(err)
	}
	userData.Body.Close()
	if userData.StatusCode != http.StatusConflict {
		t.Fatalf("/v1/accounts/balances without resource header = %d, want 409", userData.StatusCode)
	}

	write, _ := http.NewRequest(http.MethodPost, server.URL+businesslogos.PathPrefix+"chase", nil)
	denied, err := client.Do(write)
	if err != nil {
		t.Fatal(err)
	}
	denied.Body.Close()
	if denied.StatusCode == http.StatusFound || denied.StatusCode == http.StatusOK {
		t.Fatalf("catalog POST was not blocked = %d", denied.StatusCode)
	}
}
