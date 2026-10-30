package integration

import (
	"bytes"
	"encoding/json"
	"io"
	"net/http"
	"net/http/httptest"
	"strings"
	"testing"
	"time"

	"github.com/simhozebs/net-worth-estimator/backend/internal/store"
	"github.com/simhozebs/net-worth-estimator/backend/internal/types"
)

func TestStochasticSSEHumaErrorsPrecedeStreamHeaders(t *testing.T) {
	handler := New(openAPIStore(t), Config{ReadOnly: true})
	for _, test := range []struct {
		body string
		want int
	}{
		{"", http.StatusBadRequest},
		{"{", http.StatusUnprocessableEntity},
		{`{"settings":{},"config":{}}`, http.StatusInternalServerError},
	} {
		response := postStochastic(t, handler, []byte(test.body))
		if response.Code != test.want {
			t.Fatalf("body %q: status=%d, want %d, response=%s", test.body, response.Code, test.want, response.Body.String())
		}
		if response.Header().Get("Content-Type") != "application/problem+json" || response.Header().Get("Projection-Source") != "" {
			t.Fatalf("error has stream headers: %v", response.Header())
		}
		if !json.Valid(response.Body.Bytes()) {
			t.Fatalf("invalid Huma error: %s", response.Body.String())
		}
	}
}

func TestStochasticSSEPreservesLargeRequestSupport(t *testing.T) {
	body := append(bytes.Repeat([]byte(" "), 1024*1024), stochasticTestBody(t, 1, nil)...)
	response := postStochastic(t, New(openAPIStore(t), Config{}), body)
	if response.Code != http.StatusOK || len(sseEvents(t, response.Body.String())["result"]) != 1 {
		t.Fatalf("large request: %d %s", response.Code, response.Body.String())
	}
}

type stochasticArtifactObserver struct {
	store.Store
	persisted chan error
}

func (s *stochasticArtifactObserver) PutArtifact(identity, kind, payload string) error {
	err := s.Store.PutArtifact(identity, kind, payload)
	s.persisted <- err
	return err
}

func TestStochasticSSEReadOnlyHTTPAndStoredRecovery(t *testing.T) {
	database := &stochasticArtifactObserver{Store: openAPIStore(t), persisted: make(chan error, 1)}
	server := httptest.NewServer(New(database, Config{ReadOnly: true}))
	defer server.Close()
	client := server.Client()
	client.Timeout = 10 * time.Second
	write, err := client.Post(server.URL+"/v1/accounts", "application/json", strings.NewReader(`{"name":"blocked","kind":"cash","enabled":true}`))
	if err != nil {
		t.Fatal(err)
	}
	write.Body.Close()
	if write.StatusCode != http.StatusForbidden {
		t.Fatalf("read-only write status = %d, want 403", write.StatusCode)
	}
	seed := int64(29)
	body := stochasticTestBody(t, 4, &seed)
	for _, source := range []string{projectionSourceComputed, projectionSourceStored} {
		response, err := client.Post(server.URL+"/v1/projections/stochastic", "application/json", bytes.NewReader(body))
		if err != nil {
			t.Fatal(err)
		}
		if response.StatusCode != http.StatusOK || response.Header.Get("Projection-Source") != source || response.Header.Get("Content-Type") != "text/event-stream" || response.Header.Get("Cache-Control") != "no-store" {
			response.Body.Close()
			t.Fatalf("%s: status=%d headers=%v", source, response.StatusCode, response.Header)
		}
		raw, err := io.ReadAll(response.Body)
		response.Body.Close()
		if err != nil {
			t.Fatal(err)
		}
		if len(sseEvents(t, string(raw))["result"]) != 1 || !strings.Contains(string(raw), "retry: 3000\n") {
			t.Fatalf("%s: incomplete stream: %s", source, raw)
		}
		if source == projectionSourceComputed {
			select {
			case err := <-database.persisted:
				if err != nil {
					t.Fatal(err)
				}
			case <-time.After(10 * time.Second):
				t.Fatal("seeded result was not persisted")
			}
		}
	}
}

func TestStochasticSSESeededComputedThenStored(t *testing.T) {
	database := openAPIStore(t)
	handler := New(database, Config{})
	seed := int64(42)
	body := stochasticTestBody(t, 4, &seed)

	first := postStochastic(t, handler, body)
	if got := first.Header().Get("Cache-Status"); got != "" {
		t.Fatalf("obsolete Cache-Status header = %q", got)
	}
	if first.Code != http.StatusOK {
		t.Fatalf("first status = %d, body %s", first.Code, first.Body.String())
	}
	if got := first.Header().Get("Projection-Source"); got != projectionSourceComputed {
		t.Fatalf("first Projection-Source = %q, want computed", got)
	}
	events := sseEvents(t, first.Body.String())
	if len(events["result"]) != 1 {
		t.Fatalf("first response has %d result events, body %s", len(events["result"]), first.Body.String())
	}

	second := postStochastic(t, handler, body)
	if got := second.Header().Get("Projection-Source"); got != projectionSourceStored {
		t.Fatalf("second Projection-Source = %q, want stored", got)
	}
	if sseEvents(t, second.Body.String())["result"][0] != events["result"][0] {
		t.Fatalf("stored result differs from computed result")
	}
}

func TestStochasticSSEErrorEventOnBadSettings(t *testing.T) {
	database := openAPIStore(t)
	handler := New(database, Config{})
	seed := int64(1)
	raw, err := json.Marshal(map[string]any{
		"document": stochasticTestDocument(),
		"settings": types.ProjectionRuntimeSettings{
			FallbackProjectionStartDate: "not-a-date",
			HorizonYears:                1,
			Evaluations:                 types.EmptyEvaluationTables(),
		},
		"config": map[string]any{"runCount": 4, "seed": seed},
	})
	if err != nil {
		t.Fatalf("marshal body: %v", err)
	}

	response := postStochastic(t, handler, raw)
	if response.Code != http.StatusOK {
		t.Fatalf("status = %d, body %s", response.Code, response.Body.String())
	}
	events := sseEvents(t, response.Body.String())
	if len(events["error"]) != 1 {
		t.Fatalf("expected one error event, body %s", response.Body.String())
	}
	if len(events["result"]) != 0 {
		t.Fatalf("failed run must not emit a result event")
	}
}
