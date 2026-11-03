package integration

import (
	"encoding/json"
	"testing"

	"github.com/simhozebs/net-worth-estimator/backend/internal/types"
)

func sliceTestModel() *types.FinancialModel {
	end := "2028-01-01"
	return &types.FinancialModel{
		Accounts: []types.Account{{ID: "checking", Name: "Checking", Kind: types.AccountKindCash, Enabled: true}},
		Postings: []types.Posting{},
		RecurrenceRules: []types.RecurrenceRule{{
			ID: "salary", Name: "Salary", Destinations: []string{"checking"},
			Amount:    types.PostingAmountResolution{Resolver: "expression", Config: map[string]any{"expression": "100"}, Inputs: map[string]types.AmountInputBinding{}},
			Frequency: types.FrequencyMonthly, StartDate: "2026-01-01", EndDate: &end, Priority: 1, Enabled: true,
		}},
		Evaluations: types.EmptyEvaluationTables(),
	}
}

func sliceTestSettings() types.ProjectionRuntimeSettings {
	return types.ProjectionRuntimeSettings{FallbackProjectionStartDate: "2026-06-01", HorizonYears: 1, Evaluations: types.EmptyEvaluationTables()}
}

func TestProjectionSlicesBuildServeAndInvalidate(t *testing.T) {
	database := openAPIStore(t)
	model := sliceTestModel()
	if _, err := database.ImportModel(model); err != nil {
		t.Fatalf("seed model: %v", err)
	}
	handler := New(database, Config{})
	settings := sliceTestSettings()
	detBody, _ := json.Marshal(projectionRequestBody{Settings: settings, Range: fullSpanRange()})
	first := rangeRequest(t, handler, detBody)
	if first.Code != 200 || first.Header().Get("Projection-Source") != projectionSourceComputed {
		t.Fatalf("first build = %d %s", first.Code, first.Body.String())
	}
	state, err := database.GetProjectionState()
	if err != nil {
		t.Fatal(err)
	}
	if state.DirtyFrom != 0 {
		t.Fatalf("state must be clean after build: %+v", state)
	}
	slices, err := database.ListProjectionSlices()
	if err != nil {
		t.Fatal(err)
	}
	if len(slices) != 1 {
		t.Fatalf("one yearly slice expected, got %+v", slices)
	}
	second := rangeRequest(t, handler, detBody)
	if second.Code != 200 {
		t.Fatalf("second serve = %d %s", second.Code, second.Body.String())
	}
	if second.Body.String() != first.Body.String() {
		t.Fatal("served result differs from built result")
	}
	rows, err := database.ListProjectionRows([]string{slices[0].ID})
	if err != nil || len(rows) == 0 {
		t.Fatalf("timeline rows must persist: %d %v", len(rows), err)
	}
	events, err := database.ListGeneratedPostings([]string{slices[0].ID})
	if err != nil || len(events) == 0 {
		t.Fatalf("generated transactions must persist: %d %v", len(events), err)
	}
	// A historical write dirties the suffix and rebuilds it.
	if _, err := database.SaveCheckpoint(types.Checkpoint{AccountID: "checking", Balance: 500, ObservedAt: 1777679999}); err != nil {
		t.Fatalf("checkpoint: %v", err)
	}
	third := rangeRequest(t, handler, detBody)
	if third.Code != 200 {
		t.Fatalf("rebuild = %d %s", third.Code, third.Body.String())
	}
	if third.Body.String() == first.Body.String() {
		t.Fatal("rebuilt result must reflect the checkpoint")
	}
	again, err := database.GetProjectionState()
	if err != nil {
		t.Fatal(err)
	}
	if again.DirtyFrom != 0 {
		t.Fatalf("state must be clean after rebuild: %+v", again)
	}
	if again.Revision != state.Revision+1 {
		t.Fatalf("write must bump revision once: %d -> %d", state.Revision, again.Revision)
	}
	// A request carrying the stored model bypasses slices but agrees.
	loaded, err := database.LoadModel()
	if err != nil {
		t.Fatal(err)
	}
	withModel, _ := json.Marshal(projectionRequestBody{Model: loaded, Settings: settings, Range: fullSpanRange()})
	direct := rangeRequest(t, handler, withModel)
	if direct.Code != 200 || direct.Body.String() != third.Body.String() {
		t.Fatalf("bypass body differs from slice body: %d", direct.Code)
	}
}

func TestProjectionSlicesServeSeededStochastic(t *testing.T) {
	database := openAPIStore(t)
	st := database
	if _, err := st.ImportModel(sliceTestModel()); err != nil {
		t.Fatalf("seed model: %v", err)
	}
	if _, err := st.SaveProjectionState(types.ProjectionState{ID: "default", TrialCount: 3}); err != nil {
		t.Fatalf("trial count: %v", err)
	}
	handler := New(database, Config{})
	settings := sliceTestSettings()
	stochastic, _ := json.Marshal(map[string]any{"settings": settings, "config": map[string]any{"runCount": 3, "seed": 42}})
	first := postStochastic(t, handler, stochastic)
	firstEvents := sseEvents(t, first.Body.String())
	if first.Code != 200 || len(firstEvents["result"]) != 1 {
		t.Fatalf("first = %d %s", first.Code, first.Body.String())
	}
	second := postStochastic(t, handler, stochastic)
	secondEvents := sseEvents(t, second.Body.String())
	if second.Code != 200 || len(secondEvents["result"]) != 1 {
		t.Fatalf("second = %d %s", second.Code, second.Body.String())
	}
	if secondEvents["result"][0] != firstEvents["result"][0] {
		t.Fatal("served stochastic result differs from built result")
	}
	stats, err := st.ListMonteCarloStatistics("default:2026-06-01")
	if err != nil || len(stats) == 0 {
		t.Fatalf("statistics must persist: %d %v", len(stats), err)
	}
}
