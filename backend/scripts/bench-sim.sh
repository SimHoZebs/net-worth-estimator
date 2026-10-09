#!/usr/bin/env bash
# Permanent perf harness over the committed benchmark in
# internal/domain/bench_sim_test.go (inert unless -bench is passed).
# Usage: bench-sim.sh [--help] [scenario] [-- go test flags...]
#   scenario defaults to $BENCH_SCENARIO or "deterministic" and must match
#   backend/testdata/golden/<scenario>.json.
set -euo pipefail

if [ "${1:-}" = "--help" ] || [ "${1:-}" = "-h" ]; then
	echo "Usage: bench-sim.sh [scenario] [-- go test flags...]"
	echo "Benchmarks one full deterministic projection per iteration."
	echo "Scenarios: any backend/testdata/golden/<scenario>.json (default: deterministic)."
	exit 0
fi

cd "$(dirname "$0")/.."
export CGO_ENABLED=0

scenario="${1:-${BENCH_SCENARIO:-deterministic}}"
if [ "$scenario" = "--" ]; then
	scenario="${BENCH_SCENARIO:-deterministic}"
fi
if [ "${1:-}" != "" ] && [ "${1:-}" != "--" ]; then
	shift
fi
if [ "${1:-}" = "--" ]; then
	shift
fi

if [ ! -f "testdata/golden/$scenario.json" ]; then
	echo "unknown scenario '$scenario': testdata/golden/$scenario.json not found" >&2
	exit 1
fi

BENCH_SCENARIO="$scenario" go test ./internal/domain/ -run '^$' -bench '^BenchmarkSim$' "$@"
