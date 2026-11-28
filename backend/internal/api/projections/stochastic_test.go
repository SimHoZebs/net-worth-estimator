package projections

import (
	"bytes"
	"encoding/json"
	"net/http"
	"net/http/httptest"
	"testing"
	"time"

	"github.com/danielgtaylor/huma/v2"
	"github.com/danielgtaylor/huma/v2/adapters/humachi"
	"github.com/go-chi/chi/v5"
	"github.com/simhozebs/net-worth-estimator/backend/internal/api/apitest"
	"github.com/simhozebs/net-worth-estimator/backend/internal/store"
	"github.com/simhozebs/net-worth-estimator/backend/internal/types"
)

// volatileStochasticBody builds a request whose rule actually samples: the
// attach test needs a run slow enough to join in flight. A fixed-amount
// model short-circuits to one simulation and finishes before attach.
func volatileStochasticBody(t *testing.T, runCount int, seed *int64) []byte {
	t.Helper()
	model := apitest.StochasticModel()
	model.Schedules[0].Amount = types.TransactionAmountResolution{
		Resolver: "expression",
		Config:   map[string]any{"expression": "(base) * (1 + rate)"},
		Inputs: map[string]types.AmountInputBinding{
			"base": {Source: "literal", Value: 100.0},
			"rate": {Source: "provider", Provider: "occurrence-rate", Arguments: map[string]any{"annualRate": 0.07, "volatility": 0.5}},
		},
	}
	raw, err := json.Marshal(map[string]any{
		"model": model,
		"settings": types.ProjectionRuntimeSettings{
			FallbackProjectionStartDate: "2026-06-01", HorizonYears: 1, Evaluations: types.EmptyEvaluationTables(),
		},
		"config": map[string]any{"runCount": runCount, "seed": seed},
	})
	if err != nil {
		t.Fatalf("marshal volatile stochastic body: %v", err)
	}
	return raw
}

func resetSharedRunsForTest() {
	sharedStochasticRegistry.Lock()
	defer sharedStochasticRegistry.Unlock()
	sharedStochasticRegistry.byKey = map[string]*sharedStochasticRun{}
}

func projectionTestHandler(t *testing.T) http.Handler {
	t.Helper()
	return projectionTestHandlerWithStore(t, apitest.OpenStore(t))
}

func projectionTestHandlerWithStore(t *testing.T, st store.Store) http.Handler {
	router := chi.NewRouter()
	api := humachi.New(router, huma.DefaultConfig("Test", "1.0.0"))
	Register(api, st, t.Name())
	return router
}

type recordingStochasticStore struct {
	store.Store
	reads     int
	hits      int
	writes    int
	lastWrite store.StochasticProjectionWrite
}

func (s *recordingStochasticStore) ReadStochasticProjection(stateID, kind string, revision int64, evaluationsJSON string) (*store.StochasticProjectionRead, bool, error) {
	s.reads++
	snapshot, served, err := s.Store.ReadStochasticProjection(stateID, kind, revision, evaluationsJSON)
	if served {
		s.hits++
	}
	return snapshot, served, err
}

func (s *recordingStochasticStore) SaveStochasticProjection(write store.StochasticProjectionWrite) (bool, error) {
	s.writes++
	s.lastWrite = write
	return s.Store.SaveStochasticProjection(write)
}

func TestStochasticSSEAttachJoinsInFlightRun(t *testing.T) {
	resetSharedRunsForTest()
	t.Cleanup(resetSharedRunsForTest)
	handler := projectionTestHandler(t)
	seed := int64(7)
	body := volatileStochasticBody(t, 2000, &seed)
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

type nonFlushingResponseWriter struct {
	header http.Header
	status int
	body   bytes.Buffer
}

func (w *nonFlushingResponseWriter) Header() http.Header {
	if w.header == nil {
		w.header = make(http.Header)
	}
	return w.header
}

func (w *nonFlushingResponseWriter) WriteHeader(status int) { w.status = status }
func (w *nonFlushingResponseWriter) Write(p []byte) (int, error) {
	if w.status == 0 {
		w.status = http.StatusOK
	}
	return w.body.Write(p)
}

func TestStochasticSSENonWritableStreamNeverRegistersRun(t *testing.T) {
	resetSharedRunsForTest()
	t.Cleanup(resetSharedRunsForTest)
	handler := projectionTestHandler(t)
	seed := int64(7)
	body := volatileStochasticBody(t, 2, &seed)
	request := httptest.NewRequest(http.MethodPost, "/v1/projections/stochastic", bytes.NewReader(body))
	request.Header.Set("Content-Type", "application/json")
	response := &nonFlushingResponseWriter{}
	handler.ServeHTTP(response, request)
	if response.status != http.StatusInternalServerError || response.body.String() != "streaming unsupported\n" {
		t.Fatalf("non-writable stream = %d %q", response.status, response.body.String())
	}
	if got := response.Header().Get("Projection-Source"); got != "" {
		t.Fatalf("failed stream committed Projection-Source %q", got)
	}
	sharedStochasticRegistry.Lock()
	inflight := len(sharedStochasticRegistry.byKey)
	sharedStochasticRegistry.Unlock()
	if inflight != 0 {
		t.Fatalf("non-writable stream leaked %d registry entries", inflight)
	}

	writable := apitest.PostStochastic(t, handler, body)
	if got := writable.Header().Get("Projection-Source"); got != projectionSourceComputed {
		t.Fatalf("later Projection-Source = %q, want computed", got)
	}
	if len(apitest.SSEEvents(t, writable.Body.String())["result"]) != 1 {
		t.Fatalf("later stream has no result: %s", writable.Body.String())
	}
}

func savedRangeBody(t *testing.T, model *types.FinancialModel, overrides types.ModelOverrides, runCount int, seed int64) []byte {
	t.Helper()
	body := map[string]any{
		"settings": types.ProjectionRuntimeSettings{
			FallbackProjectionStartDate: "2026-06-01", HorizonYears: 1, Evaluations: types.EmptyEvaluationTables(),
		},
		"overrides": overrides,
		"config":    types.StochasticConfig{RunCount: runCount, Seed: &seed},
	}
	if model != nil {
		body["model"] = model
	}
	raw, err := json.Marshal(body)
	if err != nil {
		t.Fatal(err)
	}
	return raw
}

func stochasticResult(t *testing.T, response *httptest.ResponseRecorder) *types.StochasticProjectionResult {
	t.Helper()
	if response.Code != http.StatusOK {
		t.Fatalf("stochastic status = %d, body %s", response.Code, response.Body.String())
	}
	events := apitest.SSEEvents(t, response.Body.String())
	if len(events["result"]) != 1 {
		t.Fatalf("stochastic result count = %d, body %s", len(events["result"]), response.Body.String())
	}
	var payload struct {
		Result *types.StochasticProjectionResult `json:"result"`
	}
	if err := json.Unmarshal([]byte(events["result"][0]), &payload); err != nil || payload.Result == nil {
		t.Fatalf("decode stochastic result: result=%+v err=%v", payload.Result, err)
	}
	return payload.Result
}

func TestSavedProjectionEligibility(t *testing.T) {
	for _, test := range []struct {
		name      string
		model     *types.FinancialModel
		overrides types.ModelOverrides
		want      bool
	}{
		{name: "saved model", want: true},
		{name: "empty slices", overrides: types.EmptyModelOverrides(), want: true},
		{name: "supplied model", model: &types.FinancialModel{}},
		{name: "added account", overrides: types.ModelOverrides{AddedAccounts: []types.Account{{ID: "a"}}}},
		{name: "added transaction", overrides: types.ModelOverrides{AddedTransactions: []types.Transaction{{ID: "t"}}}},
		{name: "added schedule", overrides: types.ModelOverrides{AddedRules: []types.Schedule{{ID: "s"}}}},
		{name: "disabled account", overrides: types.ModelOverrides{DisabledAccountIDs: []string{"a"}}},
		{name: "disabled transaction", overrides: types.ModelOverrides{DisabledTransactionIDs: []string{"t"}}},
		{name: "disabled schedule", overrides: types.ModelOverrides{DisabledScheduleIDs: []string{"s"}}},
	} {
		t.Run(test.name, func(t *testing.T) {
			if got := savedProjectionEligible(test.model, test.overrides); got != test.want {
				t.Fatalf("savedProjectionEligible = %v, want %v", got, test.want)
			}
		})
	}
}

func TestStochasticSSESavedRangeEligibilityAndCountSynchronization(t *testing.T) {
	resetSharedRunsForTest()
	t.Cleanup(resetSharedRunsForTest)
	for _, test := range []struct {
		name         string
		initialCount int
		runCount     int
		otherCount   int
	}{
		{name: "fresh default", runCount: 400, otherCount: 3},
		{name: "legacy unset default", initialCount: 1000, runCount: 400, otherCount: 3},
		{name: "deliberate frozen count", initialCount: 3, runCount: 3, otherCount: 400},
	} {
		t.Run(test.name, func(t *testing.T) {
			base := apitest.OpenStore(t)
			model, err := base.ImportModel(apitest.StochasticModel())
			if err != nil {
				t.Fatal(err)
			}
			state, err := base.GetProjectionState()
			if err != nil {
				t.Fatal(err)
			}
			if test.initialCount != 0 {
				state.TrialCount = test.initialCount
				if _, err := base.SaveProjectionState(state); err != nil {
					t.Fatal(err)
				}
			}
			recording := &recordingStochasticStore{Store: base}
			handler := projectionTestHandlerWithStore(t, recording)
			body := savedRangeBody(t, nil, types.EmptyModelOverrides(), test.runCount, 42)
			first := stochasticResult(t, apitest.PostStochastic(t, handler, body))
			if recording.writes != 1 || recording.lastWrite.TrialCount != test.runCount {
				t.Fatalf("first build writes=%d trial=%d, want one write at %d", recording.writes, recording.lastWrite.TrialCount, test.runCount)
			}
			second := stochasticResult(t, apitest.PostStochastic(t, handler, body))
			if recording.reads != 1 || recording.hits != 1 || recording.writes != 1 {
				t.Fatalf("second request reads=%d hits=%d writes=%d, want one saved hit and no rewrite", recording.reads, recording.hits, recording.writes)
			}
			if first.Config.RunCount != test.runCount || second.Config.RunCount != test.runCount || len(first.Bands) != len(second.Bands) {
				t.Fatalf("saved range config/coverage changed: first=%+v second=%+v", first.Config, second.Config)
			}
			for i := range first.Bands {
				if first.Bands[i] != second.Bands[i] {
					t.Fatalf("saved band %d differs: %+v vs %+v", i, first.Bands[i], second.Bands[i])
				}
			}

			reads, writes := recording.reads, recording.writes
			explicit := savedRangeBody(t, model, types.EmptyModelOverrides(), test.runCount, 42)
			if got := stochasticResult(t, apitest.PostStochastic(t, handler, explicit)); got.Config.RunCount != test.runCount {
				t.Fatalf("supplied-model run count = %d", got.Config.RunCount)
			}
			if recording.reads != reads || recording.writes != writes {
				t.Fatalf("supplied model used saved range: reads %d->%d writes %d->%d", reads, recording.reads, writes, recording.writes)
			}
			overrides := types.ModelOverrides{DisabledScheduleIDs: []string{"salary"}}
			overridden := savedRangeBody(t, nil, overrides, test.runCount, 42)
			if got := stochasticResult(t, apitest.PostStochastic(t, handler, overridden)); got.Config.RunCount != test.runCount {
				t.Fatalf("override run count = %d", got.Config.RunCount)
			}
			if recording.reads != reads || recording.writes != writes {
				t.Fatalf("overrides used saved range: reads %d->%d writes %d->%d", reads, recording.reads, writes, recording.writes)
			}

			other := savedRangeBody(t, nil, types.EmptyModelOverrides(), test.otherCount, 42)
			if got := stochasticResult(t, apitest.PostStochastic(t, handler, other)); got.Config.RunCount != test.otherCount {
				t.Fatalf("different-count run count = %d, want %d", got.Config.RunCount, test.otherCount)
			}
			if recording.writes != writes {
				t.Fatalf("different count rewrote frozen range: writes %d->%d", writes, recording.writes)
			}
			state, err = base.GetProjectionState()
			if err != nil {
				t.Fatal(err)
			}
			if state.TrialCount != test.runCount || state.StochasticSeed == nil || *state.StochasticSeed != 42 {
				t.Fatalf("frozen range settings changed: %+v", state)
			}
		})
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
