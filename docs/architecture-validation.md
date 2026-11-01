# Computation invalidation and caching — validation spike

**Status:** Proposed; measurements not run; no architecture winner selected.  **Sources:** [NWE architecture RFC](https://app.notion.com/p/40bee37bd02881639c15e9cf5076577e), [current code](https://github.com/SimHoZebs/net-worth-estimator).

## Question

Is repeated full-model JSON serialization + hashing cheaper overall than transactionally maintained revision keys, event invalidation, or a hybrid? Compare the *total system cost*: reads, writes, deduplication, simulation, cache storage, accuracy, recovery and operational complexity.

## Observed current code

- `backend/internal/domain/basepath_cache.go::BaseModelHash` marshals all projection-relevant model inputs plus projection settings to JSON, then SHA-256 hashes them. It excludes evaluation configuration.
- `backend/internal/domain/project.go::ProjectFinancialModel` calls `projectBaseWithCache()` which calculates `BaseModelHash`; afterward it calculates `BaseModelHash` **again** to key reader and simulator evaluations. Target this duplicate first.
- `backend/internal/domain/eval_cache.go` caches reader evaluations by base key + reader subset, and simulator evaluations by base key + simulator subset + detail, with `singleflight` for expensive duplicate requests.
- `backend/internal/store/types.go::ModelETag` separately marshals/hashes canonical model, while frontend `frontend/src/state/remoteStorage.ts::serverModelFingerprint` canonicalizes and hashes a semantic model.
- `docs/analyses.md` describes an evidence-revision polling worker, not a dependent forecast simulation.
- `backend/scripts/bench-sim.sh` and `backend/internal/domain/bench_sim_test.go` provide an existing reproducible Go benchmark harness.

## Strategies to compare

| Label | Strategy | Cost profile to measure |
| --- | --- | --- |
| A | Existing content hash on each execution | Serialize model + hash + cache lookup for each request |
| B | Persisted transactionally incremented dependency revision | O(1)-sized revision lookup on reads; revision maintenance on writes; potential over-invalidation |
| C | Event-driven cache invalidation | Publish + subscribers + state tracking, recovery, batching and restart behavior |
| D | Hybrid revision fast path plus hash when revision changes | Cheap stable reads plus occasional hashing; additional complexity and revision soundness |

## Benchmark matrix

- Models: 100 / 1,000 / 10,000 postings; vary accounts, recurrence rules, amount resolvers and evaluation configurations.
- Workloads: repeated warm-cache reads; many single posting edits; a bank-sync batch with hundreds of updated transactions and **one** post-sync forecast request; evaluation-only changes; concurrent identical calls; cold process restart.
- Measure individually: JSON encoding, SHA-256, revision lookup/update, event send/delivery/handler, cache lookup, projection base compute, reader evaluations, simulator/branch evaluations, SQLite transaction and lock time.
- Report allocations/op, CPU, memory, cache hit and miss counts, recomputation count, end-to-end p50/p95/p99 and write amplification.
- Simulate realistic read/write ratios and derive a break-even region rather than relying only on microbenchmarks.
- Verify all variants use the same input version and cannot return a prior in-flight calculation as current after source changes; test user boundaries, bank-sync merges, crash/restart and duplicates.
- Keep group-sharing permission index current or fail-closed; cache/event performance comparison cannot relax authorization guarantees.

## Low-risk first experiment

Benchmark once **before and after** passing the already-generated `BaseModelHash` from the base-path lookup to its evaluation consumers. This should avoid a repeated full-model JSON marshal+hash per projection call, without altering cache semantics. Record both hit and miss workloads; confirm no changes to result identity or output.

## Deliverables and decision gate

1. Reproducible benchmark code and fixture generation, preserving the existing harness.
2. Baseline and candidate measurements, including a CPU and allocation breakdown.
3. Correctness/security/concurrency test matrix.
4. Decision document comparing complexity, performance, and break-even read/write ratio.
5. No broker adoption or production rewrite before measured evidence.

[Proposed task PERF-01](../tasks/PERF-01.md) | [Complete backlog](../tasks/NWE_BACKLOG.md)
