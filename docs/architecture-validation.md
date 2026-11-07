# Computation invalidation and caching — validation spike

**Status:** Superseded. Unified projection (slice persistence, revision-scoped
suffix rebuild) is shipped; see [unified projection](unified-projection.md).
Retained here as the pre-decision validation record.  **Sources:** [NWE architecture RFC](https://app.notion.com/p/40bee37bd02881639c15e9cf5076577e), [current code](https://github.com/SimHoZebs/net-worth-estimator).

## Question

Is repeated full-model JSON serialization + hashing cheaper overall than transactionally maintained revision keys, event invalidation, or a hybrid? Compare the *total system cost*: reads, writes, deduplication, simulation, cache storage, accuracy, recovery and operational complexity.

## Observed current code

- Content-hash caches are removed. `backend/internal/domain/project.go::ProjectFinancialModel` prepares, simulates, and evaluates directly on every call. No `BaseModelHash`, no `EvaluationsHash`, no base-path cache, no evaluation caches, no `singleflight`.
- `backend/internal/store` owns `projection_states` plus `projection_slices` plus `monte_carlo_statistics` plus `provider_connections`. One `default` state per user carries revision, published revision, `dirty_from`, projection start, horizon end, timezone, engine version, trial count, and seed.
- `backend/internal/domain/projection_reader.go` finds the first invalid slice for a `dirty_from` date. Suffix rebuild is the invalidation strategy.
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

- Models: 100 / 1,000 / 10,000 transactions; vary accounts, recurrence rules, amount resolvers and evaluation configurations.
- Workloads: repeated warm-cache reads; many single transaction edits; a bank-sync batch with hundreds of updated transactions and **one** post-sync forecast request; evaluation-only changes; concurrent identical calls; cold process restart.
- Measure individually: JSON encoding, SHA-256, revision lookup/update, event send/delivery/handler, cache lookup, projection base compute, reader evaluations, simulator/branch evaluations, SQLite transaction and lock time.
- Report allocations/op, CPU, memory, cache hit and miss counts, recomputation count, end-to-end p50/p95/p99 and write amplification.
- Simulate realistic read/write ratios and derive a break-even region rather than relying only on microbenchmarks.
- Verify all variants use the same input version and cannot return a prior in-flight calculation as current after source changes; test user boundaries, bank-sync merges, crash/restart and duplicates.
- Keep group-sharing permission index current or fail-closed; cache/event performance comparison cannot relax authorization guarantees.

## Low-risk first experiment

Benchmark direct computation against revision-keyed slice reuse on the matrix below. Record warm stable reads, frequent small edits, bank-sync bursts, evaluation-only changes, concurrent requests, and cold restarts. Confirm identical outputs before adopting slice persistence.

## Deliverables and decision gate

1. Reproducible benchmark code and fixture generation, preserving the existing harness.
2. Baseline and candidate measurements, including a CPU and allocation breakdown.
3. Correctness/security/concurrency test matrix.
4. Decision document comparing complexity, performance, and break-even read/write ratio.
5. No broker adoption or production rewrite before measured evidence.

[Proposed task PERF-01](../tasks/PERF-01.md) | [Complete backlog](../tasks/NWE_BACKLOG.md)
