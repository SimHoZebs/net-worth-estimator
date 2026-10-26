package api

import (
	"context"
	"encoding/json"
	"net/http"
	"net/http/httptest"
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
