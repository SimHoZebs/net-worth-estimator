package plans

import (
	"encoding/json"
	"net/http"
	"net/http/httptest"
	"os"
	"path/filepath"
	"strings"
	"testing"

	"github.com/simhozebs/net-worth-estimator/backend/internal/authorization"
	"github.com/simhozebs/net-worth-estimator/backend/internal/store"
	"github.com/simhozebs/net-worth-estimator/backend/internal/types"
)

func privateID(letter string) string { return "plans/" + strings.Repeat(letter, 64) }

func newRouter(t *testing.T, owner string) (*Router, store.Store, Config) {
	t.Helper()
	dir := t.TempDir()
	config := Config{PrimaryResourceID: owner, PrimaryDBPath: filepath.Join(dir, "primary.db"), SampleDBPath: filepath.Join(dir, "sample.db"), PrivateDir: filepath.Join(dir, "plans")}
	primary, err := store.Open(config.PrimaryDBPath)
	if err != nil {
		t.Fatal(err)
	}
	t.Cleanup(func() { _ = primary.Close() })
	if _, err := primary.CreateAccount(types.Account{ID: "primary", Name: "Private owner checking", Kind: "cash", Enabled: true}); err != nil {
		t.Fatal(err)
	}
	sample, err := store.Open(config.SampleDBPath)
	if err != nil {
		t.Fatal(err)
	}
	if _, err := sample.CreateAccount(types.Account{ID: "sample", Name: "Published sample", Kind: "cash", Enabled: true}); err != nil {
		t.Fatal(err)
	}
	if err := sample.Close(); err != nil {
		t.Fatal(err)
	}
	router, err := New(primary, config)
	if err != nil {
		t.Fatal(err)
	}
	t.Cleanup(func() { _ = router.Close() })
	return router, primary, config
}

func request(t *testing.T, handler http.Handler, method, path, body string) *httptest.ResponseRecorder {
	t.Helper()
	r := httptest.NewRequest(method, path, strings.NewReader(body))
	r.Header.Set("Content-Type", "application/json")
	w := httptest.NewRecorder()
	handler.ServeHTTP(w, r)
	return w
}

func model(t *testing.T, handler http.Handler) *types.FinancialModelDocument {
	t.Helper()
	w := request(t, handler, "GET", "/v1/financial-model", "")
	if w.Code != 200 {
		t.Fatalf("read model=%d %s", w.Code, w.Body.String())
	}
	var body struct{ Document *types.FinancialModelDocument }
	if err := json.Unmarshal(w.Body.Bytes(), &body); err != nil {
		t.Fatal(err)
	}
	return body.Document
}

func TestPlansIsolateEveryAccountFromSampleAndOtherAccounts(t *testing.T) {
	router, _, config := newRouter(t, privateID("a"))
	owner, err := router.handlerFor(authorization.Resource{ID: privateID("a"), Kind: "private"})
	if err != nil {
		t.Fatal(err)
	}
	guest, err := router.handlerFor(authorization.Resource{ID: "plans/sample", Kind: "sample"})
	if err != nil {
		t.Fatal(err)
	}
	other, err := router.handlerFor(authorization.Resource{ID: privateID("b"), Kind: "private"})
	if err != nil {
		t.Fatal(err)
	}
	if model(t, owner).Accounts[0].ID != "primary" || model(t, guest).Accounts[0].ID != "sample" || model(t, other) != nil {
		t.Fatal("a plan exposed another plan's financial rows")
	}
	write := `{"id":"other","name":"Other account checking","kind":"cash","enabled":true}`
	if w := request(t, other, "POST", "/v1/accounts", write); w.Code != 200 {
		t.Fatalf("other account write=%d %s", w.Code, w.Body.String())
	}
	if w := request(t, guest, "POST", "/v1/accounts", write); w.Code != 403 {
		t.Fatalf("guest canonical write=%d", w.Code)
	}
	if model(t, other).Accounts[0].ID != "other" || len(model(t, owner).Accounts) != 1 || len(model(t, guest).Accounts) != 1 {
		t.Fatal("canonical writes crossed the plan boundary")
	}
	for _, suffix := range []string{"/v1/amount-presets", "/v1/pinned-evaluations", "/v1/sync/simplefin/accounts"} {
		if w := request(t, guest, "GET", suffix, ""); w.Code != 200 {
			t.Fatalf("guest scoped read %s=%d", suffix, w.Code)
		}
	}
	file := filepath.Join(config.PrivateDir, strings.Repeat("b", 64)+".db")
	if info, err := os.Stat(file); err != nil || info.Mode().Perm() != 0o600 {
		t.Fatalf("private database permissions: %v %v", info, err)
	}
	if err := router.Close(); err != nil {
		t.Fatal(err)
	}
	primary, err := store.Open(config.PrimaryDBPath)
	if err != nil {
		t.Fatal(err)
	}
	defer primary.Close()
	restarted, err := New(primary, config)
	if err != nil {
		t.Fatal(err)
	}
	defer restarted.Close()
	other, err = restarted.handlerFor(authorization.Resource{ID: privateID("b"), Kind: "private"})
	if err != nil || model(t, other).Accounts[0].ID != "other" {
		t.Fatalf("private plan did not persist across restart: %v", err)
	}
}

func TestPlanRoutingFailsClosedOnMissingScopeAndUnsafeResources(t *testing.T) {
	router, primary, config := newRouter(t, privateID("a"))
	if w := request(t, router, "GET", "/v1/financial-model", ""); w.Code != 403 {
		t.Fatalf("unverified plan routing=%d", w.Code)
	}
	if _, err := os.Stat(config.PrivateDir); !os.IsNotExist(err) {
		t.Fatalf("unauthorized request created private stores: %v", err)
	}
	for _, resource := range []authorization.Resource{
		{ID: "plans/../../primary.db", Kind: "private"}, {ID: "plans/sample", Kind: "private"},
		{ID: privateID("a"), Kind: "sample"}, {ID: privateID("g"), Kind: "private"},
	} {
		if _, err := router.handlerFor(resource); err == nil {
			t.Errorf("unsafe resource accepted: %+v", resource)
		}
	}
	withoutOwner := config
	withoutOwner.PrimaryResourceID = ""
	if _, err := New(primary, withoutOwner); err == nil {
		t.Fatal("nonempty legacy data received an implicit owner")
	}
	aliased := config
	aliased.SampleDBPath = aliased.PrimaryDBPath
	if _, err := New(primary, aliased); err == nil {
		t.Fatal("sample plan aliases the primary database")
	}
	alias := filepath.Join(filepath.Dir(config.PrimaryDBPath), "sample-alias.db")
	if err := os.Link(config.PrimaryDBPath, alias); err != nil {
		t.Fatal(err)
	}
	aliased.SampleDBPath = alias
	if _, err := New(primary, aliased); err == nil {
		t.Fatal("hard-linked sample aliases the primary database")
	}
	if err := os.MkdirAll(config.PrivateDir, 0o700); err != nil {
		t.Fatal(err)
	}
	privatePath := filepath.Join(config.PrivateDir, strings.Repeat("c", 64)+".db")
	if err := os.Symlink(config.PrimaryDBPath, privatePath); err != nil {
		t.Fatal(err)
	}
	if _, err := router.handlerFor(authorization.Resource{ID: privateID("c"), Kind: "private"}); err == nil {
		t.Fatal("symbolic link exposed another plan")
	}
}
