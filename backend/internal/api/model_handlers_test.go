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

func TestReadOnlyRejectsPutWithSeededDocument(t *testing.T) {
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
	if get.Code != http.StatusOK {
		t.Fatalf("GET status = %d, body %s", get.Code, get.Body.String())
	}
	var payload struct {
		Document json.RawMessage `json:"document"`
	}
	if err := json.Unmarshal(get.Body.Bytes(), &payload); err != nil {
		t.Fatalf("decode GET response: %v", err)
	}

	put := httptest.NewRecorder()
	request := httptest.NewRequest(http.MethodPut, "/v1/financial-model", bytes.NewReader(payload.Document))
	request.Header.Set("Content-Type", "application/json")
	handler.ServeHTTP(put, request)
	if put.Code != http.StatusForbidden {
		t.Fatalf("PUT status = %d, want 403, body %s", put.Code, put.Body.String())
	}

	verify := httptest.NewRecorder()
	handler.ServeHTTP(verify, httptest.NewRequest(http.MethodGet, "/v1/financial-model", nil))
	if verify.Code != http.StatusOK {
		t.Fatalf("verify GET status = %d, body %s", verify.Code, verify.Body.String())
	}
	var after struct {
		Document json.RawMessage `json:"document"`
	}
	if err := json.Unmarshal(verify.Body.Bytes(), &after); err != nil {
		t.Fatalf("decode verify response: %v", err)
	}
	if string(after.Document) != string(payload.Document) {
		t.Fatalf("rejected PUT changed stored document")
	}
}

func TestPutModelReturnsPersistedContentIdentity(t *testing.T) {
	database := openAPIStore(t)
	if _, _, err := database.ImportCSV(
		filepath.Join(apiProjectRoot(t), "public", "configs"),
		filepath.Join(apiProjectRoot(t), "public", "data", "income"),
	); err != nil {
		t.Fatalf("seed store: %v", err)
	}
	handler := New(database, Config{})

	get := httptest.NewRecorder()
	handler.ServeHTTP(get, httptest.NewRequest(http.MethodGet, "/v1/financial-model", nil))
	var before struct {
		Document json.RawMessage `json:"document"`
		Revision string          `json:"revision"`
	}
	if err := json.Unmarshal(get.Body.Bytes(), &before); err != nil {
		t.Fatalf("decode GET response: %v", err)
	}
	put := httptest.NewRecorder()
	request := httptest.NewRequest(http.MethodPut, "/v1/financial-model", bytes.NewReader(before.Document))
	request.Header.Set("Content-Type", "application/json")
	request.Header.Set("If-Match", before.Revision)
	handler.ServeHTTP(put, request)
	if put.Code != http.StatusOK {
		t.Fatalf("PUT status = %d, body %s", put.Code, put.Body.String())
	}
	var afterPut struct {
		Revision string `json:"revision"`
	}
	if err := json.Unmarshal(put.Body.Bytes(), &afterPut); err != nil {
		t.Fatalf("decode PUT response: %v", err)
	}
	afterGet := httptest.NewRecorder()
	handler.ServeHTTP(afterGet, httptest.NewRequest(http.MethodGet, "/v1/financial-model", nil))
	if afterPut.Revision == "" || afterPut.Revision != afterGet.Header().Get("ETag") {
		t.Fatalf("PUT revision = %q, persisted ETag = %q", afterPut.Revision, afterGet.Header().Get("ETag"))
	}
}

func TestPutModelRequiresContentIdentity(t *testing.T) {
	database := openAPIStore(t)
	if _, _, err := database.ImportCSV(
		filepath.Join(apiProjectRoot(t), "public", "configs"),
		filepath.Join(apiProjectRoot(t), "public", "data", "income"),
	); err != nil {
		t.Fatalf("seed store: %v", err)
	}
	handler := New(database, Config{})
	get := httptest.NewRecorder()
	handler.ServeHTTP(get, httptest.NewRequest(http.MethodGet, "/v1/financial-model", nil))
	var before struct {
		Document json.RawMessage `json:"document"`
	}
	if err := json.Unmarshal(get.Body.Bytes(), &before); err != nil {
		t.Fatalf("decode GET response: %v", err)
	}

	put := httptest.NewRecorder()
	request := httptest.NewRequest(http.MethodPut, "/v1/financial-model", bytes.NewReader(before.Document))
	request.Header.Set("Content-Type", "application/json")
	handler.ServeHTTP(put, request)
	if put.Code != http.StatusPreconditionRequired {
		t.Fatalf("PUT without If-Match status = %d, want 428, body %s", put.Code, put.Body.String())
	}
}

func TestPutModelRejectsStaleContentIdentity(t *testing.T) {
	database := openAPIStore(t)
	if _, _, err := database.ImportCSV(
		filepath.Join(apiProjectRoot(t), "public", "configs"),
		filepath.Join(apiProjectRoot(t), "public", "data", "income"),
	); err != nil {
		t.Fatalf("seed store: %v", err)
	}
	handler := New(database, Config{})

	get := httptest.NewRecorder()
	handler.ServeHTTP(get, httptest.NewRequest(http.MethodGet, "/v1/financial-model", nil))
	if get.Code != http.StatusOK {
		t.Fatalf("GET status = %d, body %s", get.Code, get.Body.String())
	}
	var before struct {
		Document json.RawMessage `json:"document"`
		Revision string          `json:"revision"`
	}
	if err := json.Unmarshal(get.Body.Bytes(), &before); err != nil {
		t.Fatalf("decode GET response: %v", err)
	}
	if before.Revision == "" || get.Header().Get("ETag") != before.Revision {
		t.Fatalf("model revision = %q, ETag = %q", before.Revision, get.Header().Get("ETag"))
	}

	stored, err := database.LoadDocument()
	if err != nil || stored == nil {
		t.Fatalf("load stored document: %v", err)
	}
	changed := *stored
	changed.SourcePath = stored.SourcePath + ".changed"
	if err := database.SaveDocument(&changed); err != nil {
		t.Fatalf("save changed document: %v", err)
	}

	put := httptest.NewRecorder()
	request := httptest.NewRequest(http.MethodPut, "/v1/financial-model", bytes.NewReader(before.Document))
	request.Header.Set("Content-Type", "application/json")
	request.Header.Set("If-Match", before.Revision)
	handler.ServeHTTP(put, request)
	if put.Code != http.StatusPreconditionFailed {
		t.Fatalf("stale PUT status = %d, want 412, body %s", put.Code, put.Body.String())
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
	for index := range fixture.Document.Postings {
		if fixture.Document.Postings[index].ID == "invest" {
			fixture.Document.Postings[index].AnnualCap = &cap
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
	for index := range fixture.Document.Postings {
		if fixture.Document.Postings[index].ID == "invest" {
			fixture.Document.Postings[index].StartDate = "2026-01-31"
			fixture.Document.Postings[index].EndDate = &endDate
			fixture.Document.Postings[index].AnnualCap = &cap
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
			if bytes.Contains(response.Body.Bytes(), []byte("frontend index")) {
				t.Fatalf("reserved path served frontend index: %s", response.Body.String())
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
	for _, test := range []struct {
		path   string
		want   int
		body   string
		absent bool
	}{
		{path: "/assets/app.js", want: http.StatusOK, body: "export const ready = true;"},
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
			if test.body != "" && response.Body.String() != test.body {
				t.Fatalf("body = %q, want %q", response.Body.String(), test.body)
			}
		})
	}
}

func TestFrontendServingFallsBackToIndexForSPARoutes(t *testing.T) {
	frontendDir := t.TempDir()
	writeFrontendTestFile(t, frontendDir, "index.html", "frontend index")
	database := openAPIStore(t)
	handler := New(database, Config{FrontendDir: frontendDir})

	for _, requestPath := range []string{"/", "/settings/profile"} {
		t.Run(requestPath, func(t *testing.T) {
			response := httptest.NewRecorder()
			handler.ServeHTTP(response, httptest.NewRequest(http.MethodGet, requestPath, nil))
			if response.Code != http.StatusOK || response.Body.String() != "frontend index" {
				t.Fatalf("status = %d, body %q", response.Code, response.Body.String())
			}
		})
	}

	response := httptest.NewRecorder()
	handler.ServeHTTP(response, httptest.NewRequest(http.MethodGet, "/assets/missing", nil))
	if response.Code != http.StatusNotFound {
		t.Fatalf("missing asset status = %d, want 404", response.Code)
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
