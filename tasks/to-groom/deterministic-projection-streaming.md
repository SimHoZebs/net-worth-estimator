# Streamed Deterministic Projections

Status: backlog (deferred; see why deferred)

## Goal

Deliver deterministic projections progressively over SSE: history rows first for instant first paint, projected rows in a handful of cumulative chunks, evaluations with the final event. The chart appends chunks regardless of source. No generic series or append path exists today; this builds one.

## Why deferred

The range API plus gzip already covers slow links. Measured 2026-10-24 on production-shaped data (21 accounts, 230 postings, 20-year horizon): a past-to-today slice is 98 of 1883 rows, ~189KB raw and ~11KB gzipped at level 5, against ~6MB raw / ~329KB gzipped full. The full run itself is on the order of 100ms. Chunking therefore saves perceived latency only, never compute. Revisit when first paint still lags (very large horizons, very bad links) or when the modal flow in Outlook needs progressive fill.

## Scope

- Kernel progress hook in `backend/internal/domain/simulate.go`: flush cumulative row snapshots every N event dates (about 5 flushes per run, never per date; explicitly exclude nested FI branch evaluations). Guard throughput with `backend/scripts/bench-sim.sh`.
- New SSE endpoint beside `POST /v1/projections/deterministic` (which stays, unchanged). Event shapes deliberately differ from the stochastic contract: stochastic emits `progress`/`partial`/`result` as run-count snapshots (`backend/internal/api/stochastic_sse.go`), while this stream emits `history` (historical rows, current net worth, starting balances — no stochastic analogue), `partial` (cumulative date-chunked rows), and `result` (today's exact full shape, evaluations included). Clients handle two first-event shapes.
- The stream takes the same required `range` as the plain endpoint (missing fails validation, empty/malformed/inverted fail before work). Range stays out of the artifact key; date filtering mirrors `clipProjectionRange` and affects only timeline rows and movement events. Evaluations, totals, summary, milestones, and account summaries keep complete-result values in every event, including history-only or empty intervals.
- Reuse the genuinely shared SSE helpers (`writeSSEPreamble`, `newSSEEventWriter`, `startSSEHeartbeat`) plus result lookup/storage and `Projection-Source: stored|computed` semantics (CORS already exposes `Projection-Source`). Do not reuse the shared-run registry: it is seeded-stochastic-only, and overlapping deterministic requests are already correct without run ownership.
- Frontend generic series type plus adapters: the plot consumes `{date, value}` points with optional bands and an append interface. `projectionChartModel` (`frontend/src/domain/chart.ts`) becomes one adapter; shared chart ownership today is geometry-only (`lineChartModel`). Appending chunks touches the whole-model memo, `ProjectionPlot`, and inspector index logic.
- Evaluations gate on `result`: they need the full path (first-crossing scans, FI branch runs, fulfillment over all events) and cannot stream early.

## Acceptance Criteria

- First paint renders from the `history` event alone.
- Chunks append without render storms (bounded flush count) and without changing final pixels versus the plain endpoint.
- Evaluations in the streamed `result` equal the plain-endpoint result exactly.
- Disconnect mid-stream resumes via re-request (artifact replay) or falls back to the plain endpoint with identical output.
- `backend/scripts/bench-sim.sh deterministic` shows no kernel regression.

## Non-goals

- No stochastic changes; seeded sharing and run-count partials stay as they are.
- No kernel math changes; only observation points outside branch evaluations.
- No cache identity changes; the stored artifact stays the full result.
- No new evaluation detail; fulfillment keeps the trimmed scalar-only envelope (per-event evidence stays on `movementEvents`).
