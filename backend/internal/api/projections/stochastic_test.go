package projections

import (
	"bytes"
	"net/http"
	"net/http/httptest"
	"testing"
	"time"

	"github.com/danielgtaylor/huma/v2"
	"github.com/danielgtaylor/huma/v2/adapters/humachi"
	"github.com/go-chi/chi/v5"
	"github.com/simhozebs/net-worth-estimator/backend/internal/api/apitest"
	"github.com/simhozebs/net-worth-estimator/backend/internal/types"
)

func resetSharedRunsForTest() {
	sharedStochasticRegistry.Lock()
	defer sharedStochasticRegistry.Unlock()
	sharedStochasticRegistry.byKey = map[string]*sharedStochasticRun{}
}

func projectionTestHandler(t *testing.T) http.Handler {
	t.Helper()
	router := chi.NewRouter()
	api := humachi.New(router, huma.DefaultConfig("Test", "1.0.0"))
	Register(api, apitest.OpenStore(t), t.Name())
	return router
}

func TestStochasticSSEAttachJoinsInFlightRun(t *testing.T) {
	resetSharedRunsForTest()
	t.Cleanup(resetSharedRunsForTest)
	handler := projectionTestHandler(t)
	seed := int64(7)
	body := apitest.StochasticBody(t, 2000, &seed)
	firstDone := make(chan *httptest.ResponseRecorder, 1)
	go func() {
		request := httptest.NewRequest(http.MethodPost, "/v1/projections/stochastic", bytes.NewReader(body))
		request.Header.Set("Content-Type", "application/json")
		response := httptest.NewRecorder()
		handler.ServeHTTP(response, request)
		firstDone <- response
	}()
	deadline := time.Now().Add(10 * time.Second)
	for {
		sharedStochasticRegistry.Lock()
		inflight := len(sharedStochasticRegistry.byKey)
		sharedStochasticRegistry.Unlock()
		if inflight > 0 {
			break
		}
		if time.Now().After(deadline) {
			t.Fatal("shared run never appeared in registry")
		}
		time.Sleep(10 * time.Millisecond)
	}
	second := apitest.PostStochastic(t, handler, body)
	if got := second.Header().Get("Projection-Source"); got != projectionSourceShared {
		t.Fatalf("second Projection-Source = %q, want shared", got)
	}
	secondEvents := apitest.SSEEvents(t, second.Body.String())
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
	firstEvents := apitest.SSEEvents(t, first.Body.String())
	if len(firstEvents["result"]) != 1 {
		t.Fatalf("owner stream has %d result events", len(firstEvents["result"]))
	}
	if firstEvents["result"][0] != secondEvents["result"][0] {
		t.Fatal("attached result differs from owner result")
	}
}

func TestStochasticSSEUnseededBypassesRegistry(t *testing.T) {
	resetSharedRunsForTest()
	t.Cleanup(resetSharedRunsForTest)
	response := apitest.PostStochastic(t, projectionTestHandler(t), apitest.StochasticBody(t, 2, nil))
	if response.Code != http.StatusOK {
		t.Fatalf("status = %d, body %s", response.Code, response.Body.String())
	}
	if got := response.Header().Get("Projection-Source"); got != projectionSourceComputed {
		t.Fatalf("Projection-Source = %q, want computed", got)
	}
	if len(apitest.SSEEvents(t, response.Body.String())["result"]) != 1 {
		t.Fatalf("unseeded response has no result event, body %s", response.Body.String())
	}
	sharedStochasticRegistry.Lock()
	inflight := len(sharedStochasticRegistry.byKey)
	sharedStochasticRegistry.Unlock()
	if inflight != 0 {
		t.Fatalf("unseeded run leaked %d registry entries", inflight)
	}
}

func TestSharedRunSlowSubscriberNeverBlocksPublish(t *testing.T) {
	resetSharedRunsForTest()
	t.Cleanup(resetSharedRunsForTest)
	run, owner := getOrStartSharedRun("test-key")
	if !owner {
		t.Fatal("expected ownership of fresh key")
	}
	ch, _, _, finished := run.subscribe()
	if finished {
		t.Fatal("fresh run reports finished")
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
		t.Fatal("publish blocked on a slow subscriber")
	}
	if got := run.latest.progress.CompletedRuns; got != 3*sharedRunSubscriberBuffer-1 {
		t.Fatalf("latest = %d, want newest event", got)
	}
}
