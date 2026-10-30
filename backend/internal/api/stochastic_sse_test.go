package api

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

func stochasticTestDocument() *types.FinancialModelDocument {
	end := "2027-01-01"
	return &types.FinancialModelDocument{
		Accounts: []types.Account{{ID: "checking", Name: "Checking", Kind: types.AccountKindCash, Enabled: true}},
		Postings: []types.Posting{},
		RecurrenceRules: []types.RecurrenceRule{{
			ID:           "salary",
			Name:         "Salary",
			Destinations: []string{"checking"},
			Amount: types.PostingAmountResolution{
				Resolver: "expression",
				Config:   map[string]any{"expression": "100"},
			},
			Frequency: types.FrequencyMonthly,
			StartDate: "2026-01-01",
			EndDate:   &end,
			Priority:  1,
			Enabled:   true,
		}},
		Evaluations: types.EmptyEvaluationTables(),
	}
}

func stochasticTestBody(t *testing.T, runCount int, seed *int64) []byte {
	t.Helper()
	raw, err := json.Marshal(map[string]any{
		"document": stochasticTestDocument(),
		"settings": types.ProjectionRuntimeSettings{
			FallbackProjectionStartDate: "2026-06-01",
			HorizonYears:                1,
			Evaluations:                 types.EmptyEvaluationTables(),
		},
		"config": map[string]any{"runCount": runCount, "seed": seed},
	})
	if err != nil {
		t.Fatalf("marshal stochastic body: %v", err)
	}
	return raw
}

func postStochastic(t *testing.T, handler http.Handler, body []byte) *httptest.ResponseRecorder {
	t.Helper()
	request := httptest.NewRequest(http.MethodPost, "/v1/projections/stochastic", bytes.NewReader(body))
	request.Header.Set("Content-Type", "application/json")
	response := httptest.NewRecorder()
	handler.ServeHTTP(response, request)
	return response
}

// sseEvents parses an SSE body into event name -> data payloads.
func sseEvents(t *testing.T, body string) map[string][]string {
	t.Helper()
	out := map[string][]string{}
	for _, raw := range strings.Split(body, "\n\n") {
		name := "message"
		var data []string
		for _, line := range strings.Split(raw, "\n") {
			if strings.HasPrefix(line, "event:") {
				name = strings.TrimSpace(strings.TrimPrefix(line, "event:"))
			} else if strings.HasPrefix(line, "data:") {
				data = append(data, strings.TrimSpace(strings.TrimPrefix(line, "data:")))
			}
		}
		if len(data) > 0 {
			out[name] = append(out[name], strings.Join(data, "\n"))
		}
	}
	return out
}

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
	resetSharedRunsForTest()
	t.Cleanup(resetSharedRunsForTest)
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

func TestStochasticSSEAttachJoinsInFlightRun(t *testing.T) {
	resetSharedRunsForTest()
	t.Cleanup(resetSharedRunsForTest)
	database := openAPIStore(t)
	handler := New(database, Config{})
	seed := int64(7)
	body := stochasticTestBody(t, 2000, &seed)

	firstDone := make(chan *httptest.ResponseRecorder, 1)
	go func() {
		request := httptest.NewRequest(http.MethodPost, "/v1/projections/stochastic", bytes.NewReader(body))
		request.Header.Set("Content-Type", "application/json")
		response := httptest.NewRecorder()
		handler.ServeHTTP(response, request)
		firstDone <- response
	}()

	// Wait for the shared run to exist (created before computation starts).
	deadline := time.Now().Add(10 * time.Second)
	for {
		sharedStochasticRegistry.Lock()
		inflight := len(sharedStochasticRegistry.byKey)
		sharedStochasticRegistry.Unlock()
		if inflight > 0 {
			break
		}
		if time.Now().After(deadline) {
			t.Fatalf("shared run never appeared in registry")
		}
		time.Sleep(10 * time.Millisecond)
	}

	second := postStochastic(t, handler, body)
	if got := second.Header().Get("Projection-Source"); got != projectionSourceShared {
		t.Fatalf("second Projection-Source = %q, want shared", got)
	}
	secondEvents := sseEvents(t, second.Body.String())
	if len(secondEvents["partial"]) == 0 {
		t.Fatalf("attached stream received no partial snapshot, body %s", second.Body.String())
	}
	if len(secondEvents["result"]) != 1 {
		t.Fatalf("attached stream has %d result events", len(secondEvents["result"]))
	}

	first := <-firstDone
	if got := first.Header().Get("Projection-Source"); got != projectionSourceComputed {
		t.Fatalf("owner Projection-Source = %q, want computed", got)
	}
	firstEvents := sseEvents(t, first.Body.String())
	if len(firstEvents["result"]) != 1 {
		t.Fatalf("owner stream has %d result events", len(firstEvents["result"]))
	}
	// Same seed and content key: the attached stream shares the exact run.
	if firstEvents["result"][0] != secondEvents["result"][0] {
		t.Fatalf("attached result differs from owner result")
	}
}

func TestStochasticSSEUnseededBypassesRegistry(t *testing.T) {
	resetSharedRunsForTest()
	t.Cleanup(resetSharedRunsForTest)
	database := openAPIStore(t)
	handler := New(database, Config{})
	body := stochasticTestBody(t, 2, nil)

	response := postStochastic(t, handler, body)
	if response.Code != http.StatusOK {
		t.Fatalf("status = %d, body %s", response.Code, response.Body.String())
	}
	if got := response.Header().Get("Projection-Source"); got != projectionSourceComputed {
		t.Fatalf("Projection-Source = %q, want computed", got)
	}
	if len(sseEvents(t, response.Body.String())["result"]) != 1 {
		t.Fatalf("unseeded response has no result event, body %s", response.Body.String())
	}
	sharedStochasticRegistry.Lock()
	inflight := len(sharedStochasticRegistry.byKey)
	sharedStochasticRegistry.Unlock()
	if inflight != 0 {
		t.Fatalf("unseeded run leaked %d registry entries", inflight)
	}
}

func TestStochasticSSEErrorEventOnBadSettings(t *testing.T) {
	resetSharedRunsForTest()
	t.Cleanup(resetSharedRunsForTest)
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

func TestSharedRunSlowSubscriberNeverBlocksPublish(t *testing.T) {
	resetSharedRunsForTest()
	t.Cleanup(resetSharedRunsForTest)
	run, owner := getOrStartSharedRun("test-key")
	if !owner {
		t.Fatalf("expected ownership of fresh key")
	}
	ch, _, _, finished := run.subscribe()
	if finished {
		t.Fatalf("fresh run reports finished")
	}
	defer run.unsubscribe(ch)

	published := make(chan struct{})
	go func() {
		defer close(published)
		for i := 0; i < 3*sharedRunSubscriberBuffer; i++ {
			run.publish(stochasticStreamEvent{progress: types.StochasticProgress{CompletedRuns: i}})
		}
	}()
	select {
	case <-published:
	case <-time.After(10 * time.Second):
		t.Fatalf("publish blocked on a slow subscriber")
	}
	if got := run.latest.progress.CompletedRuns; got != 3*sharedRunSubscriberBuffer-1 {
		t.Fatalf("latest = %d, want newest event", got)
	}
}
