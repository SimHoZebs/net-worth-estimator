package api

import (
	"context"
	"encoding/json"
	"net/http"
	"net/http/httptest"
	"os"
	"testing"

	"github.com/danielgtaylor/huma/v2"
	"github.com/danielgtaylor/huma/v2/adapters/humachi"
	"github.com/go-chi/chi/v5"
	"github.com/simhozebs/net-worth-estimator/backend/internal/types"
)

type evaluationInstanceOutput struct {
	Body struct {
		Items []types.EvaluationInstance[types.JsonValue] `json:"items"`
	}
}

func TestRawRoutesAppearInOpenAPI(t *testing.T) {
	recorder := httptest.NewRecorder()
	New(openAPIStore(t), Config{}).ServeHTTP(recorder, httptest.NewRequest(http.MethodGet, "/openapi.json", nil))
	var document struct {
		Paths map[string]map[string]struct {
			OperationID string `json:"operationId"`
		} `json:"paths"`
	}
	if err := json.Unmarshal(recorder.Body.Bytes(), &document); err != nil {
		t.Fatal(err)
	}
	for path, methods := range map[string][]string{
		"/v1/auth/session": {"get"}, "/v1/auth/logout": {"post"},
		"/v1/auth/profile": {"get", "patch"}, "/v1/auth/change-password": {"post"},
		"/v1/auth/sessions": {"get", "delete"}, "/v1/projections/stochastic": {"post"},
	} {
		for _, method := range methods {
			if document.Paths[path][method].OperationID == "" {
				t.Errorf("missing operation for %s %s", method, path)
			}
		}
	}
	// Export without a running identity service or access to financial data.
	if target := os.Getenv("OPENAPI_SNAPSHOT"); target != "" {
		var pretty any
		if err := json.Unmarshal(recorder.Body.Bytes(), &pretty); err != nil {
			t.Fatal(err)
		}
		data, err := json.MarshalIndent(pretty, "", "\t")
		if err != nil {
			t.Fatal(err)
		}
		if err := os.WriteFile(target, append(data, '\n'), 0644); err != nil {
			t.Fatal(err)
		}
	}
}

func TestStochasticStreamDocumentsHumaErrors(t *testing.T) {
	response := httptest.NewRecorder()
	New(openAPIStore(t), Config{}).ServeHTTP(response, httptest.NewRequest(http.MethodGet, "/openapi.json", nil))
	var document struct {
		Paths map[string]*huma.PathItem `json:"paths"`
	}
	if err := json.Unmarshal(response.Body.Bytes(), &document); err != nil {
		t.Fatal(err)
	}
	operation := document.Paths["/v1/projections/stochastic"].Post
	if operation.OperationID != "project-stochastic" || operation.Responses["200"].Content["text/event-stream"] == nil || operation.Responses["default"].Content["application/problem+json"] == nil {
		t.Fatalf("stream is not a documented Huma operation: %+v", operation)
	}
}

func TestWaypointSchemaNamerKeepsRegistryGeneratorSafe(t *testing.T) {
	router := chi.NewRouter()
	config := huma.DefaultConfig("Test API", "1.0.0")
	if config.Components == nil {
		config.Components = &huma.Components{}
	}
	config.Components.Schemas = huma.NewMapRegistry("#/components/schemas/", waypointSchemaNamer)
	api := humachi.New(router, config)
	huma.Register(api, huma.Operation{
		OperationID: "test-evaluations",
		Method:      http.MethodGet,
		Path:        "/v1/test-evaluations",
	}, func(context.Context, *struct{}) (*evaluationInstanceOutput, error) {
		return nil, nil
	})
	spec := api.OpenAPI()
	if _, ok := spec.Components.Schemas.Map()["EvaluationInstanceInterface"]; !ok {
		t.Fatalf("expected sanitized EvaluationInstanceInterface schema, got %v", schemaKeys(spec))
	}
	if err := checkOpenAPIComponentKeys(spec); err != nil {
		t.Fatal(err)
	}
}

func schemaKeys(spec *huma.OpenAPI) []string {
	names := make([]string, 0, len(spec.Components.Schemas.Map()))
	for key := range spec.Components.Schemas.Map() {
		names = append(names, key)
	}
	return names
}

func TestServedSpecKeysAreGeneratorSafe(t *testing.T) {
	router := New(openAPIStore(t), Config{})
	request := httptest.NewRequest(http.MethodGet, "/openapi.json", nil)
	recorder := httptest.NewRecorder()
	router.ServeHTTP(recorder, request)
	if recorder.Code != http.StatusOK {
		t.Fatalf("GET /openapi.json status = %d, want 200", recorder.Code)
	}
	var document struct {
		Components struct {
			Schemas map[string]json.RawMessage `json:"schemas"`
		} `json:"components"`
	}
	if err := json.Unmarshal(recorder.Body.Bytes(), &document); err != nil {
		t.Fatalf("decode served spec: %v", err)
	}
	names := make([]string, 0, len(document.Components.Schemas))
	for key := range document.Components.Schemas {
		names = append(names, key)
	}
	if len(names) == 0 {
		t.Fatal("served spec declares no component schemas")
	}
	if err := checkOpenAPIKeys(names, recorder.Body.Bytes()); err != nil {
		t.Fatal(err)
	}
}
