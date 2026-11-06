# PERF-01 — Benchmark hash-key, revision-key and event-invalidation strategies

**Status:** Proposed / not yet in Notion  
**Area:** Architecture validation  
**Source:** Export-only proposed task (not yet created in Notion)  
**Depends on:** None

**User story:** As an engineer, I need measured evidence before committing to a computation invalidation architecture.

### Acceptance criteria

- [ ] Benchmark existing full JSON+SHA-256 lookup, a persisted revision-key lookup, event-backed invalidation, and a revision-fast-path/content-hash hybrid using equivalent semantics.
- [ ] Use representative model sizes (100, 1,000, 10,000 transactions), varied accounts/rules/amount resolvers/evaluations, and repeatable workloads.
- [ ] Test warm stable reads, frequent small writes, bank-sync bursts, evaluation-only changes, concurrent requests, cold starts and restarts.
- [ ] Separately measure serialization/hash generation, revision reads/writes, event publication/fanout, cache lookup, full projection/reader/simulator computations.
- [ ] Record p50/p95/p99 latency, CPU, allocations, SQLite lock time, cache hit/miss and total operations; estimate break-even read/write ratios.
- [ ] Measure direct computation as the baseline before slice persistence lands.
- [ ] Validate no stale current results after concurrent writes and no weakened group-sharing revocation under every design.
- [ ] Produce reproducible harness, results, decision write-up; do not select a broker before evidence exists.

### Implementation notes and boundaries

Proposed export-only task; not a current Notion task. Extends backend/scripts/bench-sim.sh and backend/internal/domain/bench_sim_test.go; see [architecture validation](../docs/architecture-validation.md).

**Scope:** Planning / not implemented in this export. Do not infer completed code from these checklists.
