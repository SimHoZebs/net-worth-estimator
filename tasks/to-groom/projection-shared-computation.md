# Projection: share one in-flight computation

Status: approved (ready to schedule).

## Goal

The purchase planner asks for the projection and the planned-purchases evaluation together. Both resolve to the same projection because the projection identity leaves evaluations out, but on a cold start each ask runs the full calculation and one stored result replaces the other. Share one in-flight projection calculation across simultaneous callers keyed by the existing projection identity, following the simulator-evaluation precedent that already shares one expensive computation across concurrent identical requests.

## Scope

- Add the shared in-flight gate around the projection miss in `backend/internal/domain/basepath_cache.go:116-133`, keyed by the existing `BaseModelHash`, reusing the `singleflight` pattern at `backend/internal/domain/eval_cache.go:96-98,183-200`.
- Simultaneous callers wait on the first calculation and receive the same read-only shared path and result. Keep the read-only contract (`basepath_cache.go:13-18`), the 32-entry bound, and evaluations out of the projection key so evaluation-only changes still reuse the projection.
- Callers: the planner's paired requests in `frontend/src/state/useRemoteProjection.ts:503-535` and `frontend/src/pages/PurchasesPage.tsx:16-26`.

## Acceptance criteria

- Starting the saved-model request and the purchase-evaluation request together calculates the projection once for the pair and both responses carry the identical projection result with their own evaluation tables.
- `BasePathCacheStats` reports one miss for the pair; the second caller reuses the in-flight result.
- `backend/internal/domain/eval_cache_test.go` (evaluation-only change reuses the projection, timeline unchanged) and the purchase planner schedule tests stay green.

## Non-goals

- No cache identity changes; the stored result stays the full projection result and the stored-result bound stays in place.
- No evaluation changes; reader/simulator split and detail-level keys stay as they are.
- No browser changes; the paired requests stay as they are.

Compute savings are structural and unmeasured; no timing claim is part of this change.
