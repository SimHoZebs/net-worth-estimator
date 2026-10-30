package integration

import (
	"bytes"
	"compress/gzip"
	"encoding/json"
	"io"
	"net/http"
	"net/http/httptest"
	"os"
	"path/filepath"
	"testing"

	"github.com/simhozebs/net-worth-estimator/backend/internal/types"
)

// Large JSON payloads must arrive gzipped on slow links; SSE streams must
// pass through uncompressed with flushing intact.
func deterministicTestBody(t *testing.T) []byte {
	t.Helper()
	fixturePath := filepath.Join(apiProjectRoot(t), "backend", "testdata", "golden", "deterministic.json")
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
	raw, err := json.Marshal(projectionRequestBody{
		Document: fixture.Document,
		Settings: fixture.Settings,
		Range:    fullSpanRange(),
	})
	if err != nil {
		t.Fatalf("encode deterministic body: %v", err)
	}
	return raw
}

func postDeterministic(t *testing.T, handler http.Handler, body []byte, acceptEncoding string) *httptest.ResponseRecorder {
	t.Helper()
	request := httptest.NewRequest(http.MethodPost, "/v1/projections/deterministic", bytes.NewReader(body))
	request.Header.Set("Content-Type", "application/json")
	if acceptEncoding != "" {
		request.Header.Set("Accept-Encoding", acceptEncoding)
	}
	response := httptest.NewRecorder()
	handler.ServeHTTP(response, request)
	return response
}

func decodeBody(t *testing.T, response *httptest.ResponseRecorder) []byte {
	t.Helper()
	if response.Header().Get("Content-Encoding") == "gzip" {
		reader, err := gzip.NewReader(response.Body)
		if err != nil {
			t.Fatalf("open gzip body: %v", err)
		}
		defer reader.Close()
		raw, err := io.ReadAll(reader)
		if err != nil {
			t.Fatalf("read gzip body: %v", err)
		}
		return raw
	}
	return response.Body.Bytes()
}

func TestDeterministicJSONIsCompressed(t *testing.T) {
	database := openAPIStore(t)
	handler := New(database, Config{})
	body := deterministicTestBody(t)

	plain := postDeterministic(t, handler, body, "")
	if encoding := plain.Header().Get("Content-Encoding"); encoding != "" {
		t.Fatalf("plain response Content-Encoding = %q, want empty", encoding)
	}

	compressed := postDeterministic(t, handler, body, "gzip")
	if encoding := compressed.Header().Get("Content-Encoding"); encoding != "gzip" {
		t.Fatalf("compressed response Content-Encoding = %q, want gzip", encoding)
	}
	var payload struct {
		Result *types.ProjectionResult `json:"result"`
	}
	if err := json.Unmarshal(decodeBody(t, compressed), &payload); err != nil {
		t.Fatalf("decode compressed body: %v", err)
	}
	if payload.Result == nil {
		t.Fatal("compressed body has no projection result")
	}
}

func TestStochasticSSEIsNotCompressed(t *testing.T) {
	database := openAPIStore(t)
	handler := New(database, Config{})
	seed := int64(42)
	body := stochasticTestBody(t, 2, &seed)

	request := httptest.NewRequest(http.MethodPost, "/v1/projections/stochastic", bytes.NewReader(body))
	request.Header.Set("Content-Type", "application/json")
	request.Header.Set("Accept-Encoding", "gzip")
	response := httptest.NewRecorder()
	handler.ServeHTTP(response, request)

	if response.Code != http.StatusOK {
		t.Fatalf("status = %d, body %s", response.Code, response.Body.String())
	}
	if encoding := response.Header().Get("Content-Encoding"); encoding != "" {
		t.Fatalf("SSE Content-Encoding = %q, want empty", encoding)
	}
	events := sseEvents(t, response.Body.String())
	if len(events["result"]) != 1 {
		t.Fatalf("SSE response has %d result events, body %s", len(events["result"]), response.Body.String())
	}
}
