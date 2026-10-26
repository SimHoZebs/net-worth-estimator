package plans

import (
	"database/sql"
	"encoding/json"
	"net/http"
	"net/http/httptest"
	"path/filepath"
	"strings"
	"testing"

	"github.com/simhozebs/net-worth-estimator/backend/internal/api"
	"github.com/simhozebs/net-worth-estimator/backend/internal/authorization"
	"github.com/simhozebs/net-worth-estimator/backend/internal/simplefin"
	"github.com/simhozebs/net-worth-estimator/backend/internal/store"
	"github.com/simhozebs/net-worth-estimator/backend/internal/types"
)

const testIssuer = "https://identity.test"

func privateID(subject string) string { return authorization.ResourceFor(testIssuer, subject).ID }

func ensurePrivate(t *testing.T, db *store.Database, subject string) store.Store {
	t.Helper()
	scoped, err := db.EnsurePrivatePlan(privateID(subject), authorization.ActorKey(testIssuer, subject), testIssuer, subject)
	if err != nil {
		t.Fatal(err)
	}
	if err := scoped.InitializeDocument(); err != nil {
		t.Fatal(err)
	}
	return scoped
}

func newRouter(t *testing.T) (*Router, *store.Database, string) {
	t.Helper()
	path := filepath.Join(t.TempDir(), "app.db")
	database, err := store.SetupDatabase(path)
	if err != nil {
		t.Fatal(err)
	}
	t.Cleanup(func() { _ = database.Close() })
	owner := ensurePrivate(t, database, "a")
	if _, err := owner.CreateAccount(types.Account{ID: "primary", Name: "Private owner checking", Kind: "cash", Enabled: true}); err != nil {
		t.Fatal(err)
	}
	sample, err := database.EnsureSamplePlan()
	if err != nil {
		t.Fatal(err)
	}
	if _, err := sample.CreateAccount(types.Account{ID: "sample", Name: "Published sample", Kind: "cash", Enabled: true}); err != nil {
		t.Fatal(err)
	}
	router, err := New(database, Config{PrimaryResourceID: privateID("a")})
	if err != nil {
		t.Fatal(err)
	}
	t.Cleanup(func() { _ = router.Close() })
	return router, database, path
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
	router, database, path := newRouter(t)
	ensurePrivate(t, database, "b")
	owner, err := router.handlerFor(authorization.ResourceFor(testIssuer, "a"))
	if err != nil {
		t.Fatal(err)
	}
	guest, err := router.handlerFor(authorization.ResourceFor(testIssuer, ""))
	if err != nil {
		t.Fatal(err)
	}
	other, err := router.handlerFor(authorization.ResourceFor(testIssuer, "b"))
	if err != nil {
		t.Fatal(err)
	}
	blank := model(t, other)
	if model(t, owner).Accounts[0].ID != "primary" || model(t, guest).Accounts[0].ID != "sample" || blank == nil || len(blank.Accounts) != 0 {
		t.Fatal("a plan exposed another plan's financial rows")
	}
	write := `{"id":"other","name":"Other account checking","kind":"cash","enabled":true}`
	if w := request(t, other, "POST", "/v1/accounts", write); w.Code != 200 {
		t.Fatalf("other account write=%d %s", w.Code, w.Body.String())
	}
	if w := request(t, guest, "POST", "/v1/accounts", write); w.Code != 403 {
		t.Fatalf("sample canonical write=%d", w.Code)
	}
	if model(t, other).Accounts[0].ID != "other" || len(model(t, owner).Accounts) != 1 || len(model(t, guest).Accounts) != 1 {
		t.Fatal("canonical writes crossed the plan boundary")
	}
	settings := `{"statementDay":15,"statementDaySet":true,"reserve":321,"accountIds":null,"spendingAccountIds":null,"incomeRuleIds":[],"movementIds":null}`
	if w := request(t, other, "PUT", "/v1/safe-spending-settings", settings); w.Code != 200 {
		t.Fatalf("save budget settings=%d %s", w.Code, w.Body.String())
	}
	for _, isolated := range []http.Handler{owner, guest} {
		w := request(t, isolated, "GET", "/v1/safe-spending-settings", "")
		if w.Code != 200 || !strings.Contains(w.Body.String(), `"settings":null`) {
			t.Fatalf("budget settings crossed plan boundary: %d %s", w.Code, w.Body.String())
		}
	}
	if w := request(t, guest, "PUT", "/v1/safe-spending-settings", settings); w.Code != 403 {
		t.Fatalf("sample settings write=%d", w.Code)
	}
	for _, suffix := range []string{"/v1/amount-presets", "/v1/pinned-evaluations", "/v1/safe-spending-settings", "/v1/sync/simplefin/accounts"} {
		if w := request(t, guest, "GET", suffix, ""); w.Code != 200 {
			t.Fatalf("sample scoped read %s=%d", suffix, w.Code)
		}
	}
	if err := router.Close(); err != nil {
		t.Fatal(err)
	}
	// Closing a router must not close its shared connection.
	if err := database.SQL().Ping(); err != nil {
		t.Fatal(err)
	}
	if err := database.Close(); err != nil {
		t.Fatal(err)
	}
	reopened, err := store.OpenDatabase(path)
	if err != nil {
		t.Fatal(err)
	}
	defer reopened.Close()
	restarted, err := New(reopened, Config{})
	if err != nil {
		t.Fatal(err)
	}
	defer restarted.Close()
	other, err = restarted.handlerFor(authorization.ResourceFor(testIssuer, "b"))
	if err != nil || model(t, other).Accounts[0].ID != "other" {
		t.Fatalf("private plan did not persist across restart: %v", err)
	}
}

func TestPrivatePlansInitializeBlankWorkspaces(t *testing.T) {
	router, database, _ := newRouter(t)
	ensurePrivate(t, database, "new-user")
	handler, err := router.handlerFor(authorization.ResourceFor(testIssuer, "new-user"))
	if err != nil {
		t.Fatal(err)
	}
	blank := model(t, handler)
	if blank == nil || len(blank.Accounts) != 0 || len(blank.Postings) != 0 || blank.SourcePath != "" {
		t.Fatalf("new private workspace = %+v", blank)
	}
	if w := request(t, handler, "GET", "/v1/amount-presets", ""); w.Code != 200 || !strings.Contains(w.Body.String(), `"name":"fixed"`) {
		t.Fatalf("default amount presets = %d %s", w.Code, w.Body.String())
	}
	projection := `{"settings":{"fallbackProjectionStartDate":"2026-01-01","horizonYears":1,"evaluations":{"financialIndependence":[],"netWorthThreshold":[],"accountBalance":[],"postingFulfillment":[],"cycleFulfillment":[]}},"range":{"startDate":"2000-01-01","endDate":"2100-01-01"}}`
	if w := request(t, handler, "POST", "/v1/projections/deterministic", projection); w.Code != 200 {
		t.Fatalf("blank projection = %d %s", w.Code, w.Body.String())
	}
}

func TestPlanRoutingFailsClosedWithoutProvisioning(t *testing.T) {
	database, err := store.SetupDatabase(filepath.Join(t.TempDir(), "app.db"))
	if err != nil {
		t.Fatal(err)
	}
	defer database.Close()
	router, err := New(database, Config{})
	if err != nil {
		t.Fatal(err)
	}
	defer router.Close()
	if w := request(t, router, "GET", "/v1/financial-model", ""); w.Code != 403 {
		t.Fatalf("unverified plan routing=%d", w.Code)
	}
	for _, resource := range []authorization.Resource{
		{ID: "plans/../../primary.db", Kind: "private"}, {ID: "plans/sample", Kind: "private"},
		{ID: privateID("a"), Kind: "sample"}, {ID: "plans/" + strings.Repeat("g", 64), Kind: "private"},
		authorization.ResourceFor(testIssuer, "missing"), authorization.ResourceFor(testIssuer, ""),
	} {
		if _, err := router.handlerFor(resource); err == nil {
			t.Errorf("unsafe or absent resource accepted: %+v", resource)
		}
	}
	for _, id := range []string{privateID("missing"), "plans/sample"} {
		if exists, err := database.HasPlan(id); err != nil || exists {
			t.Fatalf("routing provisioned %s: exists=%v err=%v", id, exists, err)
		}
	}
	if w := request(t, router, "GET", "/healthz", ""); w.Code != 200 {
		t.Fatalf("health without a plan=%d", w.Code)
	}
	if _, err := New(database, Config{PrimaryResourceID: "plans/sample"}); err == nil {
		t.Fatal("sample can own server Bridge credentials")
	}
}

func TestServerBridgeCredentialsStayInConfiguredOwnersPlan(t *testing.T) {
	_, database, _ := newRouter(t)
	ensurePrivate(t, database, "b")
	ownerStore, err := database.Plan(privateID("a"))
	if err != nil {
		t.Fatal(err)
	}
	router, err := New(database, Config{
		PrimaryResourceID: privateID("a"),
		API:               api.Config{SyncRunner: simplefin.NewRunnerWithProvider(ownerStore, simplefin.Config{}, func() (string, map[string]struct{}) { return "https://bridge.test/simplefin", nil }, nil)},
	})
	if err != nil {
		t.Fatal(err)
	}
	defer router.Close()
	for _, subject := range []string{"a", "b", ""} {
		handler, err := router.handlerFor(authorization.ResourceFor(testIssuer, subject))
		if err != nil {
			t.Fatal(err)
		}
		w := request(t, handler, "GET", "/v1/status", "")
		var status struct {
			SyncConfigured bool `json:"syncConfigured"`
			ReadOnly       bool `json:"readOnly"`
		}
		if err := json.Unmarshal(w.Body.Bytes(), &status); err != nil {
			t.Fatal(err)
		}
		if w.Code != 200 || status.SyncConfigured != (subject == "a") || status.ReadOnly != (subject == "") {
			t.Fatalf("subject %q status=%d %+v", subject, w.Code, status)
		}
	}
}

func TestLegacyUnscopedDatabaseRequiresExplicitMigration(t *testing.T) {
	path := filepath.Join(t.TempDir(), "legacy.db")
	legacy, err := sql.Open("sqlite", path)
	if err != nil {
		t.Fatal(err)
	}
	if _, err := legacy.Exec(`CREATE TABLE model_metadata (id INTEGER PRIMARY KEY, source_path TEXT NOT NULL, document_present INTEGER NOT NULL);
		INSERT INTO model_metadata VALUES (1, 'legacy/private.csv', 1)`); err != nil {
		legacy.Close()
		t.Fatal(err)
	}
	if err := legacy.Close(); err != nil {
		t.Fatal(err)
	}
	database, err := store.OpenDatabase(path)
	if err == nil {
		database.Close()
		t.Fatal("runtime accepted an unscoped legacy database")
	}
	if !strings.Contains(strings.ToLower(err.Error()), "migration") {
		t.Fatalf("legacy database lacks explicit migration error: %v", err)
	}
}
