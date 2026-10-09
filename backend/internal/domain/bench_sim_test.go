package domain

// Perf harness. BENCH_SCENARIO selects backend/testdata/golden/<scenario>.json
// (default "deterministic"); the workload is one full deterministic
// projection per iteration. Run with backend/scripts/bench-sim.sh or
// directly: BENCH_SCENARIO=checkpoints go test ./internal/domain/ -run '^$'
// -bench '^BenchmarkSim$'. Benchmarks only run under -bench, so this file
// is inert during normal test runs.

import (
	"encoding/json"
	"os"
	"path/filepath"
	"testing"

	"github.com/simhozebs/net-worth-estimator/backend/internal/types"
)

func loadBenchFixture(b *testing.B) (*types.FinancialModelDocument, *types.ProjectionRuntimeSettings, types.ModelOverrides) {
	b.Helper()
	scenario := os.Getenv("BENCH_SCENARIO")
	if scenario == "" {
		scenario = "deterministic"
	}
	data, err := os.ReadFile(filepath.Join("..", "..", "testdata", "golden", scenario+".json"))
	if err != nil {
		b.Fatalf("read fixture %s: %v", scenario, err)
	}
	var payload struct {
		Document  json.RawMessage `json:"document"`
		Settings  json.RawMessage `json:"settings"`
		Overrides json.RawMessage `json:"overrides"`
	}
	if err := json.Unmarshal(data, &payload); err != nil {
		b.Fatal(err)
	}
	var document types.FinancialModelDocument
	if err := json.Unmarshal(payload.Document, &document); err != nil {
		b.Fatalf("decode document: %v", err)
	}
	var settings types.ProjectionRuntimeSettings
	if err := json.Unmarshal(payload.Settings, &settings); err != nil {
		b.Fatalf("decode settings: %v", err)
	}
	var overrides types.ModelOverrides
	if len(payload.Overrides) > 0 {
		if err := json.Unmarshal(payload.Overrides, &overrides); err != nil {
			b.Fatalf("decode overrides: %v", err)
		}
	}
	return &document, &settings, overrides
}

func BenchmarkSim(b *testing.B) {
	document, settings, overrides := loadBenchFixture(b)
	b.ResetTimer()
	for i := 0; i < b.N; i++ {
		if _, err := ProjectFinancialModelDocument(document, settings, overrides, nil, nil); err != nil {
			b.Fatal(err)
		}
	}
}
