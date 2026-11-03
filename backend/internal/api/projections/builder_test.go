package projections

import (
	"encoding/json"
	"testing"

	"github.com/simhozebs/net-worth-estimator/backend/internal/api/apitest"
	"github.com/simhozebs/net-worth-estimator/backend/internal/types"
)

func TestYearlyBounds(t *testing.T) {
	bounds := yearlyBounds("2026-06-01", "2028-06-01")
	if len(bounds) != 2 || bounds[0] != [2]string{"2026-06-01", "2027-06-01"} || bounds[1] != [2]string{"2027-06-01", "2028-06-01"} {
		t.Fatalf("bounds = %v", bounds)
	}
	if bounds := yearlyBounds("2026-06-01", "2026-06-01"); len(bounds) != 0 {
		t.Fatalf("empty window must yield no slices, got %v", bounds)
	}
}

func TestSliceForDate(t *testing.T) {
	slices := []types.ProjectionSlice{
		{ID: "a", FromAt: midnightUnix("2026-01-01"), ToAt: midnightUnix("2027-01-01")},
		{ID: "b", FromAt: midnightUnix("2027-01-01"), ToAt: midnightUnix("2028-01-01")},
	}
	if got := sliceForDate(slices, "2026-06-01"); got != "a" {
		t.Fatalf("got %q, want a", got)
	}
	if got := sliceForDate(slices, "2027-01-01"); got != "b" {
		t.Fatalf("boundary belongs to the next slice, got %q", got)
	}
	if got := sliceForDate(slices, "2025-01-01"); got != "" {
		t.Fatalf("pre-start date must match no slice, got %q", got)
	}
}

func TestSlicesCover(t *testing.T) {
	slices := []types.ProjectionSlice{
		{FromAt: midnightUnix("2026-01-01"), ToAt: midnightUnix("2027-01-01")},
		{FromAt: midnightUnix("2027-01-01"), ToAt: midnightUnix("2028-01-01")},
	}
	if !slicesCover(slices, "2026-01-01", "2028-01-01") {
		t.Fatal("contiguous slices must cover")
	}
	if slicesCover(slices[:1], "2026-01-01", "2028-01-01") {
		t.Fatal("partial coverage must not cover")
	}
	if slicesCover(nil, "2026-01-01", "2028-01-01") {
		t.Fatal("no slices must not cover")
	}
}

func TestCanonicalEvalJSONStable(t *testing.T) {
	tables := types.EmptyEvaluationTables()
	tables.NetWorthThreshold = []types.EvaluationInstance[types.JsonValue]{
		{InstanceID: "t", Name: "T", Enabled: true, Config: map[string]any{"target": 50.0}},
	}
	first, err := canonicalEvalJSON(&tables)
	if err != nil {
		t.Fatal(err)
	}
	second, err := canonicalEvalJSON(&tables)
	if err != nil {
		t.Fatal(err)
	}
	if first != second || first == "" {
		t.Fatal("eval JSON must be stable and non-empty")
	}
	empty, err := canonicalEvalJSON(&types.EvaluationTables{})
	if err != nil {
		t.Fatal(err)
	}
	if empty == first {
		t.Fatal("different tables must serialize differently")
	}
}

func TestSummarizeSamples(t *testing.T) {
	stat := summarizeSamples("s", "2026-06-01", []float64{100, 200, 300}, 3)
	if stat.Median != 200 || stat.P10 != 120 || stat.P90 != 280 {
		t.Fatalf("quantiles wrong: %+v", stat)
	}
	if stat.Mean != 200 || stat.SampleCount != 3 {
		t.Fatalf("mean/count wrong: %+v", stat)
	}
	if stat.ProbabilityBelowZero != 0 {
		t.Fatalf("below-zero wrong: %+v", stat)
	}
	neg := summarizeSamples("s", "2026-06-01", []float64{-50, 50}, 2)
	if neg.ProbabilityBelowZero != 0.5 {
		t.Fatalf("below-zero fraction wrong: %+v", neg)
	}
}

func TestAssembleEvaluationsRoundTrip(t *testing.T) {
	h := &handler{store: apitest.OpenStore(t), resourceID: t.Name()}
	reached := true
	prob := 0.75
	date := "2027-01-01"
	rows := []types.NetWorthThresholdOutput{{
		EvaluationOutputBase: types.EvaluationOutputBase{
			StateID: "s", Kind: "deterministic", InstanceID: "t", Position: 0,
			Name: "T", Status: "satisfied", DiagnosticsJSON: "[]",
			BuiltRevision: 2, HasDeterministic: true, HasProbabilistic: true,
		},
		Reached: &reached, FirstReachedDate: &date,
		ProbProbability: &prob, ProbP10Date: &date, ProbMedianDate: &date, ProbP90Date: &date,
	}}
	if err := h.store.SaveNetWorthThresholdOutputs("s", "deterministic", rows, 2); err != nil {
		t.Fatal(err)
	}
	tables := types.EmptyEvaluationTables()
	tables.NetWorthThreshold = []types.EvaluationInstance[types.JsonValue]{{InstanceID: "t"}}
	assembled, served, err := h.assembleEvaluations("s", "deterministic", &tables, 2)
	if err != nil || !served {
		t.Fatalf("assemble = %v, %v", served, err)
	}
	if len(assembled.NetWorthThreshold) != 1 {
		t.Fatalf("threshold table wrong: %+v", assembled.NetWorthThreshold)
	}
	got := assembled.NetWorthThreshold[0]
	if got.InstanceID != "t" || got.Name != "T" || got.Status != types.StatusSatisfied {
		t.Fatalf("envelope identity wrong: %+v", got)
	}
	encoded, err := json.Marshal(got.Deterministic)
	if err != nil {
		t.Fatal(err)
	}
	if string(encoded) != `{"firstReachedDate":"2027-01-01","reached":true}` {
		t.Fatalf("deterministic mismatch: %s", encoded)
	}
	encoded, err = json.Marshal(got.Probabilistic)
	if err != nil {
		t.Fatal(err)
	}
	if string(encoded) != `{"medianReachedDate":"2027-01-01","p10ReachedDate":"2027-01-01","p90ReachedDate":"2027-01-01","probability":0.75}` {
		t.Fatalf("probabilistic mismatch: %s", encoded)
	}
	if len(assembled.PlannedPurchases) != 0 {
		t.Fatalf("empty tables must stay empty, got %+v", assembled.PlannedPurchases)
	}
}

func TestOutputsSatisfy(t *testing.T) {
	h := &handler{store: apitest.OpenStore(t), resourceID: t.Name()}
	tables := types.EmptyEvaluationTables()
	if served, err := h.outputsSatisfy("s", "deterministic", &tables, 3); err != nil || !served {
		t.Fatal("empty tables need no outputs")
	}
	tables.NetWorthThreshold = []types.EvaluationInstance[types.JsonValue]{{InstanceID: "t"}}
	if served, err := h.outputsSatisfy("s", "deterministic", &tables, 3); err != nil || served {
		t.Fatal("configured tables with no outputs must not satisfy")
	}
	reached := true
	if err := h.store.SaveNetWorthThresholdOutputs("s", "deterministic", []types.NetWorthThresholdOutput{{
		EvaluationOutputBase: types.EvaluationOutputBase{StateID: "s", Kind: "deterministic", InstanceID: "t", BuiltRevision: 2, HasDeterministic: true},
		Reached:              &reached,
	}}, 2); err != nil {
		t.Fatal(err)
	}
	if served, err := h.outputsSatisfy("s", "deterministic", &tables, 3); err != nil || served {
		t.Fatal("stale revision must not satisfy")
	}
	if err := h.store.SaveNetWorthThresholdOutputs("s", "deterministic", []types.NetWorthThresholdOutput{{
		EvaluationOutputBase: types.EvaluationOutputBase{StateID: "s", Kind: "deterministic", InstanceID: "t", BuiltRevision: 3, HasDeterministic: true},
		Reached:              &reached,
	}}, 3); err != nil {
		t.Fatal(err)
	}
	if served, err := h.outputsSatisfy("s", "deterministic", &tables, 3); err != nil || !served {
		t.Fatal("current outputs must satisfy")
	}
}

func TestFulfillmentOutcome(t *testing.T) {
	if fulfillmentOutcome(nil) != "fulfilled" {
		t.Fatal("nil fulfillment reads as fulfilled")
	}
	if fulfillmentOutcome(&types.TransactionFulfillment{UnfulfilledAmount: 10}) != "unfulfilled" {
		t.Fatal("positive unfulfilled must report unfulfilled")
	}
	if fulfillmentOutcome(&types.TransactionFulfillment{DestinationLimitedAmount: 5}) != "fulfilled" {
		t.Fatal("destination limits are not unfulfilled funding")
	}
}
