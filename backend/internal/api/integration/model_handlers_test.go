package integration

import (
	"bytes"
	"encoding/json"
	"github.com/simhozebs/net-worth-estimator/backend/internal/testseed"
	"math"
	"net/http"
	"net/http/httptest"
	"os"
	"path/filepath"
	"testing"

	"github.com/simhozebs/net-worth-estimator/backend/internal/simplefin"
	"github.com/simhozebs/net-worth-estimator/backend/internal/types"
)

func TestGetModelReturnsNullWhenStoreIsUninitialized(t *testing.T) {
	database := openAPIStore(t)
	handler := New(database, Config{})
	response := httptest.NewRecorder()
	handler.ServeHTTP(response, httptest.NewRequest(http.MethodGet, "/v1/financial-model", nil))

	if response.Code != http.StatusOK {
		t.Fatalf("GET status = %d, body %s", response.Code, response.Body.String())
	}
	var payload struct {
		Model  *types.FinancialModel        `json:"model"`
		Issues []types.ModelValidationIssue `json:"issues"`
	}
	if err := json.Unmarshal(response.Body.Bytes(), &payload); err != nil {
		t.Fatalf("decode GET response: %v", err)
	}
	if payload.Model != nil || payload.Issues == nil {
		t.Fatalf("unexpected uninitialized response: %+v", payload)
	}
}

func TestResetRouteIsGone(t *testing.T) {
	database := openAPIStore(t)
	handler := New(database, Config{})
	response := httptest.NewRecorder()
	handler.ServeHTTP(response, httptest.NewRequest(http.MethodPost, "/v1/financial-model/reset", nil))

	if response.Code != http.StatusNotFound {
		t.Fatalf("reset status = %d, want 404, body %s", response.Code, response.Body.String())
	}
}

func TestStatusReflectsReadOnlyFlag(t *testing.T) {
	for _, readOnly := range []bool{false, true} {
		database := openAPIStore(t)
		handler := New(database, Config{ReadOnly: readOnly})
		response := httptest.NewRecorder()
		handler.ServeHTTP(response, httptest.NewRequest(http.MethodGet, "/v1/status", nil))

		if response.Code != http.StatusOK {
			t.Fatalf("readOnly=%v status = %d, body %s", readOnly, response.Code, response.Body.String())
		}
		var payload struct {
			ReadOnly bool `json:"readOnly"`
		}
		if err := json.Unmarshal(response.Body.Bytes(), &payload); err != nil {
			t.Fatalf("decode status response: %v", err)
		}
		if payload.ReadOnly != readOnly {
			t.Fatalf("readOnly=%v status = %+v", readOnly, payload)
		}
	}
}

func TestStatusReportsSyncConfigurationAndLastSync(t *testing.T) {
	database := openAPIStore(t)
	handler := New(database, Config{})
	response := httptest.NewRecorder()
	handler.ServeHTTP(response, httptest.NewRequest(http.MethodGet, "/v1/status", nil))
	if response.Code != http.StatusOK {
		t.Fatalf("status = %d, body %s", response.Code, response.Body.String())
	}
	var unconfigured map[string]any
	if err := json.Unmarshal(response.Body.Bytes(), &unconfigured); err != nil {
		t.Fatalf("decode status: %v", err)
	}
	if unconfigured["syncConfigured"] != false {
		t.Fatalf("status = %v, want syncConfigured false", unconfigured)
	}
	if _, present := unconfigured["lastSyncAt"]; present {
		t.Fatalf("status = %v, want no lastSyncAt before any sync", unconfigured)
	}

	runner := simplefin.NewRunnerWithProvider(database, simplefin.Config{}, func() (string, map[string]struct{}) {
		return "https://user:pass@bridge.example/simplefin", nil
	}, nil)
	configured := New(database, Config{SyncRunner: runner})
	if err := database.SetLastSyncTime("2026-10-18T14:30:00Z"); err != nil {
		t.Fatalf("record last sync: %v", err)
	}
	after := httptest.NewRecorder()
	configured.ServeHTTP(after, httptest.NewRequest(http.MethodGet, "/v1/status", nil))
	if after.Code != http.StatusOK {
		t.Fatalf("status = %d, body %s", after.Code, after.Body.String())
	}
	var payload struct {
		SyncConfigured bool   `json:"syncConfigured"`
		LastSyncAt     string `json:"lastSyncAt"`
	}
	if err := json.Unmarshal(after.Body.Bytes(), &payload); err != nil {
		t.Fatalf("decode status: %v", err)
	}
	if !payload.SyncConfigured || payload.LastSyncAt != "2026-10-18T14:30:00Z" {
		t.Fatalf("status = %+v, want configured sync with recorded time", payload)
	}
}

func TestStatusReportsSyncQuota(t *testing.T) {
	database := openAPIStore(t)
	handler := New(database, Config{})
	response := httptest.NewRecorder()
	handler.ServeHTTP(response, httptest.NewRequest(http.MethodGet, "/v1/status", nil))
	if response.Code != http.StatusOK {
		t.Fatalf("status = %d, body %s", response.Code, response.Body.String())
	}
	var unconfigured map[string]any
	if err := json.Unmarshal(response.Body.Bytes(), &unconfigured); err != nil {
		t.Fatalf("decode status: %v", err)
	}
	for _, key := range []string{"syncQuotaUsed", "syncQuotaLimit"} {
		value, present := unconfigured[key]
		if !present {
			t.Fatalf("status = %v, want emitted %s", unconfigured, key)
		}
		if _, ok := value.(float64); !ok {
			t.Fatalf("status %s = %v, want number", key, value)
		}
	}
	if unconfigured["syncQuotaUsed"] != float64(0) || unconfigured["syncQuotaLimit"] != float64(0) {
		t.Fatalf("unconfigured quota = %v, want 0/0", unconfigured)
	}

	bridge := httptest.NewTLSServer(http.HandlerFunc(func(w http.ResponseWriter, _ *http.Request) {
		w.Header().Set("Content-Type", "application/json")
		_, _ = w.Write([]byte(`{"accounts":[]}`))
	}))
	t.Cleanup(bridge.Close)
	runner := simplefin.NewRunnerWithProvider(database, simplefin.Config{}, func() (string, map[string]struct{}) {
		return bridge.URL, nil
	}, bridge.Client())
	triggered := New(database, Config{SyncRunner: runner})
	trigger := httptest.NewRecorder()
	triggered.ServeHTTP(trigger, httptest.NewRequest(http.MethodPost, "/v1/sync/simplefin", nil))
	if trigger.Code != http.StatusOK {
		t.Fatalf("trigger status = %d, body %s", trigger.Code, trigger.Body.String())
	}
	quota := httptest.NewRecorder()
	triggered.ServeHTTP(quota, httptest.NewRequest(http.MethodGet, "/v1/status", nil))
	if quota.Code != http.StatusOK {
		t.Fatalf("quota status = %d, body %s", quota.Code, quota.Body.String())
	}
	var configured struct {
		SyncQuotaUsed  int `json:"syncQuotaUsed"`
		SyncQuotaLimit int `json:"syncQuotaLimit"`
	}
	if err := json.Unmarshal(quota.Body.Bytes(), &configured); err != nil {
		t.Fatalf("decode quota status: %v", err)
	}
	if configured.SyncQuotaUsed != 1 || configured.SyncQuotaLimit != simplefin.BridgeDailyQuota {
		t.Fatalf("quota = %+v, want 1/%d", configured, simplefin.BridgeDailyQuota)
	}
}

func TestReadOnlyRejectsWritesButServesReads(t *testing.T) {
	database := openAPIStore(t)
	handler := New(database, Config{ReadOnly: true})

	get := httptest.NewRecorder()
	handler.ServeHTTP(get, httptest.NewRequest(http.MethodGet, "/v1/financial-model", nil))
	if get.Code != http.StatusOK {
		t.Fatalf("GET status = %d, want 200, body %s", get.Code, get.Body.String())
	}
	var after struct {
		Model  *types.FinancialModel        `json:"model"`
		Issues []types.ModelValidationIssue `json:"issues"`
	}
	if err := json.Unmarshal(get.Body.Bytes(), &after); err != nil {
		t.Fatalf("decode GET response: %v", err)
	}
	if after.Model != nil {
		t.Fatalf("stored model changed: %+v", after.Model)
	}
}

func TestReadOnlyRejectsRowWrites(t *testing.T) {
	database := openAPIStore(t)
	root := apiProjectRoot(t)
	if _, err := testseed.Seed(database,
		filepath.Join(root, "public", "configs"),
	); err != nil {
		t.Fatalf("seed store: %v", err)
	}
	handler := New(database, Config{ReadOnly: true})

	get := httptest.NewRecorder()
	handler.ServeHTTP(get, httptest.NewRequest(http.MethodGet, "/v1/financial-model", nil))
	var payload struct {
		Model json.RawMessage `json:"model"`
	}
	if err := json.Unmarshal(get.Body.Bytes(), &payload); err != nil {
		t.Fatalf("decode GET response: %v", err)
	}

	post := httptest.NewRecorder()
	request := httptest.NewRequest(http.MethodPost, "/v1/accounts", bytes.NewReader([]byte(`{"name":"Probe","kind":"cash","enabled":true}`)))
	request.Header.Set("Content-Type", "application/json")
	handler.ServeHTTP(post, request)
	if post.Code != http.StatusForbidden {
		t.Fatalf("POST status = %d, want 403, body %s", post.Code, post.Body.String())
	}

	verify := httptest.NewRecorder()
	handler.ServeHTTP(verify, httptest.NewRequest(http.MethodGet, "/v1/financial-model", nil))
	var after struct {
		Model json.RawMessage `json:"model"`
	}
	if err := json.Unmarshal(verify.Body.Bytes(), &after); err != nil {
		t.Fatalf("decode verify response: %v", err)
	}
	if string(after.Model) != string(payload.Model) {
		t.Fatalf("rejected write changed stored model")
	}
}

func TestRowWriteReturnsRevision(t *testing.T) {
	database := openAPIStore(t)
	if _, err := testseed.Seed(database,
		filepath.Join(apiProjectRoot(t), "public", "configs"),
	); err != nil {
		t.Fatalf("seed store: %v", err)
	}
	handler := New(database, Config{})

	post := httptest.NewRecorder()
	request := httptest.NewRequest(http.MethodPost, "/v1/accounts", bytes.NewReader([]byte(`{"name":"Probe","kind":"cash","enabled":true}`)))
	request.Header.Set("Content-Type", "application/json")
	handler.ServeHTTP(post, request)
	if post.Code != http.StatusOK {
		t.Fatalf("POST status = %d, body %s", post.Code, post.Body.String())
	}
	var created struct {
		Row struct {
			ID string `json:"id"`
		} `json:"row"`
		Persisted bool   `json:"persisted"`
		Revision  string `json:"revision"`
	}
	if err := json.Unmarshal(post.Body.Bytes(), &created); err != nil {
		t.Fatalf("decode POST response: %v", err)
	}
	if !created.Persisted || created.Row.ID == "" || created.Revision == "" {
		t.Fatalf("create response = %+v", created)
	}
	afterGet := httptest.NewRecorder()
	handler.ServeHTTP(afterGet, httptest.NewRequest(http.MethodGet, "/v1/financial-model", nil))
	var afterPayload struct {
		Revision string `json:"revision"`
	}
	if err := json.Unmarshal(afterGet.Body.Bytes(), &afterPayload); err != nil {
		t.Fatalf("decode GET response: %v", err)
	}
	if created.Revision != afterPayload.Revision {
		t.Fatalf("revision = %q, persisted revision = %q", created.Revision, afterPayload.Revision)
	}
}

func TestRowWriteRejectsInvalidRow(t *testing.T) {
	database := openAPIStore(t)
	if _, err := testseed.Seed(database,
		filepath.Join(apiProjectRoot(t), "public", "configs"),
	); err != nil {
		t.Fatalf("seed store: %v", err)
	}
	handler := New(database, Config{})

	before := httptest.NewRecorder()
	handler.ServeHTTP(before, httptest.NewRequest(http.MethodGet, "/v1/financial-model", nil))
	var beforePayload struct {
		Model json.RawMessage `json:"model"`
	}
	if err := json.Unmarshal(before.Body.Bytes(), &beforePayload); err != nil {
		t.Fatalf("decode GET response: %v", err)
	}

	// A checkpoint for an unknown account fails validation: nothing persists.
	post := httptest.NewRecorder()
	request := httptest.NewRequest(http.MethodPost, "/v1/checkpoints", bytes.NewReader([]byte(`{"accountId":"ghost","balance":10,"observedAt":1785974399}`)))
	request.Header.Set("Content-Type", "application/json")
	handler.ServeHTTP(post, request)
	if post.Code != http.StatusOK {
		t.Fatalf("POST status = %d, body %s", post.Code, post.Body.String())
	}
	var rejected struct {
		Issues    []types.ModelValidationIssue `json:"issues"`
		Persisted bool                         `json:"persisted"`
	}
	if err := json.Unmarshal(post.Body.Bytes(), &rejected); err != nil {
		t.Fatalf("decode POST response: %v", err)
	}
	if rejected.Persisted || len(rejected.Issues) == 0 {
		t.Fatalf("invalid write response = %+v", rejected)
	}

	after := httptest.NewRecorder()
	handler.ServeHTTP(after, httptest.NewRequest(http.MethodGet, "/v1/financial-model", nil))
	var afterPayload struct {
		Model json.RawMessage `json:"model"`
	}
	if err := json.Unmarshal(after.Body.Bytes(), &afterPayload); err != nil {
		t.Fatalf("decode verify response: %v", err)
	}
	if string(afterPayload.Model) != string(beforePayload.Model) {
		t.Fatalf("rejected write changed stored model")
	}
}

func TestRowWriteNotFoundAndConflict(t *testing.T) {
	database := openAPIStore(t)
	handler := New(database, Config{})

	patch := httptest.NewRecorder()
	request := httptest.NewRequest(http.MethodPatch, "/v1/accounts/missing", bytes.NewReader([]byte(`{"id":"missing","name":"Missing","kind":"cash","enabled":true}`)))
	request.Header.Set("Content-Type", "application/json")
	handler.ServeHTTP(patch, request)
	if patch.Code != http.StatusNotFound {
		t.Fatalf("PATCH missing status = %d, want 404, body %s", patch.Code, patch.Body.String())
	}

	first := httptest.NewRecorder()
	create := httptest.NewRequest(http.MethodPost, "/v1/accounts", bytes.NewReader([]byte(`{"id":"probe","name":"Probe","kind":"cash","enabled":true}`)))
	create.Header.Set("Content-Type", "application/json")
	handler.ServeHTTP(first, create)
	if first.Code != http.StatusOK {
		t.Fatalf("first POST status = %d, body %s", first.Code, first.Body.String())
	}
	second := httptest.NewRecorder()
	duplicate := httptest.NewRequest(http.MethodPost, "/v1/accounts", bytes.NewReader([]byte(`{"id":"probe","name":"Probe","kind":"cash","enabled":true}`)))
	duplicate.Header.Set("Content-Type", "application/json")
	handler.ServeHTTP(second, duplicate)
	if second.Code != http.StatusConflict {
		t.Fatalf("duplicate POST status = %d, want 409, body %s", second.Code, second.Body.String())
	}
}

func TestRowWriteIgnoresEchoedSourceField(t *testing.T) {
	database := openAPIStore(t)
	handler := New(database, Config{})

	account := httptest.NewRecorder()
	accountRequest := httptest.NewRequest(http.MethodPost, "/v1/accounts", bytes.NewReader([]byte(
		`{"id":"checking","name":"Checking","kind":"cash","enabled":true}`,
	)))
	accountRequest.Header.Set("Content-Type", "application/json")
	handler.ServeHTTP(account, accountRequest)
	if account.Code != http.StatusOK {
		t.Fatalf("account status = %d, body %s", account.Code, account.Body.String())
	}

	// Frontend drafts echo stored rows verbatim, including the
	// server-computed source flag. Writes must accept and ignore it.
	post := httptest.NewRecorder()
	request := httptest.NewRequest(http.MethodPost, "/v1/postings", bytes.NewReader([]byte(
		`{"id":"01900000-0000-7000-8000-000000000023","name":"Echo","destinations":["checking"],"amount":{"resolver":"expression","config":{"expression":"10"},"inputs":{}},"postedTime":1785542400,"transactionTime":1785542400,"enabled":true,"source":"simplefin","pending":true,"claim":null}`,
	)))
	request.Header.Set("Content-Type", "application/json")
	handler.ServeHTTP(post, request)
	if post.Code != http.StatusOK {
		t.Fatalf("POST status = %d, body %s", post.Code, post.Body.String())
	}
	var created struct {
		Row struct {
			Source  string `json:"source"`
			Pending bool   `json:"pending"`
		} `json:"row"`
		Persisted bool `json:"persisted"`
	}
	if err := json.Unmarshal(post.Body.Bytes(), &created); err != nil {
		t.Fatalf("decode POST response: %v", err)
	}
	if !created.Persisted || created.Row.Source != "user" || created.Row.Pending {
		t.Fatalf("echoed source response = %+v", created)
	}
}

func TestRowDeleteAccountWithDependentsIsRejected(t *testing.T) {
	database := openAPIStore(t)
	if _, err := testseed.Seed(database,
		filepath.Join(apiProjectRoot(t), "public", "configs"),
	); err != nil {
		t.Fatalf("seed store: %v", err)
	}
	handler := New(database, Config{})

	deleted := httptest.NewRecorder()
	handler.ServeHTTP(deleted, httptest.NewRequest(http.MethodDelete, "/v1/accounts/checking", nil))
	if deleted.Code != http.StatusOK {
		t.Fatalf("DELETE status = %d, body %s", deleted.Code, deleted.Body.String())
	}
	var payload struct {
		Issues    []types.ModelValidationIssue `json:"issues"`
		Persisted bool                         `json:"persisted"`
	}
	if err := json.Unmarshal(deleted.Body.Bytes(), &payload); err != nil {
		t.Fatalf("decode DELETE response: %v", err)
	}
	if payload.Persisted || len(payload.Issues) == 0 {
		t.Fatalf("dangling delete response = %+v", payload)
	}
	loaded, err := database.LoadModel()
	if err != nil {
		t.Fatalf("load: %v", err)
	}
	found := false
	for _, account := range loaded.Accounts {
		if account.ID == "checking" {
			found = true
		}
	}
	if !found {
		t.Fatal("referenced account was deleted")
	}
}

func TestDeterministicResponseIncludesTransactionEvents(t *testing.T) {
	fixturePath := filepath.Join(apiProjectRoot(t), "backend", "testdata", "golden", "checkpoints.json")
	fixtureBytes, err := os.ReadFile(fixturePath)
	if err != nil {
		t.Fatalf("read projection fixture: %v", err)
	}
	var fixture struct {
		Model    *types.FinancialModel           `json:"model"`
		Settings types.ProjectionRuntimeSettings `json:"settings"`
	}
	if err := json.Unmarshal(fixtureBytes, &fixture); err != nil {
		t.Fatalf("decode projection fixture: %v", err)
	}
	if fixture.Model == nil {
		t.Fatal("projection fixture has no model")
	}

	body, err := json.Marshal(projectionRequestBody{
		Model:    fixture.Model,
		Settings: fixture.Settings,
		Range:    fullSpanRange(),
	})
	if err != nil {
		t.Fatalf("encode projection request: %v", err)
	}
	database := openAPIStore(t)
	handler := New(database, Config{})
	response := httptest.NewRecorder()
	request := httptest.NewRequest(http.MethodPost, "/v1/projections/deterministic", bytes.NewReader(body))
	request.Header.Set("Content-Type", "application/json")
	handler.ServeHTTP(response, request)
	if response.Code != http.StatusOK {
		t.Fatalf("projection status = %d, body %s", response.Code, response.Body.String())
	}

	var payload struct {
		Result *types.ProjectionResult `json:"result"`
	}
	if err := json.Unmarshal(response.Body.Bytes(), &payload); err != nil {
		t.Fatalf("decode projection response: %v", err)
	}
	if payload.Result == nil || len(payload.Result.TransactionEvents) != 4 {
		t.Fatalf("transaction events = %+v", payload.Result)
	}
	event := payload.Result.TransactionEvents[0]
	if event.Date != "2026-02-05" || event.RequestedAmount != 1000 || event.RealizedAmount != 1000 {
		t.Fatalf("transaction event amounts/date = %+v", event)
	}
	if event.Origin.Type != "posting" || event.Origin.PostingID != "salary" {
		t.Fatalf("transaction event origin = %+v", event.Origin)
	}
	if len(event.AccountDeltas) != 1 || event.AccountDeltas[0].AccountID != "checking" || event.AccountDeltas[0].Delta != 1000 {
		t.Fatalf("transaction event account deltas = %+v", event.AccountDeltas)
	}
	if event.BindingConstraints != nil || event.AvailableAmount != nil {
		t.Fatalf("fully funded transaction evidence = constraints %+v available %v", event.BindingConstraints, event.AvailableAmount)
	}

	storedResponse := httptest.NewRecorder()
	storedRequest := httptest.NewRequest(http.MethodPost, "/v1/projections/deterministic", bytes.NewReader(body))
	storedRequest.Header.Set("Content-Type", "application/json")
	handler.ServeHTTP(storedResponse, storedRequest)
	if storedResponse.Code != http.StatusOK || storedResponse.Header().Get("Projection-Source") != projectionSourceStored {
		t.Fatalf("stored projection status = %d, source = %q, body %s", storedResponse.Code, storedResponse.Header().Get("Projection-Source"), storedResponse.Body.String())
	}
	var storedPayload struct {
		Result *types.ProjectionResult `json:"result"`
	}
	if err := json.Unmarshal(storedResponse.Body.Bytes(), &storedPayload); err != nil {
		t.Fatalf("decode stored projection response: %v", err)
	}
	if storedPayload.Result == nil || len(storedPayload.Result.TransactionEvents) != len(payload.Result.TransactionEvents) {
		t.Fatalf("stored transaction events = %+v", storedPayload.Result)
	}
}

func TestDeterministicTransactionEvidenceIncludesBindingConstraints(t *testing.T) {
	fixturePath := filepath.Join(apiProjectRoot(t), "backend", "testdata", "golden", "checkpoints.json")
	fixtureBytes, err := os.ReadFile(fixturePath)
	if err != nil {
		t.Fatalf("read projection fixture: %v", err)
	}
	var fixture struct {
		Model    *types.FinancialModel           `json:"model"`
		Settings types.ProjectionRuntimeSettings `json:"settings"`
	}
	if err := json.Unmarshal(fixtureBytes, &fixture); err != nil {
		t.Fatalf("decode projection fixture: %v", err)
	}
	if fixture.Model == nil {
		t.Fatal("projection fixture has no model")
	}
	floor := 2400.0
	for index := range fixture.Model.Accounts {
		if fixture.Model.Accounts[index].ID == "checking" {
			fixture.Model.Accounts[index].MinBalance = &floor
		}
	}
	for index := range fixture.Model.Postings {
		if fixture.Model.Postings[index].ID == "spend" {
			fixture.Model.Postings[index].Amount.Config = map[string]any{"expression": "200.49"}
		}
	}
	body, err := json.Marshal(projectionRequestBody{Model: fixture.Model, Settings: fixture.Settings, Range: fullSpanRange()})
	if err != nil {
		t.Fatalf("encode projection request: %v", err)
	}
	database := openAPIStore(t)
	handler := New(database, Config{})
	response := httptest.NewRecorder()
	request := httptest.NewRequest(http.MethodPost, "/v1/projections/deterministic", bytes.NewReader(body))
	request.Header.Set("Content-Type", "application/json")
	handler.ServeHTTP(response, request)
	if response.Code != http.StatusOK {
		t.Fatalf("projection status = %d, body %s", response.Code, response.Body.String())
	}
	var payload struct {
		Result *types.ProjectionResult `json:"result"`
	}
	if err := json.Unmarshal(response.Body.Bytes(), &payload); err != nil {
		t.Fatalf("decode projection response: %v", err)
	}
	if payload.Result == nil || len(payload.Result.TransactionEvents) != 4 {
		t.Fatalf("transaction events = %+v", payload.Result)
	}
	event := payload.Result.TransactionEvents[1]
	if event.RequestedAmount != 200 || event.RealizedAmount != 100 || event.AvailableAmount == nil || *event.AvailableAmount != 100 {
		t.Fatalf("rounded transaction amounts = %+v", event)
	}
	if len(event.AccountDeltas) != 1 || event.AccountDeltas[0].Delta != -100 {
		t.Fatalf("rounded transaction account deltas = %+v", event.AccountDeltas)
	}
	if len(event.BindingConstraints) != 1 {
		t.Fatalf("binding constraints = %+v", event.BindingConstraints)
	}
	constraint, ok := event.BindingConstraints[0].(map[string]any)
	if !ok || constraint["type"] != "source-floor" || constraint["accountId"] != "checking" {
		t.Fatalf("binding constraint = %+v", event.BindingConstraints[0])
	}

	storedResponse := httptest.NewRecorder()
	storedRequest := httptest.NewRequest(http.MethodPost, "/v1/projections/deterministic", bytes.NewReader(body))
	storedRequest.Header.Set("Content-Type", "application/json")
	handler.ServeHTTP(storedResponse, storedRequest)
	if storedResponse.Code != http.StatusOK || storedResponse.Header().Get("Projection-Source") != projectionSourceStored {
		t.Fatalf("stored projection status = %d, source = %q, body %s", storedResponse.Code, storedResponse.Header().Get("Projection-Source"), storedResponse.Body.String())
	}
	var storedPayload struct {
		Result *types.ProjectionResult `json:"result"`
	}
	if err := json.Unmarshal(storedResponse.Body.Bytes(), &storedPayload); err != nil {
		t.Fatalf("decode stored projection response: %v", err)
	}
	if storedPayload.Result == nil {
		t.Fatal("stored projection has no result")
	}
	computedEvents, err := json.Marshal(payload.Result.TransactionEvents)
	if err != nil {
		t.Fatalf("encode computed transaction events: %v", err)
	}
	storedEvents, err := json.Marshal(storedPayload.Result.TransactionEvents)
	if err != nil {
		t.Fatalf("encode stored transaction events: %v", err)
	}
	if !bytes.Equal(storedEvents, computedEvents) {
		t.Fatalf("stored transaction evidence differs from computed response")
	}
}

func TestDeterministicTransactionEvidenceReportsAnnualCapAvailability(t *testing.T) {
	fixturePath := filepath.Join(apiProjectRoot(t), "backend", "testdata", "golden", "checkpoints.json")
	fixtureBytes, err := os.ReadFile(fixturePath)
	if err != nil {
		t.Fatalf("read projection fixture: %v", err)
	}
	var fixture struct {
		Model    *types.FinancialModel           `json:"model"`
		Settings types.ProjectionRuntimeSettings `json:"settings"`
	}
	if err := json.Unmarshal(fixtureBytes, &fixture); err != nil {
		t.Fatalf("decode projection fixture: %v", err)
	}
	cap := 500.0
	for index := range fixture.Model.RecurrenceRules {
		if fixture.Model.RecurrenceRules[index].ID == "invest" {
			fixture.Model.RecurrenceRules[index].AnnualCap = &cap
		}
	}
	body, err := json.Marshal(projectionRequestBody{Model: fixture.Model, Settings: fixture.Settings, Range: fullSpanRange()})
	if err != nil {
		t.Fatalf("encode projection request: %v", err)
	}
	database := openAPIStore(t)
	handler := New(database, Config{})
	response := httptest.NewRecorder()
	request := httptest.NewRequest(http.MethodPost, "/v1/projections/deterministic", bytes.NewReader(body))
	request.Header.Set("Content-Type", "application/json")
	handler.ServeHTTP(response, request)
	if response.Code != http.StatusOK {
		t.Fatalf("projection status = %d, body %s", response.Code, response.Body.String())
	}
	var payload struct {
		Result *types.ProjectionResult `json:"result"`
	}
	if err := json.Unmarshal(response.Body.Bytes(), &payload); err != nil {
		t.Fatalf("decode projection response: %v", err)
	}
	for _, event := range payload.Result.TransactionEvents {
		if event.Origin.PostingID != "invest" {
			continue
		}
		if event.RealizedAmount != 500 || event.AvailableAmount == nil || *event.AvailableAmount != 500 {
			t.Fatalf("annual-cap transaction evidence = %+v", event)
		}
		return
	}
	t.Fatal("investment transaction was not returned")
}

func TestDeterministicTransactionEvidenceCarriesHistoricalAnnualCapUsage(t *testing.T) {
	fixturePath := filepath.Join(apiProjectRoot(t), "backend", "testdata", "golden", "checkpoints.json")
	fixtureBytes, err := os.ReadFile(fixturePath)
	if err != nil {
		t.Fatalf("read projection fixture: %v", err)
	}
	var fixture struct {
		Model    *types.FinancialModel           `json:"model"`
		Settings types.ProjectionRuntimeSettings `json:"settings"`
	}
	if err := json.Unmarshal(fixtureBytes, &fixture); err != nil {
		t.Fatalf("decode projection fixture: %v", err)
	}
	cap := 500.0
	endDate := types.IsoDate("2026-03-31")
	for index := range fixture.Model.RecurrenceRules {
		if fixture.Model.RecurrenceRules[index].ID == "invest" {
			fixture.Model.RecurrenceRules[index].StartDate = "2026-01-31"
			fixture.Model.RecurrenceRules[index].EndDate = &endDate
			fixture.Model.RecurrenceRules[index].AnnualCap = &cap
		}
	}
	body, err := json.Marshal(projectionRequestBody{Model: fixture.Model, Settings: fixture.Settings, Range: fullSpanRange()})
	if err != nil {
		t.Fatalf("encode projection request: %v", err)
	}
	database := openAPIStore(t)
	handler := New(database, Config{})
	response := httptest.NewRecorder()
	request := httptest.NewRequest(http.MethodPost, "/v1/projections/deterministic", bytes.NewReader(body))
	request.Header.Set("Content-Type", "application/json")
	handler.ServeHTTP(response, request)
	if response.Code != http.StatusOK {
		t.Fatalf("projection status = %d, body %s", response.Code, response.Body.String())
	}
	var payload struct {
		Result *types.ProjectionResult `json:"result"`
	}
	if err := json.Unmarshal(response.Body.Bytes(), &payload); err != nil {
		t.Fatalf("decode projection response: %v", err)
	}
	for _, event := range payload.Result.TransactionEvents {
		if event.Origin.PostingID != "invest" || event.Date <= fixture.Settings.FallbackProjectionStartDate {
			continue
		}
		if event.RealizedAmount != 0 || event.AvailableAmount == nil || *event.AvailableAmount != 0 {
			t.Fatalf("historical annual-cap evidence = %+v", event)
		}
		return
	}
	t.Fatal("post-start investment transaction was not returned")
}

func TestDeterministicTransactionEvidenceReportsDestinationHeadroom(t *testing.T) {
	fixturePath := filepath.Join(apiProjectRoot(t), "backend", "testdata", "golden", "checkpoints.json")
	fixtureBytes, err := os.ReadFile(fixturePath)
	if err != nil {
		t.Fatalf("read projection fixture: %v", err)
	}
	var fixture struct {
		Model    *types.FinancialModel           `json:"model"`
		Settings types.ProjectionRuntimeSettings `json:"settings"`
	}
	if err := json.Unmarshal(fixtureBytes, &fixture); err != nil {
		t.Fatalf("decode projection fixture: %v", err)
	}
	if fixture.Model == nil {
		t.Fatal("projection fixture has no model")
	}
	ceiling := 0.0
	for index := range fixture.Model.Accounts {
		if fixture.Model.Accounts[index].ID == "loan" {
			fixture.Model.Accounts[index].MaxBalance = &ceiling
		}
	}
	for index := range fixture.Model.RecurrenceRules {
		if fixture.Model.RecurrenceRules[index].ID == "paydown" {
			fixture.Model.RecurrenceRules[index].Amount.Config = map[string]any{"expression": "711"}
			fixture.Model.RecurrenceRules[index].Amount.Inputs = map[string]types.AmountInputBinding{}
		}
	}
	body, err := json.Marshal(projectionRequestBody{Model: fixture.Model, Settings: fixture.Settings, Range: fullSpanRange()})
	if err != nil {
		t.Fatalf("encode projection request: %v", err)
	}
	database := openAPIStore(t)
	handler := New(database, Config{})
	response := httptest.NewRecorder()
	request := httptest.NewRequest(http.MethodPost, "/v1/projections/deterministic", bytes.NewReader(body))
	request.Header.Set("Content-Type", "application/json")
	handler.ServeHTTP(response, request)
	if response.Code != http.StatusOK {
		t.Fatalf("projection status = %d, body %s", response.Code, response.Body.String())
	}
	var payload struct {
		Result *types.ProjectionResult `json:"result"`
	}
	if err := json.Unmarshal(response.Body.Bytes(), &payload); err != nil {
		t.Fatalf("decode projection response: %v", err)
	}
	for _, event := range payload.Result.TransactionEvents {
		if event.Origin.PostingID != "paydown" {
			continue
		}
		if event.RealizedAmount >= event.RequestedAmount {
			t.Fatalf("paydown was not destination-capped = %+v", event)
		}
		foundCeiling := false
		for _, constraint := range event.BindingConstraints {
			if constraintMap, ok := constraint.(map[string]any); ok && constraintMap["type"] == "destination-ceiling" {
				foundCeiling = true
			}
		}
		if !foundCeiling {
			t.Fatalf("paydown binding constraints = %+v", event.BindingConstraints)
		}
		if event.AvailableAmount == nil {
			t.Fatalf("destination-capped transaction has no available amount = %+v", event)
		}
		if *event.AvailableAmount != event.RealizedAmount {
			t.Fatalf("destination available %v != realized %v", *event.AvailableAmount, event.RealizedAmount)
		}
		if math.Abs(*event.AvailableAmount) >= 1e12 {
			t.Fatalf("destination available carries a bound sentinel: %v", *event.AvailableAmount)
		}
		return
	}
	t.Fatal("paydown transaction was not returned")
}

func TestDeterministicTransactionEvidenceRoundsPayrollFields(t *testing.T) {
	fixturePath := filepath.Join(apiProjectRoot(t), "backend", "testdata", "golden", "payroll.json")
	fixtureBytes, err := os.ReadFile(fixturePath)
	if err != nil {
		t.Fatalf("read payroll projection fixture: %v", err)
	}
	var fixture struct {
		Model    *types.FinancialModel           `json:"model"`
		Settings types.ProjectionRuntimeSettings `json:"settings"`
	}
	if err := json.Unmarshal(fixtureBytes, &fixture); err != nil {
		t.Fatalf("decode payroll projection fixture: %v", err)
	}
	if fixture.Model == nil {
		t.Fatal("payroll projection fixture is incomplete")
	}
	fixture.Settings.HorizonYears = 1
	body, err := json.Marshal(projectionRequestBody{Model: fixture.Model, Settings: fixture.Settings, Range: fullSpanRange()})
	if err != nil {
		t.Fatalf("encode payroll projection request: %v", err)
	}
	database := openAPIStore(t)
	handler := New(database, Config{})
	response := httptest.NewRecorder()
	request := httptest.NewRequest(http.MethodPost, "/v1/projections/deterministic", bytes.NewReader(body))
	request.Header.Set("Content-Type", "application/json")
	handler.ServeHTTP(response, request)
	if response.Code != http.StatusOK {
		t.Fatalf("payroll projection status = %d, body %s", response.Code, response.Body.String())
	}
	var payload struct {
		Result *types.ProjectionResult `json:"result"`
	}
	if err := json.Unmarshal(response.Body.Bytes(), &payload); err != nil {
		t.Fatalf("decode payroll projection response: %v", err)
	}
	if payload.Result == nil || len(payload.Result.TransactionEvents) == 0 {
		t.Fatalf("payroll transaction events = %+v", payload.Result)
	}
	for _, event := range payload.Result.TransactionEvents {
		for _, delta := range event.AccountDeltas {
			if delta.Delta != math.Trunc(delta.Delta) {
				t.Fatalf("public transaction amount is not rounded: %v", delta.Delta)
			}
		}
		if event.RequestedAmount != math.Trunc(event.RequestedAmount) {
			t.Fatalf("public requested amount is not rounded: %v", event.RequestedAmount)
		}
		if event.RealizedAmount != math.Trunc(event.RealizedAmount) {
			t.Fatalf("public realized amount is not rounded: %v", event.RealizedAmount)
		}
	}
}
