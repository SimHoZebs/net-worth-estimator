package api

import (
	"bytes"
	"encoding/json"
	"math"
	"net/http"
	"net/http/httptest"
	"os"
	"path/filepath"
	"testing"

	"github.com/simhozebs/net-worth-estimator/backend/internal/store"
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
		Document *types.FinancialModelDocument `json:"document"`
		Issues   []types.ModelValidationIssue  `json:"issues"`
	}
	if err := json.Unmarshal(response.Body.Bytes(), &payload); err != nil {
		t.Fatalf("decode GET response: %v", err)
	}
	if payload.Document != nil || payload.Issues == nil {
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
			ReadOnly    bool `json:"readOnly"`
			AuthEnabled bool `json:"authEnabled"`
		}
		if err := json.Unmarshal(response.Body.Bytes(), &payload); err != nil {
			t.Fatalf("decode status response: %v", err)
		}
		if payload.ReadOnly != readOnly || payload.AuthEnabled {
			t.Fatalf("readOnly=%v status = %+v", readOnly, payload)
		}
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
		Document *types.FinancialModelDocument `json:"document"`
		Issues   []types.ModelValidationIssue  `json:"issues"`
	}
	if err := json.Unmarshal(get.Body.Bytes(), &after); err != nil {
		t.Fatalf("decode GET response: %v", err)
	}
	if after.Document != nil {
		t.Fatalf("stored document changed: %+v", after.Document)
	}
}

func TestReadOnlyRejectsRowWrites(t *testing.T) {
	database := openAPIStore(t)
	root := apiProjectRoot(t)
	if _, _, err := database.ImportCSV(
		filepath.Join(root, "public", "configs"),
		filepath.Join(root, "public", "data", "income"),
	); err != nil {
		t.Fatalf("seed store: %v", err)
	}
	handler := New(database, Config{ReadOnly: true})

	get := httptest.NewRecorder()
	handler.ServeHTTP(get, httptest.NewRequest(http.MethodGet, "/v1/financial-model", nil))
	var payload struct {
		Document json.RawMessage `json:"document"`
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
		Document json.RawMessage `json:"document"`
	}
	if err := json.Unmarshal(verify.Body.Bytes(), &after); err != nil {
		t.Fatalf("decode verify response: %v", err)
	}
	if string(after.Document) != string(payload.Document) {
		t.Fatalf("rejected write changed stored document")
	}
}

func TestRowWriteReturnsRevision(t *testing.T) {
	database := openAPIStore(t)
	if _, _, err := database.ImportCSV(
		filepath.Join(apiProjectRoot(t), "public", "configs"),
		filepath.Join(apiProjectRoot(t), "public", "data", "income"),
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
	if created.Revision != afterGet.Header().Get("ETag") {
		t.Fatalf("revision = %q, persisted ETag = %q", created.Revision, afterGet.Header().Get("ETag"))
	}
}

func TestRowWriteRejectsInvalidRow(t *testing.T) {
	database := openAPIStore(t)
	if _, _, err := database.ImportCSV(
		filepath.Join(apiProjectRoot(t), "public", "configs"),
		filepath.Join(apiProjectRoot(t), "public", "data", "income"),
	); err != nil {
		t.Fatalf("seed store: %v", err)
	}
	handler := New(database, Config{})

	before := httptest.NewRecorder()
	handler.ServeHTTP(before, httptest.NewRequest(http.MethodGet, "/v1/financial-model", nil))
	var beforePayload struct {
		Document json.RawMessage `json:"document"`
	}
	if err := json.Unmarshal(before.Body.Bytes(), &beforePayload); err != nil {
		t.Fatalf("decode GET response: %v", err)
	}

	// A checkpoint for an unknown account fails validation: nothing persists.
	post := httptest.NewRecorder()
	request := httptest.NewRequest(http.MethodPost, "/v1/checkpoints", bytes.NewReader([]byte(`{"date":"2026-08-05","accountId":"ghost","balance":10}`)))
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
		Document json.RawMessage `json:"document"`
	}
	if err := json.Unmarshal(after.Body.Bytes(), &afterPayload); err != nil {
		t.Fatalf("decode verify response: %v", err)
	}
	if string(afterPayload.Document) != string(beforePayload.Document) {
		t.Fatalf("rejected write changed stored document")
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
		`{"id":"echo","name":"Echo","destinations":["checking"],"amount":{"resolver":"expression","config":{"expression":"10"},"inputs":{}},"date":"2026-08-01","priority":1,"enabled":true,"source":"model","claim":null}`,
	)))
	request.Header.Set("Content-Type", "application/json")
	handler.ServeHTTP(post, request)
	if post.Code != http.StatusOK {
		t.Fatalf("POST status = %d, body %s", post.Code, post.Body.String())
	}
	var created struct {
		Row struct {
			Source string `json:"source"`
		} `json:"row"`
		Persisted bool `json:"persisted"`
	}
	if err := json.Unmarshal(post.Body.Bytes(), &created); err != nil {
		t.Fatalf("decode POST response: %v", err)
	}
	if !created.Persisted || created.Row.Source != "model" {
		t.Fatalf("echoed source response = %+v", created)
	}
}

func TestRowDeleteAccountWithDependentsIsRejected(t *testing.T) {
	database := openAPIStore(t)
	if _, _, err := database.ImportCSV(
		filepath.Join(apiProjectRoot(t), "public", "configs"),
		filepath.Join(apiProjectRoot(t), "public", "data", "income"),
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
	loaded, err := database.LoadDocument()
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

func TestDeterministicResponseIncludesMovementEvents(t *testing.T) {
	fixturePath := filepath.Join(apiProjectRoot(t), "backend", "testdata", "golden", "checkpoints.json")
	fixtureBytes, err := os.ReadFile(fixturePath)
	if err != nil {
		t.Fatalf("read projection fixture: %v", err)
	}
	var fixture struct {
		Document *types.FinancialModelDocument   `json:"document"`
		Settings types.ProjectionRuntimeSettings `json:"settings"`
	}
	if err := json.Unmarshal(fixtureBytes, &fixture); err != nil {
		t.Fatalf("decode projection fixture: %v", err)
	}
	if fixture.Document == nil {
		t.Fatal("projection fixture has no document")
	}

	body, err := json.Marshal(projectionRequestBody{
		Document: fixture.Document,
		Settings: fixture.Settings,
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
	if payload.Result == nil || len(payload.Result.MovementEvents) != 4 {
		t.Fatalf("movement events = %+v", payload.Result)
	}
	event := payload.Result.MovementEvents[0]
	if event.Date != "2026-02-05" || event.RequestedAmount != 1000 || event.RealizedAmount != 1000 {
		t.Fatalf("movement event amounts/date = %+v", event)
	}
	if event.Origin.Type != "posting" || event.Origin.PostingID != "salary" {
		t.Fatalf("movement event origin = %+v", event.Origin)
	}
	if len(event.AccountDeltas) != 1 || event.AccountDeltas[0].AccountID != "checking" || event.AccountDeltas[0].Delta != 1000 {
		t.Fatalf("movement event account deltas = %+v", event.AccountDeltas)
	}
	if event.BindingConstraints != nil || event.AvailableAmount != nil {
		t.Fatalf("fully funded movement evidence = constraints %+v available %v", event.BindingConstraints, event.AvailableAmount)
	}

	cachedResponse := httptest.NewRecorder()
	cachedRequest := httptest.NewRequest(http.MethodPost, "/v1/projections/deterministic", bytes.NewReader(body))
	cachedRequest.Header.Set("Content-Type", "application/json")
	handler.ServeHTTP(cachedResponse, cachedRequest)
	if cachedResponse.Code != http.StatusOK || cachedResponse.Header().Get("X-Cache") != "hit" {
		t.Fatalf("cached projection status = %d, cache = %q, body %s", cachedResponse.Code, cachedResponse.Header().Get("X-Cache"), cachedResponse.Body.String())
	}
	var cachedPayload struct {
		Result *types.ProjectionResult `json:"result"`
	}
	if err := json.Unmarshal(cachedResponse.Body.Bytes(), &cachedPayload); err != nil {
		t.Fatalf("decode cached projection response: %v", err)
	}
	if cachedPayload.Result == nil || len(cachedPayload.Result.MovementEvents) != len(payload.Result.MovementEvents) {
		t.Fatalf("cached movement events = %+v", cachedPayload.Result)
	}
}

func TestDeterministicMovementEvidenceIncludesBindingConstraints(t *testing.T) {
	fixturePath := filepath.Join(apiProjectRoot(t), "backend", "testdata", "golden", "checkpoints.json")
	fixtureBytes, err := os.ReadFile(fixturePath)
	if err != nil {
		t.Fatalf("read projection fixture: %v", err)
	}
	var fixture struct {
		Document *types.FinancialModelDocument   `json:"document"`
		Settings types.ProjectionRuntimeSettings `json:"settings"`
	}
	if err := json.Unmarshal(fixtureBytes, &fixture); err != nil {
		t.Fatalf("decode projection fixture: %v", err)
	}
	if fixture.Document == nil {
		t.Fatal("projection fixture has no document")
	}
	floor := 2400.0
	for index := range fixture.Document.Accounts {
		if fixture.Document.Accounts[index].ID == "checking" {
			fixture.Document.Accounts[index].MinBalance = &floor
		}
	}
	for index := range fixture.Document.Postings {
		if fixture.Document.Postings[index].ID == "spend" {
			fixture.Document.Postings[index].Amount.Config = map[string]any{"expression": "200.49"}
		}
	}
	body, err := json.Marshal(projectionRequestBody{Document: fixture.Document, Settings: fixture.Settings})
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
	if payload.Result == nil || len(payload.Result.MovementEvents) != 4 {
		t.Fatalf("movement events = %+v", payload.Result)
	}
	event := payload.Result.MovementEvents[1]
	if event.RequestedAmount != 200 || event.RealizedAmount != 100 || event.AvailableAmount == nil || *event.AvailableAmount != 100 {
		t.Fatalf("rounded movement amounts = %+v", event)
	}
	if len(event.AccountDeltas) != 1 || event.AccountDeltas[0].Delta != -100 {
		t.Fatalf("rounded movement account deltas = %+v", event.AccountDeltas)
	}
	if len(event.BindingConstraints) != 1 {
		t.Fatalf("binding constraints = %+v", event.BindingConstraints)
	}
	constraint, ok := event.BindingConstraints[0].(map[string]any)
	if !ok || constraint["type"] != "source-floor" || constraint["accountId"] != "checking" {
		t.Fatalf("binding constraint = %+v", event.BindingConstraints[0])
	}

	cachedResponse := httptest.NewRecorder()
	cachedRequest := httptest.NewRequest(http.MethodPost, "/v1/projections/deterministic", bytes.NewReader(body))
	cachedRequest.Header.Set("Content-Type", "application/json")
	handler.ServeHTTP(cachedResponse, cachedRequest)
	if cachedResponse.Code != http.StatusOK || cachedResponse.Header().Get("X-Cache") != "hit" {
		t.Fatalf("cached projection status = %d, cache = %q, body %s", cachedResponse.Code, cachedResponse.Header().Get("X-Cache"), cachedResponse.Body.String())
	}
	var cachedPayload struct {
		Result *types.ProjectionResult `json:"result"`
	}
	if err := json.Unmarshal(cachedResponse.Body.Bytes(), &cachedPayload); err != nil {
		t.Fatalf("decode cached projection response: %v", err)
	}
	if cachedPayload.Result == nil {
		t.Fatal("cached projection has no result")
	}
	computedEvents, err := json.Marshal(payload.Result.MovementEvents)
	if err != nil {
		t.Fatalf("encode computed movement events: %v", err)
	}
	cachedEvents, err := json.Marshal(cachedPayload.Result.MovementEvents)
	if err != nil {
		t.Fatalf("encode cached movement events: %v", err)
	}
	if !bytes.Equal(cachedEvents, computedEvents) {
		t.Fatalf("cached movement evidence differs from computed response")
	}
}

func TestDeterministicMovementEvidenceReportsAnnualCapAvailability(t *testing.T) {
	fixturePath := filepath.Join(apiProjectRoot(t), "backend", "testdata", "golden", "checkpoints.json")
	fixtureBytes, err := os.ReadFile(fixturePath)
	if err != nil {
		t.Fatalf("read projection fixture: %v", err)
	}
	var fixture struct {
		Document *types.FinancialModelDocument   `json:"document"`
		Settings types.ProjectionRuntimeSettings `json:"settings"`
	}
	if err := json.Unmarshal(fixtureBytes, &fixture); err != nil {
		t.Fatalf("decode projection fixture: %v", err)
	}
	cap := 500.0
	for index := range fixture.Document.RecurrenceRules {
		if fixture.Document.RecurrenceRules[index].ID == "invest" {
			fixture.Document.RecurrenceRules[index].AnnualCap = &cap
		}
	}
	body, err := json.Marshal(projectionRequestBody{Document: fixture.Document, Settings: fixture.Settings})
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
	for _, event := range payload.Result.MovementEvents {
		if event.Origin.PostingID != "invest" {
			continue
		}
		if event.RealizedAmount != 500 || event.AvailableAmount == nil || *event.AvailableAmount != 500 {
			t.Fatalf("annual-cap movement evidence = %+v", event)
		}
		return
	}
	t.Fatal("investment movement was not returned")
}

func TestDeterministicMovementEvidenceCarriesHistoricalAnnualCapUsage(t *testing.T) {
	fixturePath := filepath.Join(apiProjectRoot(t), "backend", "testdata", "golden", "checkpoints.json")
	fixtureBytes, err := os.ReadFile(fixturePath)
	if err != nil {
		t.Fatalf("read projection fixture: %v", err)
	}
	var fixture struct {
		Document *types.FinancialModelDocument   `json:"document"`
		Settings types.ProjectionRuntimeSettings `json:"settings"`
	}
	if err := json.Unmarshal(fixtureBytes, &fixture); err != nil {
		t.Fatalf("decode projection fixture: %v", err)
	}
	cap := 500.0
	endDate := types.IsoDate("2026-03-31")
	for index := range fixture.Document.RecurrenceRules {
		if fixture.Document.RecurrenceRules[index].ID == "invest" {
			fixture.Document.RecurrenceRules[index].StartDate = "2026-01-31"
			fixture.Document.RecurrenceRules[index].EndDate = &endDate
			fixture.Document.RecurrenceRules[index].AnnualCap = &cap
		}
	}
	body, err := json.Marshal(projectionRequestBody{Document: fixture.Document, Settings: fixture.Settings})
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
	for _, event := range payload.Result.MovementEvents {
		if event.Origin.PostingID != "invest" || event.Date <= fixture.Settings.FallbackProjectionStartDate {
			continue
		}
		if event.RealizedAmount != 0 || event.AvailableAmount == nil || *event.AvailableAmount != 0 {
			t.Fatalf("historical annual-cap evidence = %+v", event)
		}
		return
	}
	t.Fatal("post-start investment movement was not returned")
}

func TestDeterministicMovementEvidenceReportsDestinationHeadroom(t *testing.T) {
	fixturePath := filepath.Join(apiProjectRoot(t), "backend", "testdata", "golden", "checkpoints.json")
	fixtureBytes, err := os.ReadFile(fixturePath)
	if err != nil {
		t.Fatalf("read projection fixture: %v", err)
	}
	var fixture struct {
		Document *types.FinancialModelDocument   `json:"document"`
		Settings types.ProjectionRuntimeSettings `json:"settings"`
	}
	if err := json.Unmarshal(fixtureBytes, &fixture); err != nil {
		t.Fatalf("decode projection fixture: %v", err)
	}
	if fixture.Document == nil {
		t.Fatal("projection fixture has no document")
	}
	ceiling := 0.0
	for index := range fixture.Document.Accounts {
		if fixture.Document.Accounts[index].ID == "loan" {
			fixture.Document.Accounts[index].MaxBalance = &ceiling
		}
	}
	for index := range fixture.Document.RecurrenceRules {
		if fixture.Document.RecurrenceRules[index].ID == "paydown" {
			fixture.Document.RecurrenceRules[index].Amount.Config = map[string]any{"expression": "711"}
			fixture.Document.RecurrenceRules[index].Amount.Inputs = map[string]types.AmountInputBinding{}
		}
	}
	body, err := json.Marshal(projectionRequestBody{Document: fixture.Document, Settings: fixture.Settings})
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
	for _, event := range payload.Result.MovementEvents {
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
			t.Fatalf("destination-capped movement has no available amount = %+v", event)
		}
		if *event.AvailableAmount != event.RealizedAmount {
			t.Fatalf("destination available %v != realized %v", *event.AvailableAmount, event.RealizedAmount)
		}
		if math.Abs(*event.AvailableAmount) >= 1e12 {
			t.Fatalf("destination available carries a bound sentinel: %v", *event.AvailableAmount)
		}
		return
	}
	t.Fatal("paydown movement was not returned")
}

func TestDeterministicMovementEvidenceRoundsIncomeFields(t *testing.T) {
	fixturePath := filepath.Join(apiProjectRoot(t), "backend", "testdata", "golden", "income.json")
	fixtureBytes, err := os.ReadFile(fixturePath)
	if err != nil {
		t.Fatalf("read income projection fixture: %v", err)
	}
	var fixture struct {
		Document   *types.FinancialModelDocument   `json:"document"`
		Settings   types.ProjectionRuntimeSettings `json:"settings"`
		IncomeData *types.IncomeDataSnapshot       `json:"incomeData"`
	}
	if err := json.Unmarshal(fixtureBytes, &fixture); err != nil {
		t.Fatalf("decode income projection fixture: %v", err)
	}
	if fixture.Document == nil || fixture.IncomeData == nil {
		t.Fatal("income projection fixture is incomplete")
	}
	fixture.Settings.HorizonYears = 1
	body, err := json.Marshal(projectionRequestBody{Document: fixture.Document, Settings: fixture.Settings, IncomeData: fixture.IncomeData})
	if err != nil {
		t.Fatalf("encode income projection request: %v", err)
	}
	database := openAPIStore(t)
	handler := New(database, Config{})
	response := httptest.NewRecorder()
	request := httptest.NewRequest(http.MethodPost, "/v1/projections/deterministic", bytes.NewReader(body))
	request.Header.Set("Content-Type", "application/json")
	handler.ServeHTTP(response, request)
	if response.Code != http.StatusOK {
		t.Fatalf("income projection status = %d, body %s", response.Code, response.Body.String())
	}
	var payload struct {
		Result *types.ProjectionResult `json:"result"`
	}
	if err := json.Unmarshal(response.Body.Bytes(), &payload); err != nil {
		t.Fatalf("decode income projection response: %v", err)
	}
	if payload.Result == nil || len(payload.Result.MovementEvents) == 0 {
		t.Fatalf("income movement events = %+v", payload.Result)
	}
	assertRounded := func(value float64) {
		t.Helper()
		if value != math.Trunc(value) {
			t.Fatalf("public movement amount is not rounded: %v", value)
		}
	}
	for _, event := range payload.Result.MovementEvents {
		if event.Income == nil {
			continue
		}
		assertRounded(event.Income.AnnualGrossIncome)
		assertRounded(event.Income.GrossAmount)
		assertRounded(event.Income.NetCashRequested)
		assertRounded(event.Income.NetCashRealized)
		assertRounded(event.Income.EmployerMatchRequested)
		assertRounded(event.Income.EmployerMatchRealized)
		for _, resolver := range event.Income.Resolvers {
			assertRounded(resolver.RequestedAmount)
			assertRounded(resolver.RealizedAmount)
			assertRounded(resolver.TaxableAmountAfter)
			assertRounded(resolver.EmployerMatchAmount)
			assertRounded(resolver.EmployerMatchRealizedAmount)
		}
	}
}

func writeFrontendTestFile(t *testing.T, root, name, content string) {
	t.Helper()
	filePath := filepath.Join(root, filepath.FromSlash(name))
	if err := os.MkdirAll(filepath.Dir(filePath), 0o755); err != nil {
		t.Fatalf("create frontend test directory: %v", err)
	}
	if err := os.WriteFile(filePath, []byte(content), 0o644); err != nil {
		t.Fatalf("write frontend test file: %v", err)
	}
}

func TestFrontendServingPreservesBackendRoutes(t *testing.T) {
	frontendDir := t.TempDir()
	writeFrontendTestFile(t, frontendDir, "index.html", "frontend index")
	database := openAPIStore(t)
	handler := New(database, Config{FrontendDir: frontendDir})

	for _, test := range []struct {
		path string
		want int
	}{
		{path: "/healthz", want: http.StatusOK},
		{path: "/v1/status", want: http.StatusOK},
		{path: "/docs", want: http.StatusOK},
		{path: "/openapi.json", want: http.StatusOK},
		{path: "/v1/missing", want: http.StatusNotFound},
		{path: "/healthz/missing", want: http.StatusNotFound},
		{path: "/docs/missing", want: http.StatusNotFound},
		{path: "/openapi-static", want: http.StatusNotFound},
		{path: "/schemas/Unknown", want: http.StatusOK},
	} {
		t.Run(test.path, func(t *testing.T) {
			response := httptest.NewRecorder()
			handler.ServeHTTP(response, httptest.NewRequest(http.MethodGet, test.path, nil))
			if response.Code != test.want {
				t.Fatalf("status = %d, want %d, body %s", response.Code, test.want, response.Body.String())
			}
		})
	}
}

func TestFrontendServingServesAssetsAndRejectsTraversal(t *testing.T) {
	baseDir := t.TempDir()
	frontendDir := filepath.Join(baseDir, "frontend")
	writeFrontendTestFile(t, frontendDir, "index.html", "frontend index")
	writeFrontendTestFile(t, frontendDir, "assets/app.js", "export const ready = true;")
	writeFrontendTestFile(t, baseDir, "secret.txt", "secret")
	if err := os.Symlink(filepath.Join("..", "secret.txt"), filepath.Join(frontendDir, "secret-link")); err != nil {
		t.Fatalf("create escaping frontend symlink: %v", err)
	}

	database := openAPIStore(t)
	handler := New(database, Config{FrontendDir: frontendDir})
	wantAsset, err := os.ReadFile(filepath.Join(frontendDir, "assets", "app.js"))
	if err != nil {
		t.Fatalf("read frontend asset fixture: %v", err)
	}
	for _, test := range []struct {
		path   string
		want   int
		asset  bool
		absent bool
	}{
		{path: "/assets/app.js", want: http.StatusOK, asset: true},
		{path: "/missing.js", want: http.StatusNotFound, absent: true},
		{path: "/%2e%2e/secret.txt", want: http.StatusNotFound, absent: true},
		{path: "/secret-link", want: http.StatusNotFound, absent: true},
	} {
		t.Run(test.path, func(t *testing.T) {
			response := httptest.NewRecorder()
			handler.ServeHTTP(response, httptest.NewRequest(http.MethodGet, test.path, nil))
			if response.Code != test.want {
				t.Fatalf("status = %d, want %d, body %s", response.Code, test.want, response.Body.String())
			}
			if test.absent && bytes.Contains(response.Body.Bytes(), []byte("secret")) {
				t.Fatalf("response exposed secret content: %s", response.Body.String())
			}
			if test.asset && string(response.Body.Bytes()) != string(wantAsset) {
				t.Fatalf("asset body mismatch: got %q", response.Body.String())
			}
		})
	}
}

func TestFrontendServingServes404PageForUnknownRoutes(t *testing.T) {
	frontendDir := t.TempDir()
	writeFrontendTestFile(t, frontendDir, "index.html", "frontend index")
	writeFrontendTestFile(t, frontendDir, "404.html", "frontend missing page")
	database := openAPIStore(t)
	handler := New(database, Config{FrontendDir: frontendDir})

	wantIndex, err := os.ReadFile(filepath.Join(frontendDir, "index.html"))
	if err != nil {
		t.Fatalf("read frontend index fixture: %v", err)
	}
	response := httptest.NewRecorder()
	handler.ServeHTTP(response, httptest.NewRequest(http.MethodGet, "/", nil))
	if response.Code != http.StatusOK {
		t.Fatalf("root status = %d, want %d", response.Code, http.StatusOK)
	}
	if string(response.Body.Bytes()) != string(wantIndex) {
		t.Fatalf("root body mismatch")
	}

	wantMissing, err := os.ReadFile(filepath.Join(frontendDir, "404.html"))
	if err != nil {
		t.Fatalf("read frontend 404 fixture: %v", err)
	}
	response = httptest.NewRecorder()
	handler.ServeHTTP(response, httptest.NewRequest(http.MethodGet, "/settings/profile", nil))
	if response.Code != http.StatusNotFound {
		t.Fatalf("unknown route status = %d, want 404", response.Code)
	}
	if string(response.Body.Bytes()) != string(wantMissing) {
		t.Fatalf("unknown route body mismatch")
	}

	response = httptest.NewRecorder()
	handler.ServeHTTP(response, httptest.NewRequest(http.MethodGet, "/assets/missing", nil))
	if response.Code != http.StatusNotFound {
		t.Fatalf("missing asset status = %d, want 404", response.Code)
	}
}

func TestFrontendServingFallsBackToPlain404WithoutBundledPage(t *testing.T) {
	frontendDir := t.TempDir()
	writeFrontendTestFile(t, frontendDir, "index.html", "frontend index")
	database := openAPIStore(t)
	handler := New(database, Config{FrontendDir: frontendDir})

	response := httptest.NewRecorder()
	handler.ServeHTTP(response, httptest.NewRequest(http.MethodGet, "/settings/profile", nil))
	if response.Code != http.StatusNotFound {
		t.Fatalf("unknown route status = %d, want 404", response.Code)
	}
}

func openAPIStore(t *testing.T) store.Store {
	t.Helper()
	database, err := store.Open(filepath.Join(t.TempDir(), "api.db"))
	if err != nil {
		t.Fatalf("open API store: %v", err)
	}
	t.Cleanup(func() { _ = database.Close() })
	return database
}

func apiProjectRoot(t *testing.T) string {
	t.Helper()
	workingDirectory, err := os.Getwd()
	if err != nil {
		t.Fatalf("get working directory: %v", err)
	}
	return filepath.Clean(filepath.Join(workingDirectory, "..", "..", ".."))
}
