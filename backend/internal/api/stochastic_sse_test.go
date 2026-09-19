package api

import (
	"bytes"
	"encoding/json"
	"net/http"
	"net/http/httptest"
	"strings"
	"testing"
	"time"

	"github.com/simhozebs/net-worth-estimator/backend/internal/types"
)

func stochasticTestDocument() *types.FinancialModelDocument {
	end := "2027-01-01"
	return &types.FinancialModelDocument{
		Accounts: []types.Account{{ID: "checking", Label: "Checking", Enabled: true}},
		Postings: []types.Posting{{
			ID:           "salary",
			Label:        "Salary",
			Destinations: []string{"checking"},
			Amount: types.PostingAmountResolution{
				Resolver: "expression",
				Config:   map[string]any{"expression": "100"},
			},
			Frequency:  types.FrequencyMonthly,
			AnnualRate: 0,
			Volatility: 0.1,
			StartDate:  "2026-01-01",
			EndDate:    &end,
			Priority:   1,
			Enabled:    true,
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

func TestStochasticSSESeededLifecycleMissThenHit(t *testing.T) {
	resetSharedRunsForTest()
	t.Cleanup(resetSharedRunsForTest)
	database := openAPIStore(t)
	handler := New(database, Config{})
	seed := int64(42)
	body := stochasticTestBody(t, 4, &seed)

	first := postStochastic(t, handler, body)
	if first.Code != http.StatusOK {
		t.Fatalf("first status = %d, body %s", first.Code, first.Body.String())
	}
	if got := first.Header().Get("X-Cache"); got != "miss" {
		t.Fatalf("first X-Cache = %q, want miss", got)
	}
	events := sseEvents(t, first.Body.String())
	if len(events["result"]) != 1 {
		t.Fatalf("first response has %d result events, body %s", len(events["result"]), first.Body.String())
	}

	second := postStochastic(t, handler, body)
	if got := second.Header().Get("X-Cache"); got != "hit" {
		t.Fatalf("second X-Cache = %q, want hit", got)
	}
	if sseEvents(t, second.Body.String())["result"][0] != events["result"][0] {
		t.Fatalf("cached result differs from computed result")
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
	if got := second.Header().Get("X-Cache"); got != "attach" {
		t.Fatalf("second X-Cache = %q, want attach", got)
	}
	secondEvents := sseEvents(t, second.Body.String())
	if len(secondEvents["partial"]) == 0 {
		t.Fatalf("attached stream received no partial snapshot, body %s", second.Body.String())
	}
	if len(secondEvents["result"]) != 1 {
		t.Fatalf("attached stream has %d result events", len(secondEvents["result"]))
	}

	first := <-firstDone
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
	if got := response.Header().Get("X-Cache"); got != "miss" {
		t.Fatalf("X-Cache = %q, want miss", got)
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
