package api

import (
	"bytes"
	"context"
	"encoding/json"
	"io"
	"net/http"
	"net/http/httptest"
	"path/filepath"
	"testing"

	"github.com/danielgtaylor/huma/v2"
	"github.com/danielgtaylor/huma/v2/adapters/humachi"
	"github.com/go-chi/chi/v5"
	"github.com/simhozebs/net-worth-estimator/backend/internal/receipts"
	"github.com/simhozebs/net-worth-estimator/backend/internal/testseed"
)

func TestReadOnlyPolicyUsesMatchedOperations(t *testing.T) {
	router := chi.NewRouter()
	api := humachi.New(router, huma.DefaultConfig("Test", "1.0.0"))
	api.UseMiddleware(readOnlyMiddleware(api, true))
	handler := func(context.Context, *struct{ Body map[string]any }) (*struct{}, error) {
		return nil, nil
	}
	for _, method := range []string{http.MethodPost, http.MethodPut, http.MethodPatch, http.MethodDelete} {
		huma.Register(api, huma.Operation{OperationID: method, Method: method, Path: "/future-write"}, handler)
	}
	for _, method := range []string{http.MethodGet, http.MethodHead, http.MethodOptions} {
		huma.Register(api, huma.Operation{OperationID: method, Method: method, Path: "/safe"}, func(context.Context, *struct{}) (*struct{}, error) {
			return nil, nil
		})
	}
	huma.Register(api, huma.Operation{
		OperationID: "future-compute", Method: http.MethodPost, Path: "/future-compute",
		Metadata: map[string]any{operationEffectKey: operationEffectCompute},
	}, handler)
	for _, test := range []struct {
		method, path, body string
		want               int
	}{
		{http.MethodPost, "/future-write", "not JSON", http.StatusForbidden},
		{http.MethodPut, "/future-write", "not JSON", http.StatusForbidden},
		{http.MethodPatch, "/future-write", "not JSON", http.StatusForbidden},
		{http.MethodDelete, "/future-write", "not JSON", http.StatusForbidden},
		{http.MethodPost, "/future-compute", `{}`, http.StatusNoContent},
		{http.MethodPost, "/future-write-extra", `{}`, http.StatusNotFound},
		{http.MethodGet, "/safe", "", http.StatusNoContent},
		{http.MethodHead, "/safe", "", http.StatusOK},
		{http.MethodOptions, "/safe", "", http.StatusNoContent},
	} {
		t.Run(test.method+test.path, func(t *testing.T) {
			request := httptest.NewRequest(test.method, test.path, bytes.NewBufferString(test.body))
			request.Header.Set("Content-Type", "application/json")
			response := httptest.NewRecorder()
			router.ServeHTTP(response, request)
			if response.Code != test.want {
				t.Fatalf("status = %d, want %d, body %s", response.Code, test.want, response.Body.String())
			}
		})
	}
}

type readOnlyBodyProbe struct{ reads int }

func (p *readOnlyBodyProbe) Read([]byte) (int, error) {
	p.reads++
	return 0, io.EOF
}

func (*readOnlyBodyProbe) Close() error { return nil }

func TestReadOnlyRejectsReceiptUploadsBeforeReadingBody(t *testing.T) {
	handler := New(openAPIStore(t), Config{ReadOnly: true})
	for _, route := range []struct{ method, path string }{
		{http.MethodPost, "/v1/receipts"},
		{http.MethodPut, "/v1/receipts/missing/image"},
	} {
		for _, length := range []int64{-1, receipts.MaxUploadBytes + 100000} {
			body := &readOnlyBodyProbe{}
			request := httptest.NewRequest(route.method, route.path, body)
			request.ContentLength = length
			request.Header.Set("Content-Type", "multipart/form-data; boundary=test")
			response := httptest.NewRecorder()
			handler.ServeHTTP(response, request)
			if response.Code != http.StatusForbidden || body.reads != 0 {
				t.Fatalf("%s %s length=%d: status=%d reads=%d", route.method, route.path, length, response.Code, body.reads)
			}
		}
	}
}

func postAccount(handler http.Handler, authorization string) *httptest.ResponseRecorder {
	body := `{"name":"Probe","kind":"cash","enabled":true}`
	request := httptest.NewRequest(http.MethodPost, "/v1/accounts", bytes.NewReader([]byte(body)))
	request.Header.Set("Content-Type", "application/json")
	if authorization != "" {
		request.Header.Set("Authorization", authorization)
	}
	response := httptest.NewRecorder()
	handler.ServeHTTP(response, request)
	return response
}

func TestRowWriteReadOnlyMatrix(t *testing.T) {
	for _, test := range []struct {
		name       string
		config     Config
		authHeader string
		want       int
	}{
		{name: "writable API", config: Config{}, want: http.StatusOK},
		{name: "read-only API", config: Config{ReadOnly: true}, want: http.StatusForbidden},
		{name: "bearer cannot bypass read-only", config: Config{ReadOnly: true}, authHeader: "Bearer retired-token", want: http.StatusForbidden},
	} {
		t.Run(test.name, func(t *testing.T) {
			database := openAPIStore(t)
			root := apiProjectRoot(t)
			if _, err := testseed.Seed(database, filepath.Join(root, "public", "configs")); err != nil {
				t.Fatalf("seed store: %v", err)
			}
			handler := New(database, test.config)

			before := httptest.NewRecorder()
			handler.ServeHTTP(before, httptest.NewRequest(http.MethodGet, "/v1/financial-model", nil))
			var beforePayload struct {
				Document json.RawMessage `json:"document"`
			}
			if err := json.Unmarshal(before.Body.Bytes(), &beforePayload); err != nil {
				t.Fatalf("decode GET response: %v", err)
			}

			response := postAccount(handler, test.authHeader)
			if response.Code != test.want {
				t.Fatalf("POST status = %d, want %d, body %s", response.Code, test.want, response.Body.String())
			}

			after := httptest.NewRecorder()
			handler.ServeHTTP(after, httptest.NewRequest(http.MethodGet, "/v1/financial-model", nil))
			var afterPayload struct {
				Document json.RawMessage `json:"document"`
			}
			if err := json.Unmarshal(after.Body.Bytes(), &afterPayload); err != nil {
				t.Fatalf("decode verify response: %v", err)
			}
			if test.want != http.StatusOK && string(afterPayload.Document) != string(beforePayload.Document) {
				t.Fatalf("rejected write changed stored document")
			}
		})
	}
}

func TestStatusOmitsRetiredTokenPolicy(t *testing.T) {
	database := openAPIStore(t)
	handler := New(database, Config{})
	response := httptest.NewRecorder()
	handler.ServeHTTP(response, httptest.NewRequest(http.MethodGet, "/v1/status", nil))

	if response.Code != http.StatusOK {
		t.Fatalf("status = %d", response.Code)
	}
	var payload map[string]any
	if err := json.Unmarshal(response.Body.Bytes(), &payload); err != nil {
		t.Fatalf("decode status response: %v", err)
	}
	if _, present := payload["authEnabled"]; present || payload["readOnly"] != false {
		t.Fatalf("status = %+v", payload)
	}
}
