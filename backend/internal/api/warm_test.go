package api

import (
	"bytes"
	"context"
	"encoding/json"
	"net/http"
	"net/http/httptest"
	"sync"
	"sync/atomic"
	"testing"
	"time"

	"github.com/simhozebs/net-worth-estimator/backend/internal/simplefin"
	"github.com/simhozebs/net-worth-estimator/backend/internal/store"
	"github.com/simhozebs/net-worth-estimator/backend/internal/types"
)

func TestWarmFallbackStartDate(t *testing.T) {
	checkpointed := &types.FinancialModelDocument{
		Checkpoints: []types.Checkpoint{
			{AccountID: "a", Date: "2026-03-01"},
			{AccountID: "a", Date: "2026-05-01"},
		},
		RecurrenceRules: []types.RecurrenceRule{{StartDate: "2026-01-01"}},
	}
	if got := warmFallbackStartDate(checkpointed); got != "2026-05-01" {
		t.Errorf("checkpointed start = %q, want latest checkpoint", got)
	}
	ruled := &types.FinancialModelDocument{
		RecurrenceRules: []types.RecurrenceRule{{StartDate: "2026-02-01"}},
		Postings:        []types.Posting{{TransactionTime: 1780272000}},
	}
	if got := warmFallbackStartDate(ruled); got != "2026-02-01" {
		t.Errorf("ruled start = %q, want first rule start", got)
	}
	posted := &types.FinancialModelDocument{
		Postings: []types.Posting{{Purchase: &types.PurchasePolicy{}, TransactionTime: 1780272000}},
	}
	today := time.Now().UTC().Format("2006-01-02")
	if got := warmFallbackStartDate(posted); got != today {
		t.Errorf("purchase-only start = %q, want today %q", got, today)
	}
	single := &types.FinancialModelDocument{
		Postings: []types.Posting{{TransactionTime: 1780272000}},
	}
	if got := warmFallbackStartDate(single); got != "2026-06-01" {
		t.Errorf("posted start = %q, want 2026-06-01", got)
	}
}

type countingArtifactStore struct {
	store.Store
	puts atomic.Int64
}

func (s *countingArtifactStore) PutArtifact(identity, kind, payload string) error {
	s.puts.Add(1)
	return s.Store.PutArtifact(identity, kind, payload)
}

func TestWarmResourceSkipsPresentArtifacts(t *testing.T) {
	database := openAPIStore(t)
	if _, err := database.CreateAccount(types.Account{ID: "checking", Name: "Checking", Kind: "cash", Enabled: true}); err != nil {
		t.Fatalf("seed account: %v", err)
	}
	counted := &countingArtifactStore{Store: database}
	params := WarmParams{HorizonYears: 1, RunCount: 2, Seed: 7}
	if err := WarmResource(context.Background(), counted, "plans/sample", params); err != nil {
		t.Fatalf("warm: %v", err)
	}
	if got := counted.puts.Load(); got != 2 {
		t.Fatalf("first warm puts = %d, want 2 (deterministic plus stochastic)", got)
	}
	if err := WarmResource(context.Background(), counted, "plans/sample", params); err != nil {
		t.Fatalf("rewarm: %v", err)
	}
	if got := counted.puts.Load(); got != 2 {
		t.Fatalf("rewarm puts = %d, want still 2 (present artifacts skip recompute)", got)
	}
}

func TestMutationMiddlewareClassifiesRoutes(t *testing.T) {
	var calls atomic.Int64
	var last string
	database := openAPIStore(t)
	handler := New(database, Config{OnMutated: func(resourceID string) {
		calls.Add(1)
		last = resourceID
	}})
	notify := func(method, path, body string) int {
		return doRowRequest(t, handler, method, path, body).Code
	}
	if code := notify(http.MethodPost, "/v1/accounts", `{"name":"Probe","kind":"cash","enabled":true}`); code/100 != 2 {
		t.Fatalf("create status = %d", code)
	}
	if got := calls.Load(); got != 1 {
		t.Fatalf("row write notifications = %d, want 1", got)
	}
	before := calls.Load()
	notify(http.MethodGet, "/v1/financial-model", "")
	notify(http.MethodPost, "/v1/projections/deterministic", `{}`)
	notify(http.MethodPut, "/v1/pinned-evaluations", `{"instanceIds":[]}`)
	notify(http.MethodGet, "/v1/amount-presets", "")
	if got := calls.Load(); got != before {
		t.Fatalf("read/compute/pin/preset notifications = %d, want still %d", got, before)
	}
	if last != "" {
		t.Fatalf("resource = %q, want test server resource", last)
	}
}

// Warmed artifacts must match live handler requests with frontend-equivalent
// settings, or warming writes unreachable entries while pins still miss.
func TestWarmedKeysMatchHandlerRequests(t *testing.T) {
	resetSharedRunsForTest()
	t.Cleanup(resetSharedRunsForTest)
	database := openAPIStore(t)
	if _, err := database.CreateAccount(types.Account{ID: "checking", Name: "Checking", Kind: "cash", Enabled: true}); err != nil {
		t.Fatalf("seed account: %v", err)
	}
	document, err := database.LoadDocument()
	if err != nil || document == nil {
		t.Fatalf("load stored plan: %v", err)
	}
	if err := WarmResource(context.Background(), database, "plans/sample", WarmDefaults()); err != nil {
		t.Fatalf("warm: %v", err)
	}
	// Frontend-equivalent settings for this document: no checkpoints,
	// rules, or dated postings, so the fallback is today.
	settings := types.ProjectionRuntimeSettings{
		FallbackProjectionStartDate: time.Now().UTC().Format("2006-01-02"),
		HorizonYears:                20,
		Evaluations:                 document.Evaluations,
	}
	handler := New(database, Config{ResourceID: "plans/sample"})

	detBody, err := json.Marshal(projectionRequestBody{Document: document, Settings: settings})
	if err != nil {
		t.Fatalf("encode deterministic body: %v", err)
	}
	detRequest := httptest.NewRequest(http.MethodPost, "/v1/projections/deterministic", bytes.NewReader(detBody))
	detRequest.Header.Set("Content-Type", "application/json")
	detResponse := httptest.NewRecorder()
	handler.ServeHTTP(detResponse, detRequest)
	if detResponse.Code != http.StatusOK {
		t.Fatalf("deterministic status = %d, body %s", detResponse.Code, detResponse.Body.String())
	}
	if got := detResponse.Header().Get("X-Cache"); got != "hit" {
		t.Fatalf("deterministic X-Cache = %q, want hit", got)
	}

	seed := int64(42)
	stochBody, err := json.Marshal(map[string]any{
		"document": document,
		"settings": settings,
		"config":   map[string]any{"runCount": 400, "seed": seed},
	})
	if err != nil {
		t.Fatalf("encode stochastic body: %v", err)
	}
	stochRequest := httptest.NewRequest(http.MethodPost, "/v1/projections/stochastic", bytes.NewReader(stochBody))
	stochRequest.Header.Set("Content-Type", "application/json")
	stochResponse := httptest.NewRecorder()
	handler.ServeHTTP(stochResponse, stochRequest)
	if stochResponse.Code != http.StatusOK {
		t.Fatalf("stochastic status = %d", stochResponse.Code)
	}
	if got := stochResponse.Header().Get("X-Cache"); got != "hit" {
		t.Fatalf("stochastic X-Cache = %q, want hit", got)
	}
	if events := sseEvents(t, stochResponse.Body.String()); len(events["result"]) != 1 {
		t.Fatalf("stochastic response has %d result events", len(events["result"]))
	}
}

func TestReportsMutationTable(t *testing.T) {
	for _, test := range []struct {
		method, path string
		want         bool
	}{
		{http.MethodPost, "/v1/accounts", true},
		{http.MethodPatch, "/v1/postings/id", true},
		{http.MethodDelete, "/v1/checkpoints", true},
		{http.MethodPut, "/v1/sync/simplefin/accounts/bridge-1", false},
		{http.MethodPost, "/v1/sync/simplefin", false},
		{http.MethodPost, "/v1/projections/deterministic", false},
		{http.MethodPost, "/v1/projections/stochastic", false},
		{http.MethodGet, "/v1/auth/session", false},
		{http.MethodPut, "/v1/pinned-evaluations", false},
		{http.MethodGet, "/v1/amount-presets", false},
		{http.MethodPost, "/v1/amount-presets/reorder", false},
		{http.MethodGet, "/v1/financial-model", false},
		{http.MethodGet, "/healthz", false},
	} {
		if got := reportsMutation(test.method, test.path); got != test.want {
			t.Errorf("reportsMutation(%s, %s) = %v, want %v", test.method, test.path, got, test.want)
		}
	}
}

func TestDryTriggerReportsDryRun(t *testing.T) {
	database := openAPIStore(t)
	var mu sync.Mutex
	var reports []struct {
		id  string
		dry bool
	}
	handler := New(database, Config{
		ResourceID: "plans/sample",
		SyncRunner: simplefin.NewMockRunner(database, simplefin.Config{DryRun: true}),
		OnSyncApplied: func(resourceID string, dryRun bool) {
			mu.Lock()
			reports = append(reports, struct {
				id  string
				dry bool
			}{resourceID, dryRun})
			mu.Unlock()
		},
	})
	request := httptest.NewRequest(http.MethodPost, "/v1/sync/simplefin", nil)
	response := httptest.NewRecorder()
	handler.ServeHTTP(response, request)
	if response.Code != http.StatusOK {
		t.Fatalf("trigger status = %d, body %s", response.Code, response.Body.String())
	}
	mu.Lock()
	defer mu.Unlock()
	if len(reports) != 1 || reports[0].id != "plans/sample" || !reports[0].dry {
		t.Fatalf("sync reports = %+v, want one dry report for plans/sample", reports)
	}
}
